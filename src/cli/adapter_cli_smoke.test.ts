/* src/cli/adapter_cli_smoke.test.ts */

import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const childProcess = require("child_process");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-adapter-cli-"));

const writeStoredZip = (outPath: string, entries: Array<{ name: string; text: string }>): void => {
  let offset = 0;
  const localParts: any[] = [];
  const centralParts: any[] = [];
  entries.forEach((entry, index) => {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataRaw = Buffer.from(entry.text || "", "utf8");
    const data = zlib.deflateRawSync(dataRaw);
    let crc = 0 ^ -1;
    for (let i = 0; i < dataRaw.length; i += 1) {
      crc ^= dataRaw[i];
      for (let j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    crc ^= -1;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc >>> 0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(dataRaw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc >>> 0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(dataRaw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
    if (index > 10000) throw new Error("zip fixture overflow");
  });
  const centralStart = offset;
  const centralBlob = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(outPath, Buffer.concat([...localParts, centralBlob, eocd]));
};

const corruptSecondZipCentralSignature = (zipPath: string): void => {
  const bytes = fs.readFileSync(zipPath);
  const centralOffsets: number[] = [];
  for (let i = 0; i <= Math.max(0, bytes.length - 4); i += 1) {
    if (bytes.readUInt32LE(i) === 0x02014b50) centralOffsets.push(i);
  }
  if (centralOffsets.length < 2) throw new Error("zip fixture missing second central directory entry");
  bytes.writeUInt32LE(0x41414141, centralOffsets[1]);
  fs.writeFileSync(zipPath, bytes);
};

const writeSimpleAr = (outPath: string, files: Array<{ name: string; bytes: any }>): void => {
  const parts: any[] = [Buffer.from("!<arch>\n", "ascii")];
  files.forEach((file) => {
    const nameRaw = String(file.name || "").replace(/\s+/g, "_");
    const nameField = `${nameRaw}/`.slice(0, 16).padEnd(16, " ");
    const payload = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes || "");
    const sizeField = String(payload.length).padStart(10, " ");
    const header = Buffer.from(
      `${nameField}${"0".padEnd(12, " ")}${"0".padEnd(6, " ")}${"0".padEnd(6, " ")}${"100644 ".padEnd(8, " ")}${sizeField}\`\n`,
      "ascii"
    );
    parts.push(header, payload);
    if (payload.length % 2 !== 0) parts.push(Buffer.from("\n", "ascii"));
  });
  fs.writeFileSync(outPath, Buffer.concat(parts));
};

const writeSimpleTar = (outPath: string, files: Array<{ name: string; text: string }>): void => {
  const blocks: any[] = [];
  const pushHeader = (name: string, size: number) => {
    const header = Buffer.alloc(512, 0);
    const nameBuf = Buffer.from(name, "utf8");
    nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));
    Buffer.from("0000777\0", "ascii").copy(header, 100);
    Buffer.from("0000000\0", "ascii").copy(header, 108);
    Buffer.from("0000000\0", "ascii").copy(header, 116);
    const sizeOct = size.toString(8).padStart(11, "0");
    Buffer.from(`${sizeOct}\0`, "ascii").copy(header, 124);
    Buffer.from("00000000000\0", "ascii").copy(header, 136);
    for (let i = 148; i < 156; i += 1) header[i] = 0x20;
    header[156] = "0".charCodeAt(0);
    Buffer.from("ustar\0", "ascii").copy(header, 257);
    Buffer.from("00", "ascii").copy(header, 263);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    const chk = sum.toString(8).padStart(6, "0");
    Buffer.from(`${chk}\0 `, "ascii").copy(header, 148);
    blocks.push(header);
  };
  files.forEach((file) => {
    const data = Buffer.from(file.text, "utf8");
    pushHeader(file.name.replace(/\\/g, "/"), data.length);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
  });
  blocks.push(Buffer.alloc(1024, 0));
  fs.writeFileSync(outPath, Buffer.concat(blocks));
};

const writeSimpleTgz = (outPath: string, files: Array<{ name: string; text: string }>): void => {
  const tmp = mkTmp();
  const tarPath = path.join(tmp, "payload.tar");
  writeSimpleTar(tarPath, files);
  const bytes = fs.readFileSync(tarPath);
  const gz = zlib.gzipSync(bytes);
  fs.writeFileSync(outPath, gz);
};

const tarAvailable = (): boolean => {
  const probe = childProcess.spawnSync("tar", ["--help"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000,
  });
  if (probe?.error?.code === "ENOENT") return false;
  if (probe?.error?.code === "ENOTFOUND") return false;
  if (probe?.error?.code === "UNKNOWN") return false;
  return true;
};

const run = async (): Promise<void> => {
  {
    const res = await runCliCapture(["adapter", "list"]);
    assertEq(res.status, 0, `adapter list should succeed\n${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assertEq(parsed.schema, "weftend.adapterList/0", "adapter list schema mismatch");
    assert(Array.isArray(parsed.adapters), "adapter list adapters should be array");
    const names = (parsed.adapters as Array<{ adapter: string }>).map((item) => item.adapter).sort();
    const required = ["archive", "package", "extension", "iac", "cicd", "document", "container", "image", "scm", "signature"];
    for (const name of required) {
      assert(names.includes(name), `adapter list missing ${name}`);
    }
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "good.zip");
    writeStoredZip(input, [
      { name: "a.txt", text: "alpha" },
      { name: "b/c.txt", text: "beta" },
    ]);
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 0, `safe-run archive should succeed\n${res.stderr}`);
    const safePath = path.join(outDir, "safe_run_receipt.json");
    const summaryPath = path.join(outDir, "analysis", "adapter_summary_v0.json");
    const findingsPath = path.join(outDir, "analysis", "adapter_findings_v0.json");
    assert(fs.existsSync(safePath), "safe_run_receipt.json missing");
    assert(fs.existsSync(summaryPath), "adapter_summary_v0.json missing");
    assert(fs.existsSync(findingsPath), "adapter_findings_v0.json missing");
    const safe = JSON.parse(fs.readFileSync(safePath, "utf8"));
    assert(safe.adapter && safe.adapter.adapterId === "archive_adapter_v1", "safe receipt adapter metadata missing");
    assert(safe.contentSummary && safe.contentSummary.adapterSignals, "contentSummary.adapterSignals missing");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "sample.tgz");
    fs.writeFileSync(input, "not-a-real-tgz", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for tgz without tar plugin");
    assert(res.stderr.includes("ARCHIVE_PLUGIN_REQUIRED"), "expected ARCHIVE_PLUGIN_REQUIRED on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "case_collision_plugin.tgz");
    writeSimpleTgz(input, [
      { name: "A.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    if (tarAvailable()) {
      const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive", "--enable-plugin", "tar"]);
      assertEq(res.status, 40, "safe-run archive should fail closed for strict plugin route with case-colliding entry paths");
      assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for case-colliding plugin archive entries");
    }
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "bad.tar");
    fs.writeFileSync(input, "not-a-tar", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for explicit archive format mismatch");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "partial_after_entries.tar");
    writeSimpleTar(input, [{ name: "a.txt", text: "alpha" }]);
    fs.appendFileSync(input, Buffer.alloc(512, 0x41));
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed when tar metadata is partial after parsed entries");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for partial tar metadata");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "bad.zip");
    fs.writeFileSync(input, "not-a-zip", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for explicit zip signature mismatch");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for bad zip");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "partial_after_entries.zip");
    writeStoredZip(input, [
      { name: "a.txt", text: "alpha" },
      { name: "b.txt", text: "beta" },
    ]);
    corruptSecondZipCentralSignature(input);
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed when zip metadata is partial after parsed entries");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for partial zip metadata");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "duplicate_paths.zip");
    writeStoredZip(input, [
      { name: "a.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for strict zip route with duplicate entry paths");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for duplicate zip entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "case_collision.zip");
    writeStoredZip(input, [
      { name: "A.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for strict zip route with case-colliding entry paths");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for case-colliding zip entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "duplicate_paths.tar");
    writeSimpleTar(input, [
      { name: "a.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for strict tar route with duplicate entry paths");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for duplicate tar entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "case_collision.tar");
    writeSimpleTar(input, [
      { name: "A.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run archive should fail closed for strict tar route with case-colliding entry paths");
    assert(res.stderr.includes("ARCHIVE_FORMAT_MISMATCH"), "expected ARCHIVE_FORMAT_MISMATCH on stderr for case-colliding tar entry paths");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "archive",
      "--enable-plugin",
      "unknown_plugin_name",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for unknown plugin name");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNKNOWN"), "expected ADAPTER_PLUGIN_UNKNOWN on stderr");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "none",
      "--enable-plugin",
      "unknown_plugin_name",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for unknown plugin even when adapter is none");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNKNOWN"), "expected ADAPTER_PLUGIN_UNKNOWN on stderr for adapter none");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "none",
      "--enable-plugin",
      "tar",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for plugin usage when adapter is none");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNUSED"), "expected ADAPTER_PLUGIN_UNUSED on stderr for adapter none");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "plain.txt");
    fs.writeFileSync(input, "plain text input", "utf8");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "auto",
      "--enable-plugin",
      "tar",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed when adapter auto has no class match and plugin flags are provided");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNUSED"), "expected ADAPTER_PLUGIN_UNUSED on stderr for auto unmatched");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "sample.pdf");
    fs.writeFileSync(input, "pdf-ish bytes", "utf8");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "document",
      "--enable-plugin",
      "tar",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed when plugin flags are provided for non-plugin adapters");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNUSED"), "expected ADAPTER_PLUGIN_UNUSED on stderr for non-plugin adapter");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "main.tf");
    fs.writeFileSync(input, "resource \"null_resource\" \"x\" {}\n", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "cicd"]);
    assertEq(res.status, 40, "safe-run should fail closed for cicd route mismatch");
    assert(res.stderr.includes("CICD_UNSUPPORTED_FORMAT"), "expected CICD_UNSUPPORTED_FORMAT on stderr for cicd mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "azure-pipelines.yml");
    fs.writeFileSync(input, "title: placeholder\nmessage: plain text\n", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "cicd"]);
    assertEq(res.status, 40, "safe-run should fail closed for cicd path-hint-only input without ci structure/signals");
    assert(res.stderr.includes("CICD_UNSUPPORTED_FORMAT"), "expected CICD_UNSUPPORTED_FORMAT on stderr for path-hint-only cicd input");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "notes.yaml");
    fs.writeFileSync(input, "title: hello\nmessage: plain text\n", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "iac"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit iac route mismatch");
    assert(res.stderr.includes("IAC_UNSUPPORTED_FORMAT"), "expected IAC_UNSUPPORTED_FORMAT on stderr for iac mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "build.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n",
      "utf8"
    );
    const res = await runCliCapture(["safe-run", tmp, "--out", outDir, "--adapter", "iac"]);
    assertEq(res.status, 40, "safe-run should fail closed for ci workflow under explicit iac route");
    assert(res.stderr.includes("IAC_UNSUPPORTED_FORMAT"), "expected IAC_UNSUPPORTED_FORMAT on stderr for ci workflow under iac route");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "auto_class.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n",
      "utf8"
    );
    const res = await runCliCapture(["safe-run", tmp, "--out", outDir, "--adapter", "auto"]);
    assertEq(res.status, 0, `safe-run should classify workflow under adapter auto\n${res.stderr}`);
    const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(safe.contentSummary?.adapterSignals?.class, "cicd", "adapter auto should classify workflow as cicd");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "archive",
      "--enable-plugin",
      "tar",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed when archive plugins are inapplicable to format");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNUSED"), "expected ADAPTER_PLUGIN_UNUSED on stderr for zip+tar");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "sample.tgz");
    fs.writeFileSync(input, "not-a-real-tgz", "utf8");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "archive",
      "--enable-plugin",
      "tar",
      "--enable-plugin",
      "7z",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed when archive includes extra inapplicable plugin");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNUSED"), "expected ADAPTER_PLUGIN_UNUSED on stderr for tgz+7z");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "plain.txt");
    fs.writeFileSync(input, "plain text input", "utf8");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "auto",
      "--enable-plugin",
      "unknown_plugin_name",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for unknown plugin under adapter auto");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNKNOWN"), "expected ADAPTER_PLUGIN_UNKNOWN on stderr for adapter auto");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adpater", "archive"]);
    assertEq(res.status, 40, "safe-run should fail closed for unsupported flag typo");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for unsupported flag typo");
  }

  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture(["safe-run", input, "--out", "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run should fail closed when --out value is missing");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for missing --out value");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter"]);
    assertEq(res.status, 40, "safe-run should fail closed for missing --adapter value");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for missing --adapter value");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "archive",
      "--adapter",
      "document",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for duplicate singleton flags");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for duplicate adapter flag");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--out",
      path.join(outDir, "second"),
      "--adapter",
      "archive",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for duplicate --out flag");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for duplicate --out flag");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture(["safe-run", input, "unexpected_extra_arg", "--out", outDir, "--adapter", "archive"]);
    assertEq(res.status, 40, "safe-run should fail closed for unexpected positional arguments");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for positional-arg misuse");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "archive",
      "--execute",
      "--withhold-exec",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed for conflicting execute/withhold flags");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for conflicting execute flags");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "archive", "--enable-plugin"]);
    assertEq(res.status, 40, "safe-run should fail closed when --enable-plugin value is missing");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr");
  }

  {
    const outDir = mkTmp();
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const res = await runCliCapture([
      "safe-run",
      input,
      "--out",
      outDir,
      "--adapter",
      "archive",
      "--enable-plugin",
      "tar",
      "--enable-plugin",
      "tar",
    ]);
    assertEq(res.status, 40, "safe-run should fail closed when duplicate plugin names are provided");
    assert(res.stderr.includes("INPUT_INVALID"), "expected INPUT_INVALID on stderr for duplicate plugin names");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "doc_with_signals.pdf");
    fs.writeFileSync(
      input,
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nmacro javascript EmbeddedFile http://example.test\nxref\n0 2\n0000000000 65535 f \n0000000010 00000 n \ntrailer\n<< /Root 1 0 R /Size 2 >>\nstartxref\n42\n%%EOF\n",
      "utf8"
    );
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 0, `safe-run document should succeed\n${res.stderr}`);
    const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(safe.adapter?.adapterId, "document_adapter_v1", "document adapter id mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const noEofPdf = path.join(tmp, "no_eof.pdf");
    fs.writeFileSync(noEofPdf, "%PDF-1.7\nmacro javascript EmbeddedFile http://example.test\n", "utf8");
    const res = await runCliCapture(["safe-run", noEofPdf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit document pdf missing EOF marker");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for pdf missing EOF marker");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const noStructurePdf = path.join(tmp, "no_structure.pdf");
    fs.writeFileSync(noStructurePdf, "%PDF-1.7\nplaceholder text only\n%%EOF\n", "utf8");
    const res = await runCliCapture(["safe-run", noStructurePdf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit document pdf without structural markers");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for pdf without structural markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const noStartxrefPdf = path.join(tmp, "no_startxref.pdf");
    fs.writeFileSync(noStartxrefPdf, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "utf8");
    const res = await runCliCapture(["safe-run", noStartxrefPdf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit document pdf missing startxref marker");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for pdf missing startxref marker");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const looseObjPdf = path.join(tmp, "loose_obj.pdf");
    fs.writeFileSync(looseObjPdf, "%PDF-1.7\nobj token only trailer\n%%EOF\n", "utf8");
    const res = await runCliCapture(["safe-run", looseObjPdf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit document pdf missing object syntax");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for pdf missing object syntax");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badPdf = path.join(tmp, "bad.pdf");
    fs.writeFileSync(badPdf, "not-a-pdf", "utf8");
    const res = await runCliCapture(["safe-run", badPdf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit document pdf header mismatch");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for bad pdf");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const chm = path.join(tmp, "sample.chm");
    const bytes = Buffer.alloc(0x60, 0);
    bytes[0] = 0x49;
    bytes[1] = 0x54;
    bytes[2] = 0x53;
    bytes[3] = 0x46;
    bytes.writeUInt32LE(3, 4);
    bytes.writeUInt32LE(0x60, 8);
    fs.writeFileSync(chm, bytes);
    const res = await runCliCapture(["safe-run", chm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 0, "safe-run document should accept explicit CHM with minimum structural header evidence");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyChm = path.join(tmp, "tiny.chm");
    const bytes = Buffer.alloc(8, 0);
    bytes[0] = 0x49;
    bytes[1] = 0x54;
    bytes[2] = 0x53;
    bytes[3] = 0x46;
    fs.writeFileSync(tinyChm, bytes);
    const res = await runCliCapture(["safe-run", tinyChm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit CHM with header-only tiny input");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for tiny CHM");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const rtf = path.join(tmp, "sample.rtf");
    fs.writeFileSync(rtf, "{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs20 sample text}", "utf8");
    const res = await runCliCapture(["safe-run", rtf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 0, "safe-run document should accept explicit RTF with structural prolog/closing brace");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyRtf = path.join(tmp, "tiny.rtf");
    fs.writeFileSync(tinyRtf, "{\\rtf1}", "utf8");
    const res = await runCliCapture(["safe-run", tinyRtf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit RTF missing baseline control-word evidence");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for RTF missing baseline control-word evidence");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const noCloseRtf = path.join(tmp, "no_close.rtf");
    fs.writeFileSync(noCloseRtf, "{\\rtf1\\ansi sample text", "utf8");
    const res = await runCliCapture(["safe-run", noCloseRtf, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit RTF missing closing brace");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for RTF missing closing brace");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badDocm = path.join(tmp, "bad.docm");
    fs.writeFileSync(badDocm, "not-a-zip-office-doc", "utf8");
    const res = await runCliCapture(["safe-run", badDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for invalid explicit docm container");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badStructureDocm = path.join(tmp, "bad_structure.docm");
    writeStoredZip(badStructureDocm, [{ name: "word/document.xml", text: "<w:document/>" }]);
    const res = await runCliCapture(["safe-run", badStructureDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm missing OOXML structure");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for missing OOXML structure");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialDocm = path.join(tmp, "partial.docm");
    writeStoredZip(partialDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    corruptSecondZipCentralSignature(partialDocm);
    const res = await runCliCapture(["safe-run", partialDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed when OOXML ZIP metadata is partial after parsed entries");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for partial docm metadata");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const missingPrimaryDocm = path.join(tmp, "missing_primary.docm");
    writeStoredZip(missingPrimaryDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/_rels/document.xml.rels", text: "<Relationships></Relationships>" },
    ]);
    const res = await runCliCapture(["safe-run", missingPrimaryDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm missing primary document part");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for missing OOXML primary document part");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const missingPrimaryXlsm = path.join(tmp, "missing_primary.xlsm");
    writeStoredZip(missingPrimaryXlsm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "xl/_rels/workbook.xml.rels", text: "<Relationships></Relationships>" },
    ]);
    const res = await runCliCapture(["safe-run", missingPrimaryXlsm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit xlsm missing primary workbook part");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for missing OOXML primary workbook part");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const wrongRelDocm = path.join(tmp, "wrong_rel.docm");
    writeStoredZip(wrongRelDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "xl/_rels/workbook.xml.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const res = await runCliCapture(["safe-run", wrongRelDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm with xlsm-only relationship marker");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for docm with mismatched relationship marker");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const wrongRelXlsm = path.join(tmp, "wrong_rel.xlsm");
    writeStoredZip(wrongRelXlsm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "word/_rels/document.xml.rels", text: "<Relationships></Relationships>" },
      { name: "xl/workbook.xml", text: "<workbook/>" },
    ]);
    const res = await runCliCapture(["safe-run", wrongRelXlsm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit xlsm with docm-only relationship marker");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for xlsm with mismatched relationship marker");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateContentTypesDocm = path.join(tmp, "duplicate_content_types.docm");
    writeStoredZip(duplicateContentTypesDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateContentTypesDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm with duplicate [Content_Types].xml markers");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for duplicate [Content_Types].xml markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicatePrimaryDocm = path.join(tmp, "duplicate_primary.docm");
    writeStoredZip(duplicatePrimaryDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const res = await runCliCapture(["safe-run", duplicatePrimaryDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm with duplicate primary document parts");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for duplicate primary document parts");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateRootRelsDocm = path.join(tmp, "duplicate_root_rels.docm");
    writeStoredZip(duplicateRootRelsDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateRootRelsDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm with duplicate root relationship markers");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for duplicate OOXML relationship markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const caseCollisionDocm = path.join(tmp, "case_collision.docm");
    writeStoredZip(caseCollisionDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
      { name: "word/Scripts.js", text: "a" },
      { name: "word/scripts.js", text: "b" },
    ]);
    const res = await runCliCapture(["safe-run", caseCollisionDocm, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docm with case-colliding OOXML entry paths");
    assert(res.stderr.includes("DOC_FORMAT_MISMATCH"), "expected DOC_FORMAT_MISMATCH on stderr for case-colliding OOXML entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badPem = path.join(tmp, "bad.pem");
    fs.writeFileSync(badPem, "plain text not signature material", "utf8");
    const res = await runCliCapture(["safe-run", badPem, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit signature format mismatch");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const malformedPemPayload = path.join(tmp, "malformed_payload.pem");
    fs.writeFileSync(
      malformedPemPayload,
      ["-----BEGIN CERTIFICATE-----", "%%%%", "-----END CERTIFICATE-----"].join("\n"),
      "utf8"
    );
    const res = await runCliCapture(["safe-run", malformedPemPayload, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for malformed PEM envelope payload");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for malformed PEM payload");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const sigWithCertEnvelope = path.join(tmp, "sig_with_cert_envelope.sig");
    fs.writeFileSync(
      sigWithCertEnvelope,
      ["-----BEGIN CERTIFICATE-----", "MIIB", "-----END CERTIFICATE-----"].join("\n"),
      "utf8"
    );
    const res = await runCliCapture(["safe-run", sigWithCertEnvelope, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for .sig input with certificate-only envelope evidence");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for .sig extension-envelope mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const p7bWithCertEnvelope = path.join(tmp, "p7b_with_cert_envelope.p7b");
    fs.writeFileSync(
      p7bWithCertEnvelope,
      ["-----BEGIN CERTIFICATE-----", "MIIB", "-----END CERTIFICATE-----"].join("\n"),
      "utf8"
    );
    const res = await runCliCapture(["safe-run", p7bWithCertEnvelope, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for .p7b input with certificate-only envelope evidence");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for .p7b extension-envelope mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const unknownEnvelopePem = path.join(tmp, "unknown_envelope.pem");
    fs.writeFileSync(
      unknownEnvelopePem,
      ["-----BEGIN FOO-----", "abcd", "-----END FOO-----"].join("\n"),
      "utf8"
    );
    const res = await runCliCapture(["safe-run", unknownEnvelopePem, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for unknown PEM envelope");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for unknown envelope");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badDerLen = path.join(tmp, "bad_der_len.p7b");
    fs.writeFileSync(badDerLen, Buffer.from([0x30, 0x82, 0xff, 0xff, 0x01, 0x02, 0x03]));
    const res = await runCliCapture(["safe-run", badDerLen, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for malformed DER envelope length");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for malformed DER envelope");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const textHintsOnlySig = path.join(tmp, "text_hints_only.sig");
    fs.writeFileSync(textHintsOnlySig, "timestamp certificate-chain intermediate root-ca", "utf8");
    const res = await runCliCapture(["safe-run", textHintsOnlySig, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for text-only signature hints without real signature envelope evidence");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for text-only signature hints");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyDerSig = path.join(tmp, "tiny_der.sig");
    fs.writeFileSync(tinyDerSig, Buffer.from([0x30, 0x02, 0x01, 0x00]));
    const res = await runCliCapture(["safe-run", tinyDerSig, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for tiny generic DER without signature envelope evidence");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for tiny DER signature input");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const largeDerSig = path.join(tmp, "large_der.sig");
    const bytes = Buffer.alloc(130, 0);
    bytes[0] = 0x30;
    bytes[1] = 0x81;
    bytes[2] = 0x7f;
    fs.writeFileSync(largeDerSig, bytes);
    const res = await runCliCapture(["safe-run", largeDerSig, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for large generic DER .sig without signature envelope evidence");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for large generic DER .sig");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const cer = path.join(tmp, "sample.cer");
    const bytes = Buffer.alloc(143, 0);
    bytes[0] = 0x30;
    bytes[1] = 0x81;
    bytes[2] = 0x8c;
    Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]).copy(bytes, 20);
    fs.writeFileSync(cer, bytes);
    const res = await runCliCapture(["safe-run", cer, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 0, "safe-run should accept DER cert evidence with x509 name OID markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const cer = path.join(tmp, "no_x509.cer");
    const bytes = Buffer.alloc(143, 0);
    bytes[0] = 0x30;
    bytes[1] = 0x81;
    bytes[2] = 0x8c;
    fs.writeFileSync(cer, bytes);
    const res = await runCliCapture(["safe-run", cer, "--out", outDir, "--adapter", "signature"]);
    assertEq(res.status, 40, "safe-run should fail closed for DER cert input without x509 name OID evidence");
    assert(res.stderr.includes("SIGNATURE_FORMAT_MISMATCH"), "expected SIGNATURE_FORMAT_MISMATCH on stderr for DER cert input without x509 name OID");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const repo = path.join(tmp, "repo_unresolved");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, "file.txt"), "x", "utf8");
    const res = await runCliCapture(["safe-run", repo, "--out", outDir, "--adapter", "scm"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit scm unresolved refs");
    assert(res.stderr.includes("SCM_REF_UNRESOLVED"), "expected SCM_REF_UNRESOLVED on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const repo = path.join(tmp, "repo_partial_refs");
    const gitData = path.join(repo, ".gitdata");
    fs.mkdirSync(path.join(gitData, "refs", "tags"), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: .gitdata\n", "utf8");
    fs.writeFileSync(path.join(gitData, "HEAD"), "ref: refs/heads/main\n", "utf8");
    fs.writeFileSync(path.join(gitData, "refs", "tags", "v1.0.0"), "89abcdef0123456789abcdef0123456789abcdef\n", "utf8");
    fs.writeFileSync(path.join(repo, "file.txt"), "x", "utf8");
    const res = await runCliCapture(["safe-run", repo, "--out", outDir, "--adapter", "scm"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit scm partial native refs");
    assert(res.stderr.includes("SCM_REF_UNRESOLVED"), "expected SCM_REF_UNRESOLVED on stderr for partial native refs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badExe = path.join(tmp, "bad.exe");
    fs.writeFileSync(badExe, "not-a-pe", "utf8");
    const res = await runCliCapture(["safe-run", badExe, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package exe header mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyValidHeaderExe = path.join(tmp, "tiny_valid_header.exe");
    const bytes = Buffer.alloc(400, 0);
    bytes[0] = 0x4d;
    bytes[1] = 0x5a;
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes[0x80] = 0x50;
    bytes[0x81] = 0x45;
    bytes[0x82] = 0x00;
    bytes[0x83] = 0x00;
    bytes.writeUInt16LE(0x014c, 0x84);
    bytes.writeUInt16LE(1, 0x86);
    bytes.writeUInt16LE(0x00e0, 0x94);
    const opt = 0x98;
    bytes.writeUInt16LE(0x010b, opt);
    bytes.writeUInt32LE(16, opt + 92);
    const dataDir = opt + 96;
    const certEntry = dataDir + 8 * 4;
    bytes.writeUInt32LE(0x180, certEntry);
    bytes.writeUInt32LE(0, certEntry + 4);
    fs.writeFileSync(tinyValidHeaderExe, bytes);
    const res = await runCliCapture(["safe-run", tinyValidHeaderExe, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for exe with valid PE header but tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny exe structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badTgz = path.join(tmp, "bad.tgz");
    fs.writeFileSync(badTgz, "not-a-real-tgz", "utf8");
    const res = await runCliCapture(["safe-run", badTgz, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for compressed tar package without tar plugin");
    assert(res.stderr.includes("PACKAGE_PLUGIN_REQUIRED"), "expected PACKAGE_PLUGIN_REQUIRED on stderr for bad tgz without plugin");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "valid_package.tgz");
    writeSimpleTgz(input, [{ name: "pkg/install.sh", text: "echo ok" }]);
    if (tarAvailable()) {
      const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "package", "--enable-plugin", "tar"]);
      assertEq(res.status, 0, `safe-run should accept compressed tar package when tar plugin is enabled\n${res.stderr}`);
      const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
      assertEq(safe.adapter?.adapterId, "package_adapter_v1", "safe receipt package adapter metadata missing for plugin package tgz");
      assertEq(safe.adapter?.mode, "plugin", "safe receipt package adapter mode should be plugin for package tgz");
    }
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "case_collision_package.tgz");
    writeSimpleTgz(input, [
      { name: "PKG/Install.sh", text: "echo a" },
      { name: "pkg/install.sh", text: "echo b" },
    ]);
    if (tarAvailable()) {
      const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "package", "--enable-plugin", "tar"]);
      assertEq(res.status, 40, "safe-run should fail closed for strict package plugin route with case-colliding entry paths");
      assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for case-colliding package plugin entries");
    }
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const input = path.join(tmp, "bad.msi");
    fs.writeFileSync(input, "not-a-cfb-msi", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "package", "--enable-plugin", "tar"]);
    assertEq(res.status, 40, "safe-run should fail closed when tar plugin is supplied for non-applicable package format");
    assert(res.stderr.includes("ADAPTER_PLUGIN_UNUSED"), "expected ADAPTER_PLUGIN_UNUSED on stderr for package msi with tar plugin");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badMsi = path.join(tmp, "bad.msi");
    fs.writeFileSync(badMsi, "not-a-cfb-msi", "utf8");
    const res = await runCliCapture(["safe-run", badMsi, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package msi header mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad msi");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const magicOnlyMsi = path.join(tmp, "magic_only.msi");
    const bytes = Buffer.alloc(64, 0);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    bytes[4] = 0xa1;
    bytes[5] = 0xb1;
    bytes[6] = 0x1a;
    bytes[7] = 0xe1;
    fs.writeFileSync(magicOnlyMsi, bytes);
    const res = await runCliCapture(["safe-run", magicOnlyMsi, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for msi with magic only and invalid CFB structure");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for msi invalid CFB structure");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyValidHeaderMsi = path.join(tmp, "tiny_valid_header.msi");
    const bytes = Buffer.alloc(128, 0);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    bytes[4] = 0xa1;
    bytes[5] = 0xb1;
    bytes[6] = 0x1a;
    bytes[7] = 0xe1;
    bytes.writeUInt16LE(3, 26);
    bytes.writeUInt16LE(0xfffe, 28);
    bytes.writeUInt16LE(9, 30);
    bytes.writeUInt16LE(6, 32);
    fs.writeFileSync(tinyValidHeaderMsi, bytes);
    const res = await runCliCapture(["safe-run", tinyValidHeaderMsi, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for msi with valid header but tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny msi structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badMsix = path.join(tmp, "bad.msix");
    fs.writeFileSync(badMsix, "not-a-zip-msix", "utf8");
    const res = await runCliCapture(["safe-run", badMsix, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package msix container mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad msix");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badStructureMsix = path.join(tmp, "bad_structure.msix");
    writeStoredZip(badStructureMsix, [{ name: "file.txt", text: "x" }]);
    const res = await runCliCapture(["safe-run", badStructureMsix, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package msix missing structure");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for msix missing structure");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const nestedStructureMsix = path.join(tmp, "nested_structure.msix");
    writeStoredZip(nestedStructureMsix, [
      { name: "nested/[Content_Types].xml", text: "<Types></Types>" },
      { name: "nested/AppxManifest.xml", text: "<Package></Package>" },
    ]);
    const res = await runCliCapture(["safe-run", nestedStructureMsix, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for msix structure markers that are not at canonical root paths");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for nested msix structure markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateManifestMsix = path.join(tmp, "duplicate_manifest_markers.msix");
    writeStoredZip(duplicateManifestMsix, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "AppxManifest.xml", text: "<Package></Package>" },
      { name: "AppxBundleManifest.xml", text: "<Bundle></Bundle>" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateManifestMsix, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for msix with ambiguous multiple root manifest markers");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for ambiguous msix manifest markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateSamePathMsix = path.join(tmp, "duplicate_same_path_markers.msix");
    writeStoredZip(duplicateSamePathMsix, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "AppxManifest.xml", text: "<Package></Package>" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateSamePathMsix, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for msix with duplicate same-path required markers");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for duplicate same-path msix required markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyMsix = path.join(tmp, "tiny.msix");
    writeStoredZip(tinyMsix, [{ name: "AppxManifest.xml", text: "<Package></Package>" }]);
    const res = await runCliCapture(["safe-run", tinyMsix, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for msix with valid structure but tiny file size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny msix structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badStructureNupkg = path.join(tmp, "bad_structure.nupkg");
    writeStoredZip(badStructureNupkg, [{ name: "content/readme.txt", text: "x" }]);
    const res = await runCliCapture(["safe-run", badStructureNupkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package nupkg missing structure");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for nupkg missing structure");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const nestedNupkg = path.join(tmp, "nested_structure.nupkg");
    writeStoredZip(nestedNupkg, [{ name: "nested/demo.nuspec", text: "<package>\n" + "x".repeat(384) + "\n</package>" }]);
    const res = await runCliCapture(["safe-run", nestedNupkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for nupkg nuspec markers that are not at canonical root paths");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for nested nupkg nuspec marker path");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateNupkg = path.join(tmp, "duplicate_nuspec.nupkg");
    writeStoredZip(duplicateNupkg, [
      { name: "demo.nuspec", text: "<package>\n" + "x".repeat(384) + "\n</package>" },
      { name: "alt.nuspec", text: "<package>\n" + "y".repeat(384) + "\n</package>" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateNupkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for nupkg with multiple root nuspec markers");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for duplicate root nuspec markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyNupkg = path.join(tmp, "tiny.nupkg");
    writeStoredZip(tinyNupkg, [{ name: "demo.nuspec", text: "<package></package>" }]);
    const res = await runCliCapture(["safe-run", tinyNupkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for nupkg with valid structure but tiny file size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny nupkg structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyWhl = path.join(tmp, "tiny.whl");
    writeStoredZip(tinyWhl, [
      { name: "demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" },
      { name: "demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\n" },
    ]);
    const res = await runCliCapture(["safe-run", tinyWhl, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for whl missing required dist-info structure");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for whl missing required dist-info structure");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const nestedWhl = path.join(tmp, "nested_structure.whl");
    writeStoredZip(nestedWhl, [
      { name: "nested/demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" + "x".repeat(320) + "\n" },
      { name: "nested/demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\nTag: py3-none-any\n" + "y".repeat(160) + "\n" },
      { name: "nested/demo-1.0.dist-info/RECORD", text: "nested/demo-1.0.dist-info/METADATA,,\n" },
    ]);
    const res = await runCliCapture(["safe-run", nestedWhl, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for whl dist-info markers that are not at canonical root paths");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for nested whl dist-info marker paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateWhl = path.join(tmp, "duplicate_dist_info.whl");
    writeStoredZip(duplicateWhl, [
      { name: "demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" + "x".repeat(320) + "\n" },
      { name: "demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\nTag: py3-none-any\n" + "y".repeat(160) + "\n" },
      { name: "demo-1.0.dist-info/RECORD", text: "demo-1.0.dist-info/METADATA,,\n" },
      { name: "alt-1.0.dist-info/METADATA", text: "Name: alt\nVersion: 1.0.0\n" + "z".repeat(320) + "\n" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateWhl, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for whl with ambiguous multiple dist-info metadata markers");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for duplicate whl dist-info metadata markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyJar = path.join(tmp, "tiny.jar");
    writeStoredZip(tinyJar, [{ name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" }]);
    const res = await runCliCapture(["safe-run", tinyJar, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for jar with valid structure but tiny file size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny jar structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateManifestJar = path.join(tmp, "duplicate_manifest.jar");
    writeStoredZip(duplicateManifestJar, [
      { name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" },
      { name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateManifestJar, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for jar with duplicate same-path manifest entries");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for duplicate same-path jar manifest entries");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const caseCollisionJar = path.join(tmp, "case_collision.jar");
    writeStoredZip(caseCollisionJar, [
      { name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\nMain-Class: demo.Main\n" + "z".repeat(256) + "\n" },
      { name: "lib/Alpha.class", text: "a" },
      { name: "lib/alpha.class", text: "b" },
    ]);
    const res = await runCliCapture(["safe-run", caseCollisionJar, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for jar with case-colliding package entry paths");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for case-colliding package entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialNupkg = path.join(tmp, "partial.nupkg");
    writeStoredZip(partialNupkg, [
      { name: "demo.nuspec", text: "<package></package>" },
      { name: "content/readme.txt", text: "x" },
    ]);
    corruptSecondZipCentralSignature(partialNupkg);
    const res = await runCliCapture(["safe-run", partialNupkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed when package ZIP metadata is partial after parsed entries");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for partial package zip metadata");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badDeb = path.join(tmp, "bad.deb");
    fs.writeFileSync(badDeb, "not-an-ar-deb", "utf8");
    const res = await runCliCapture(["safe-run", badDeb, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package deb container mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad deb");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badStructureDeb = path.join(tmp, "bad_structure.deb");
    writeSimpleAr(badStructureDeb, [
      { name: "random.txt", bytes: Buffer.from("x", "utf8") },
      { name: "payload.bin", bytes: Buffer.from("y", "utf8") },
    ]);
    const res = await runCliCapture(["safe-run", badStructureDeb, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package deb missing required structure entries");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for deb missing structure");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateStructureDeb = path.join(tmp, "duplicate_structure.deb");
    writeSimpleAr(duplicateStructureDeb, [
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "control.tar.gz", bytes: Buffer.from("fake-control-".repeat(24), "utf8") },
      { name: "data.tar.xz", bytes: Buffer.from("fake-data-".repeat(24), "utf8") },
    ]);
    const res = await runCliCapture(["safe-run", duplicateStructureDeb, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for deb with duplicate required structure entries");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for duplicate deb structure entries");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyStubDeb = path.join(tmp, "tiny_stub.deb");
    writeSimpleAr(tinyStubDeb, [
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "control.tar.gz", bytes: Buffer.from("x", "utf8") },
      { name: "data.tar.xz", bytes: Buffer.from("y", "utf8") },
    ]);
    const res = await runCliCapture(["safe-run", tinyStubDeb, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for deb with required entries but tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny deb structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badRpm = path.join(tmp, "bad.rpm");
    fs.writeFileSync(badRpm, "not-an-rpm", "utf8");
    const res = await runCliCapture(["safe-run", badRpm, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package rpm header mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad rpm");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const leadOnlyRpm = path.join(tmp, "lead_only.rpm");
    const bytes = Buffer.alloc(128, 0);
    bytes[0] = 0xed;
    bytes[1] = 0xab;
    bytes[2] = 0xee;
    bytes[3] = 0xdb;
    fs.writeFileSync(leadOnlyRpm, bytes);
    const res = await runCliCapture(["safe-run", leadOnlyRpm, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for rpm missing signature header magic");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for rpm missing header magic");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyMagicRpm = path.join(tmp, "tiny_magic.rpm");
    const bytes = Buffer.alloc(128, 0);
    bytes[0] = 0xed;
    bytes[1] = 0xab;
    bytes[2] = 0xee;
    bytes[3] = 0xdb;
    bytes[96] = 0x8e;
    bytes[97] = 0xad;
    bytes[98] = 0xe8;
    fs.writeFileSync(tinyMagicRpm, bytes);
    const res = await runCliCapture(["safe-run", tinyMagicRpm, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for rpm with marker bytes but tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny rpm structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badAppImage = path.join(tmp, "bad.appimage");
    fs.writeFileSync(badAppImage, "not-an-elf-appimage", "utf8");
    const res = await runCliCapture(["safe-run", badAppImage, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package appimage header mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad appimage");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const elfOnlyAppImage = path.join(tmp, "elf_only.appimage");
    const bytes = Buffer.alloc(512, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    fs.writeFileSync(elfOnlyAppImage, bytes);
    const res = await runCliCapture(["safe-run", elfOnlyAppImage, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for appimage missing marker");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for appimage missing marker");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyValidAppImage = path.join(tmp, "tiny_valid.appimage");
    const bytes = Buffer.alloc(64, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    bytes[8] = 0x41;
    bytes[9] = 0x49;
    bytes[10] = 0x02;
    fs.writeFileSync(tinyValidAppImage, bytes);
    const res = await runCliCapture(["safe-run", tinyValidAppImage, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for appimage with valid markers but tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny appimage structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badPkg = path.join(tmp, "bad.pkg");
    fs.writeFileSync(badPkg, "not-a-xar", "utf8");
    const res = await runCliCapture(["safe-run", badPkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package pkg header mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad pkg");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badHeaderPkg = path.join(tmp, "bad_header.pkg");
    const bytes = Buffer.alloc(32, 0);
    Buffer.from("xar!", "ascii").copy(bytes, 0);
    fs.writeFileSync(badHeaderPkg, bytes);
    const res = await runCliCapture(["safe-run", badHeaderPkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package pkg invalid xar header fields");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for invalid pkg header");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyValidHeaderPkg = path.join(tmp, "tiny_valid_header.pkg");
    const bytes = Buffer.alloc(64, 0);
    Buffer.from("xar!", "ascii").copy(bytes, 0);
    bytes.writeUInt16BE(28, 4);
    bytes.writeUInt16BE(1, 6);
    fs.writeFileSync(tinyValidHeaderPkg, bytes);
    const res = await runCliCapture(["safe-run", tinyValidHeaderPkg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for pkg with valid header but tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny pkg structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badDmg = path.join(tmp, "bad.dmg");
    fs.writeFileSync(badDmg, "not-a-dmg-trailer", "utf8");
    const res = await runCliCapture(["safe-run", badDmg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for package dmg trailer mismatch");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for bad dmg");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const misplacedKolyDmg = path.join(tmp, "misplaced_koly.dmg");
    const bytes = Buffer.alloc(8192, 0);
    Buffer.from("koly", "ascii").copy(bytes, bytes.length - 128);
    fs.writeFileSync(misplacedKolyDmg, bytes);
    const res = await runCliCapture(["safe-run", misplacedKolyDmg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed when dmg koly marker is misplaced");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for misplaced dmg koly");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyKolyDmg = path.join(tmp, "tiny_koly.dmg");
    const bytes = Buffer.alloc(512, 0);
    Buffer.from("koly", "ascii").copy(bytes, 0);
    fs.writeFileSync(tinyKolyDmg, bytes);
    const res = await runCliCapture(["safe-run", tinyKolyDmg, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for dmg trailer marker with tiny structural size");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for tiny dmg structural size");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const res = await runCliCapture(["safe-run", tmp, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for extension directory without manifest");
    assert(res.stderr.includes("EXTENSION_MANIFEST_MISSING"), "expected EXTENSION_MANIFEST_MISSING on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    fs.writeFileSync(path.join(tmp, "manifest.json"), "{ invalid-json", "utf8");
    const res = await runCliCapture(["safe-run", tmp, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for invalid extension manifest");
    assert(res.stderr.includes("EXTENSION_MANIFEST_INVALID"), "expected EXTENSION_MANIFEST_INVALID on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({}), "utf8");
    const res = await runCliCapture(["safe-run", tmp, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for extension manifest missing core fields");
    assert(res.stderr.includes("EXTENSION_MANIFEST_INVALID"), "expected EXTENSION_MANIFEST_INVALID on stderr for missing core fields");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const emptyManifestVsix = path.join(tmp, "empty_manifest.vsix");
    writeStoredZip(emptyManifestVsix, [{ name: "manifest.json", text: "{}" }]);
    const res = await runCliCapture(["safe-run", emptyManifestVsix, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for extension package manifest missing core fields");
    assert(res.stderr.includes("EXTENSION_MANIFEST_INVALID"), "expected EXTENSION_MANIFEST_INVALID on stderr for extension package missing core fields");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const zipPath = path.join(tmp, "payload.zip");
    const crx = path.join(tmp, "demo.crx");
    writeStoredZip(zipPath, [
      {
        name: "manifest.json",
        text: JSON.stringify({
          manifest_version: 3,
          name: "demo-crx",
          version: "1.0.0",
          permissions: ["storage"],
        }),
      },
    ]);
    const zipBytes = fs.readFileSync(zipPath);
    const header = Buffer.alloc(12, 0);
    header[0] = 0x43;
    header[1] = 0x72;
    header[2] = 0x32;
    header[3] = 0x34;
    header.writeUInt32LE(3, 4);
    header.writeUInt32LE(0, 8);
    fs.writeFileSync(crx, Buffer.concat([header, zipBytes]));
    const res = await runCliCapture(["safe-run", crx, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 0, `safe-run should accept valid CRX wrapper with ZIP payload\n${res.stderr}`);
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const crx = path.join(tmp, "bad.crx");
    const header = Buffer.alloc(12, 0);
    header[0] = 0x43;
    header[1] = 0x72;
    header[2] = 0x32;
    header[3] = 0x34;
    header.writeUInt32LE(3, 4);
    header.writeUInt32LE(0, 8);
    fs.writeFileSync(crx, Buffer.concat([header, Buffer.from("not-a-zip", "utf8")]));
    const res = await runCliCapture(["safe-run", crx, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for CRX wrapper with invalid ZIP payload");
    assert(res.stderr.includes("EXTENSION_FORMAT_MISMATCH"), "expected EXTENSION_FORMAT_MISMATCH on stderr for bad crx");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badVsix = path.join(tmp, "bad.vsix");
    fs.writeFileSync(badVsix, "not-a-zip-extension", "utf8");
    const res = await runCliCapture(["safe-run", badVsix, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for invalid explicit extension package structure");
    assert(res.stderr.includes("EXTENSION_FORMAT_MISMATCH"), "expected EXTENSION_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialVsix = path.join(tmp, "partial_extension.vsix");
    writeStoredZip(partialVsix, [
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo", version: "1.0.0" }) },
      { name: "background.js", text: "console.log('x');" },
    ]);
    corruptSecondZipCentralSignature(partialVsix);
    const res = await runCliCapture(["safe-run", partialVsix, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed when extension ZIP metadata is partial after parsed entries");
    assert(res.stderr.includes("EXTENSION_FORMAT_MISMATCH"), "expected EXTENSION_FORMAT_MISMATCH on stderr for partial extension zip metadata");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const nestedVsix = path.join(tmp, "nested_manifest.vsix");
    writeStoredZip(nestedVsix, [
      { name: "extension/manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo", version: "1.0.0" }) },
    ]);
    const res = await runCliCapture(["safe-run", nestedVsix, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed when extension manifest is not at canonical root path");
    assert(res.stderr.includes("EXTENSION_MANIFEST_MISSING"), "expected EXTENSION_MANIFEST_MISSING on stderr for nested manifest path");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateVsix = path.join(tmp, "duplicate_manifest.vsix");
    writeStoredZip(duplicateVsix, [
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo-a", version: "1.0.0" }) },
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo-b", version: "1.0.1" }) },
    ]);
    const res = await runCliCapture(["safe-run", duplicateVsix, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for duplicate root extension manifest entries");
    assert(res.stderr.includes("EXTENSION_FORMAT_MISMATCH"), "expected EXTENSION_FORMAT_MISMATCH on stderr for duplicate manifest entries");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const caseCollisionVsix = path.join(tmp, "case_collision_entries.vsix");
    writeStoredZip(caseCollisionVsix, [
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo", version: "1.0.0" }) },
      { name: "scripts/Alpha.js", text: "console.log('a');" },
      { name: "scripts/alpha.js", text: "console.log('b');" },
    ]);
    const res = await runCliCapture(["safe-run", caseCollisionVsix, "--out", outDir, "--adapter", "extension"]);
    assertEq(res.status, 40, "safe-run should fail closed for case-colliding extension package entry paths");
    assert(res.stderr.includes("EXTENSION_FORMAT_MISMATCH"), "expected EXTENSION_FORMAT_MISMATCH on stderr for case-colliding extension package entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badIso = path.join(tmp, "bad.iso");
    fs.writeFileSync(badIso, "not-an-iso", "utf8");
    const badRes = await runCliCapture(["safe-run", badIso, "--out", outDir, "--adapter", "image"]);
    assertEq(badRes.status, 40, "safe-run should fail closed for image header mismatch");
    assert(badRes.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const iso = path.join(tmp, "sample.iso");
    const bytes = Buffer.alloc(18 * 2048, 0);
    bytes[16 * 2048] = 1;
    Buffer.from("CD001", "ascii").copy(bytes, 16 * 2048 + 1);
    bytes[16 * 2048 + 6] = 1;
    bytes[17 * 2048] = 255;
    Buffer.from("CD001", "ascii").copy(bytes, 17 * 2048 + 1);
    bytes[17 * 2048 + 6] = 1;
    fs.writeFileSync(iso, bytes);
    const res = await runCliCapture(["safe-run", iso, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 0, "safe-run should accept explicit iso with pvd and terminator evidence");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const iso = path.join(tmp, "no_terminator.iso");
    const bytes = Buffer.alloc(18 * 2048, 0);
    bytes[16 * 2048] = 1;
    Buffer.from("CD001", "ascii").copy(bytes, 16 * 2048 + 1);
    bytes[16 * 2048 + 6] = 1;
    fs.writeFileSync(iso, bytes);
    const res = await runCliCapture(["safe-run", iso, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit iso missing descriptor terminator");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for iso missing terminator");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const vhd = path.join(tmp, "sample.vhd");
    const bytes = Buffer.alloc(1024, 0);
    Buffer.from("conectix", "ascii").copy(bytes, bytes.length - 512);
    fs.writeFileSync(vhd, bytes);
    const res = await runCliCapture(["safe-run", vhd, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 0, "safe-run should accept explicit vhd with minimum structural footer evidence");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyVhd = path.join(tmp, "tiny.vhd");
    const bytes = Buffer.alloc(512, 0);
    Buffer.from("conectix", "ascii").copy(bytes, 0);
    fs.writeFileSync(tinyVhd, bytes);
    const res = await runCliCapture(["safe-run", tinyVhd, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for vhd footer-only file below structural minimum");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for tiny vhd");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badQcow = path.join(tmp, "bad_version.qcow2");
    const bytes = Buffer.alloc(32, 0);
    bytes[0] = 0x51;
    bytes[1] = 0x46;
    bytes[2] = 0x49;
    bytes[3] = 0xfb;
    bytes.writeUInt32BE(1, 4); // unsupported qcow2 version
    fs.writeFileSync(badQcow, bytes);
    const res = await runCliCapture(["safe-run", badQcow, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for unsupported qcow2 version");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for unsupported qcow2 version");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyQcow = path.join(tmp, "tiny_valid_header.qcow2");
    const bytes = Buffer.alloc(16, 0);
    bytes[0] = 0x51;
    bytes[1] = 0x46;
    bytes[2] = 0x49;
    bytes[3] = 0xfb;
    bytes.writeUInt32BE(3, 4);
    fs.writeFileSync(tinyQcow, bytes);
    const res = await runCliCapture(["safe-run", tinyQcow, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for qcow2 header that is structurally too small");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for tiny qcow2");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyVhdx = path.join(tmp, "tiny.vhdx");
    const bytes = Buffer.alloc(256, 0);
    Buffer.from("vhdxfile", "ascii").copy(bytes, 0);
    fs.writeFileSync(tinyVhdx, bytes);
    const res = await runCliCapture(["safe-run", tinyVhdx, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for vhdx signature-only file below structural minimum");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for tiny vhdx");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const weakVmdk = path.join(tmp, "weak_hints.vmdk");
    fs.writeFileSync(weakVmdk, "createType=\"monolithicSparse\"\n", "utf8");
    const res = await runCliCapture(["safe-run", weakVmdk, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for weak vmdk descriptor hints");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for weak vmdk descriptor hints");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const tinyDescriptorVmdk = path.join(tmp, "tiny_descriptor.vmdk");
    fs.writeFileSync(tinyDescriptorVmdk, "# Disk DescriptorFile\ncreateType=\"x\"\nRW 1 SPARSE \"a\"\n", "utf8");
    const res = await runCliCapture(["safe-run", tinyDescriptorVmdk, "--out", outDir, "--adapter", "image"]);
    assertEq(res.status, 40, "safe-run should fail closed for tiny vmdk descriptor-only file below structural minimum");
    assert(res.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr for tiny vmdk descriptor-only file");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const textMarkerOnlyAppImage = path.join(tmp, "text_marker_only.appimage");
    const bytes = Buffer.alloc(1024, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    Buffer.from("AppImage runtime", "ascii").copy(bytes, 128); // non-canonical location
    fs.writeFileSync(textMarkerOnlyAppImage, bytes);
    const res = await runCliCapture(["safe-run", textMarkerOnlyAppImage, "--out", outDir, "--adapter", "package"]);
    assertEq(res.status, 40, "safe-run should fail closed for loose AppImage text marker without runtime magic");
    assert(res.stderr.includes("PACKAGE_FORMAT_MISMATCH"), "expected PACKAGE_FORMAT_MISMATCH on stderr for loose AppImage text marker");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    fs.mkdirSync(path.join(tmp, "oci_image"));
    fs.mkdirSync(path.join(tmp, "oci_image", "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "oci_image", "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(tmp, "oci_image", "index.json"),
      "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]}\n",
      "utf8"
    );
    fs.writeFileSync(path.join(tmp, "oci_image", "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    const res = await runCliCapture(["safe-run", path.join(tmp, "oci_image"), "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 0, `safe-run container should succeed\n${res.stderr}`);
    const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(safe.adapter?.adapterId, "container_adapter_v1", "container adapter id mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_missing_blobs");
    fs.mkdirSync(ociDir, { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI layout with manifests but missing blobs");
    assert(res.stderr.includes("CONTAINER_LAYOUT_INVALID"), "expected CONTAINER_LAYOUT_INVALID on stderr for missing OCI blobs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_digest_mismatch");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]}\n",
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "x", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI layout digest mismatch");
    assert(res.stderr.includes("CONTAINER_LAYOUT_INVALID"), "expected CONTAINER_LAYOUT_INVALID on stderr for OCI digest mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_missing_digest_refs");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n",
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI layout missing digest refs");
    assert(res.stderr.includes("CONTAINER_LAYOUT_INVALID"), "expected CONTAINER_LAYOUT_INVALID on stderr for OCI layout missing digest refs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_partial_digest_refs");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n",
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI layout partial digest refs");
    assert(res.stderr.includes("CONTAINER_LAYOUT_INVALID"), "expected CONTAINER_LAYOUT_INVALID on stderr for OCI layout partial digest refs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTar = path.join(tmp, "oci_layout.tar");
    writeSimpleTar(ociTar, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"size\":1}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const res = await runCliCapture(["safe-run", ociTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 0, `safe-run should accept explicit OCI tar markers\n${res.stderr}`);
    const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(safe.adapter?.adapterId, "container_adapter_v1", "container adapter metadata missing for OCI tar");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarMissingBlobs = path.join(tmp, "oci_layout_missing_blobs.tar");
    writeSimpleTar(ociTarMissingBlobs, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      { name: "index.json", text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarMissingBlobs, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for OCI tar markers without blobs");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar missing blobs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarDigestMismatch = path.join(tmp, "oci_layout_digest_mismatch.tar");
    writeSimpleTar(ociTarDigestMismatch, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"size\":1}]}\n",
      },
      { name: "blobs/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", text: "x" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarDigestMismatch, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI tar digest mismatch");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar digest mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarDuplicateBlobRefPath = path.join(tmp, "oci_layout_duplicate_blob_ref_path.tar");
    writeSimpleTar(ociTarDuplicateBlobRefPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"size\":1}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x1" },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x2" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarDuplicateBlobRefPath, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI tar duplicate referenced blob path");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar duplicate blob reference path");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarMissingDigestRefs = path.join(tmp, "oci_layout_missing_digest_refs.tar");
    writeSimpleTar(ociTarMissingDigestRefs, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      { name: "index.json", text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"size\":1}]}\n" },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarMissingDigestRefs, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI tar missing digest refs");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar missing digest refs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarPartialDigestRefs = path.join(tmp, "oci_layout_partial_digest_refs.tar");
    writeSimpleTar(ociTarPartialDigestRefs, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarPartialDigestRefs, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI tar partial digest refs");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar partial digest refs");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarNestedMarkers = path.join(tmp, "oci_layout_nested_markers.tar");
    writeSimpleTar(ociTarNestedMarkers, [
      { name: "nested/oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "nested/index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarNestedMarkers, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI tar nested marker paths");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar nested marker paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociTarDuplicateRootMarkers = path.join(tmp, "oci_layout_duplicate_root_markers.tar");
    writeSimpleTar(ociTarDuplicateRootMarkers, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const res = await runCliCapture(["safe-run", ociTarDuplicateRootMarkers, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI tar duplicate root markers");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for OCI tar duplicate root markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badTar = path.join(tmp, "bad_container.tar");
    fs.writeFileSync(badTar, "not-a-container-tar", "utf8");
    const res = await runCliCapture(["safe-run", badTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit container tar mismatch");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for bad container tar");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const hintedTar = path.join(tmp, "manifest.json_only.tar");
    writeSimpleTar(hintedTar, [{ name: "notes.txt", text: "not a container tar" }]);
    const res = await runCliCapture(["safe-run", hintedTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for docker-marker tar filename hints without marker entries");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for docker-marker tar filename hint");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const noLayerTar = path.join(tmp, "container_no_layer.tar");
    writeSimpleTar(noLayerTar, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "notes.txt", text: "placeholder" },
    ]);
    const res = await runCliCapture(["safe-run", noLayerTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar markers without layer tar evidence");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for docker tar missing layer evidence");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const invalidManifestTar = path.join(tmp, "container_invalid_manifest_json.tar");
    writeSimpleTar(invalidManifestTar, [
      { name: "manifest.json", text: "[]" },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", invalidManifestTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar invalid manifest payload");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for invalid docker manifest payload");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const invalidRepositoriesTar = path.join(tmp, "container_invalid_repositories_map.tar");
    writeSimpleTar(invalidRepositoriesTar, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: {} }) },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", invalidRepositoriesTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar invalid repositories tag map");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for invalid repositories tag map");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const missingConfigTar = path.join(tmp, "container_missing_config_ref.tar");
    writeSimpleTar(missingConfigTar, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", missingConfigTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar unresolved config reference");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for unresolved docker config reference");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialLayerResolutionTar = path.join(tmp, "container_partial_layer_resolution.tar");
    writeSimpleTar(partialLayerResolutionTar, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar", "missing/layer.tar"] }]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", partialLayerResolutionTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar partial layer reference resolution");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for partial docker layer resolution");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialConfigResolutionTar = path.join(tmp, "container_partial_config_resolution.tar");
    writeSimpleTar(partialConfigResolutionTar, [
      {
        name: "manifest.json",
        text: JSON.stringify([
          { Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] },
          { Config: "missing.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] },
        ]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", partialConfigResolutionTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar partial config reference resolution");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for partial docker config resolution");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const nestedMarkersTar = path.join(tmp, "container_nested_markers.tar");
    writeSimpleTar(nestedMarkersTar, [
      {
        name: "nested/manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "nested/repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", nestedMarkersTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar nested marker paths");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for docker tar nested marker paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateRootMarkersTar = path.join(tmp, "container_duplicate_root_markers.tar");
    writeSimpleTar(duplicateRootMarkersTar, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateRootMarkersTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar duplicate root markers");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for docker tar duplicate root markers");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const caseCollisionTar = path.join(tmp, "container_case_collision_paths.tar");
    writeSimpleTar(caseCollisionTar, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
      { name: "extra/Alpha.txt", text: "a" },
      { name: "extra/alpha.txt", text: "b" },
    ]);
    const res = await runCliCapture(["safe-run", caseCollisionTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar case-colliding top-level entry paths");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for case-colliding container tar entry paths");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialManifestEntryShapeTar = path.join(tmp, "container_partial_manifest_entry_shape.tar");
    writeSimpleTar(partialManifestEntryShapeTar, [
      {
        name: "manifest.json",
        text: JSON.stringify([
          { Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] },
          { Config: "missing-config.json", RepoTags: ["demo:latest"], Layers: [] },
        ]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const res = await runCliCapture(["safe-run", partialManifestEntryShapeTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar partial manifest entry shape");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for docker tar partial manifest entry shape");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const duplicateLayerRefPathTar = path.join(tmp, "container_duplicate_layer_ref_path.tar");
    writeSimpleTar(duplicateLayerRefPathTar, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes-a" },
      { name: "layer.tar", text: "layer-bytes-b" },
    ]);
    const res = await runCliCapture(["safe-run", duplicateLayerRefPathTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit docker tar duplicate referenced layer path");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for docker tar duplicate referenced layer path");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const partialTar = path.join(tmp, "partial_container.tar");
    writeSimpleTar(partialTar, [
      { name: "manifest.json", text: "[]" },
      { name: "repositories", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    fs.appendFileSync(partialTar, Buffer.alloc(512, 0x41));
    const res = await runCliCapture(["safe-run", partialTar, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit container tar with partial metadata");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for partial container tar metadata");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badCompose = path.join(tmp, "compose.yaml");
    fs.writeFileSync(badCompose, "not compose syntax", "utf8");
    const res = await runCliCapture(["safe-run", badCompose, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit container compose mismatch");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for bad compose");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const placeholderCompose = path.join(tmp, "compose.yaml");
    fs.writeFileSync(placeholderCompose, "services:\n  web:\n    restart: always\n", "utf8");
    const res = await runCliCapture(["safe-run", placeholderCompose, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for compose placeholder without image/build hints");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for compose placeholder");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const outOfServiceImageCompose = path.join(tmp, "compose.yaml");
    fs.writeFileSync(outOfServiceImageCompose, "services:\n  web:\n    restart: always\nimage: nginx:latest\n", "utf8");
    const res = await runCliCapture(["safe-run", outOfServiceImageCompose, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed when compose image hint is outside service block");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for compose image hint outside service block");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const shallowCompose = path.join(tmp, "compose.yaml");
    fs.writeFileSync(shallowCompose, "services:\nimage: nginx:latest\n", "utf8");
    const res = await runCliCapture(["safe-run", shallowCompose, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for compose shell without indented service entries");
    assert(res.stderr.includes("CONTAINER_FORMAT_MISMATCH"), "expected CONTAINER_FORMAT_MISMATCH on stderr for compose shell without service entries");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const buildCompose = path.join(tmp, "compose.yaml");
    fs.writeFileSync(buildCompose, "services:\n  web:\n    build: .\n", "utf8");
    const res = await runCliCapture(["safe-run", buildCompose, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 0, "safe-run should accept compose with services and build hint");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_bad_layout");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{ invalid-json", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), "{\"schemaVersion\":2,\"manifests\":[]}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI layout metadata invalidity");
    assert(res.stderr.includes("CONTAINER_LAYOUT_INVALID"), "expected CONTAINER_LAYOUT_INVALID on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_bad_index");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), "{ invalid-json", "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI index parse invalidity");
    assert(res.stderr.includes("CONTAINER_INDEX_INVALID"), "expected CONTAINER_INDEX_INVALID on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_empty_manifests");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), "{\"schemaVersion\":2,\"manifests\":[]}\n", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI index with empty manifests");
    assert(res.stderr.includes("CONTAINER_INDEX_INVALID"), "expected CONTAINER_INDEX_INVALID on stderr for empty manifests");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_bad_manifest_shape");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), "{\"schemaVersion\":2,\"manifests\":{}}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    const res = await runCliCapture(["safe-run", ociDir, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit OCI index manifests shape mismatch");
    assert(res.stderr.includes("CONTAINER_INDEX_INVALID"), "expected CONTAINER_INDEX_INVALID on stderr for OCI index manifests shape mismatch");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const badSbom = path.join(tmp, "bad_sbom.json");
    fs.writeFileSync(badSbom, "{ invalid-json", "utf8");
    const res = await runCliCapture(["safe-run", badSbom, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit container sbom parse invalidity");
    assert(res.stderr.includes("CONTAINER_SBOM_INVALID"), "expected CONTAINER_SBOM_INVALID on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const emptySbom = path.join(tmp, "empty_sbom.spdx.json");
    fs.writeFileSync(emptySbom, "{\"SPDXID\":\"SPDXRef-DOCUMENT\",\"packages\":[]}\n", "utf8");
    const res = await runCliCapture(["safe-run", emptySbom, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit empty sbom package evidence");
    assert(res.stderr.includes("CONTAINER_SBOM_INVALID"), "expected CONTAINER_SBOM_INVALID on stderr for empty sbom evidence");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    const shellSbom = path.join(tmp, "shell_sbom.spdx.json");
    fs.writeFileSync(
      shellSbom,
      JSON.stringify({
        SPDXID: "SPDXRef-DOCUMENT",
        packages: [{}],
        components: [{ "bom-ref": "   " }],
      }),
      "utf8"
    );
    const res = await runCliCapture(["safe-run", shellSbom, "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 40, "safe-run should fail closed for explicit sbom with non-meaningful package/component shells");
    assert(res.stderr.includes("CONTAINER_SBOM_INVALID"), "expected CONTAINER_SBOM_INVALID on stderr for non-meaningful sbom shells");
  }
};

run()
  .then(() => {
    console.log("adapter_cli_smoke.test: PASS");
  })
  .catch((error) => {
    console.error("adapter_cli_smoke.test: FAIL");
    console.error(error);
    process.exit(1);
  });
