/* src/runtime/adapters/artifact_adapter_v1.test.ts */

import { captureTreeV0 } from "../examiner/capture_tree_v0";
import { runArtifactAdapterV1 } from "./artifact_adapter_v1";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const zlib = require("zlib");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-adapter-v1-"));

const runCmd = (cmd: string, args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } => {
  const res = childProcess.spawnSync(cmd, args, {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: typeof res.status === "number" && res.status === 0,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
};

const writeStoredZip = (outPath: string, files: Array<{ name: string; text: string }>): void => {
  const localParts: any[] = [];
  const centralParts: any[] = [];
  let localOffset = 0;
  files.forEach((file) => {
    const nameBuf = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const dataBuf = Buffer.from(file.text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mtime
    local.writeUInt16LE(0, 12); // mdate
    local.writeUInt32LE(0, 14); // crc32 (not required for adapter parser)
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mtime
    central.writeUInt16LE(0, 14); // mdate
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuf);

    localOffset += local.length + nameBuf.length + dataBuf.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(files.length, 8); // records on disk
  eocd.writeUInt16LE(files.length, 10); // total records
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localOffset, 16); // central offset
  eocd.writeUInt16LE(0, 20); // comment len
  fs.writeFileSync(outPath, Buffer.concat([...localParts, ...centralParts, eocd]));
};

const corruptSecondZipCentralSignature = (zipPath: string): void => {
  const bytes = fs.readFileSync(zipPath);
  const centralOffsets: number[] = [];
  for (let i = 0; i <= Math.max(0, bytes.length - 4); i += 1) {
    if (bytes.readUInt32LE(i) === 0x02014b50) centralOffsets.push(i);
  }
  if (centralOffsets.length < 2) throw new Error("test setup failed: missing second central directory entry");
  bytes.writeUInt32LE(0x41414141, centralOffsets[1]);
  fs.writeFileSync(zipPath, bytes);
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
    for (let i = 148; i < 156; i += 1) header[i] = 0x20; // checksum placeholder
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

const writeMinimalPe = (outPath: string, certSize: number): void => {
  const bytes = Buffer.alloc(1024, 0);
  bytes[0] = 0x4d; // M
  bytes[1] = 0x5a; // Z
  bytes.writeUInt32LE(0x80, 0x3c); // pe offset
  bytes[0x80] = 0x50; // P
  bytes[0x81] = 0x45; // E
  bytes[0x82] = 0x00;
  bytes[0x83] = 0x00;
  bytes.writeUInt16LE(0x014c, 0x84); // machine
  bytes.writeUInt16LE(1, 0x86); // sections
  bytes.writeUInt16LE(0x00e0, 0x94); // size optional header
  const opt = 0x98;
  bytes.writeUInt16LE(0x010b, opt); // PE32
  bytes.writeUInt32LE(16, opt + 92); // numberOfRvaAndSizes
  const dataDir = opt + 96;
  const certEntry = dataDir + 8 * 4;
  bytes.writeUInt32LE(0x200, certEntry); // cert table file offset
  bytes.writeUInt32LE(Math.max(0, certSize), certEntry + 4); // cert size
  fs.writeFileSync(outPath, bytes);
};

const limits = {
  maxFiles: 20000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 256,
};

const run = (): void => {
  {
    const tmp = mkTmp();
    const input = path.join(tmp, "good.zip");
    writeStoredZip(input, [
      { name: "a.txt", text: "alpha" },
      { name: "b/c.txt", text: "beta" },
    ]);
    const captureA = captureTreeV0(input, limits);
    const captureB = captureTreeV0(input, limits);
    const resA = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: input, capture: captureA });
    const resB = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: input, capture: captureB });
    assert(resA.ok, "archive adapter should succeed");
    assert(resB.ok, "archive adapter should succeed");
    assertEq(JSON.stringify(resA.summary), JSON.stringify(resB.summary), "archive adapter summary should be deterministic");
    assertEq(resA.adapter?.adapterId, "archive_adapter_v1", "archive adapter id mismatch");
  }

  {
    const tmp = mkTmp();
    const tgz = path.join(tmp, "sample.tgz");
    fs.writeFileSync(tgz, "not-a-real-tgz", "utf8");
    const capture = captureTreeV0(tgz, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: tgz, capture });
    assert(!res.ok, "archive tgz without plugin should fail closed");
    assertEq(res.failCode, "ARCHIVE_PLUGIN_REQUIRED", "expected plugin required code");
  }

  {
    const tmp = mkTmp();
    const tbzAlias = path.join(tmp, "sample.tbz2");
    fs.writeFileSync(tbzAlias, "not-a-real-tbz2", "utf8");
    const capture = captureTreeV0(tbzAlias, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: tbzAlias, capture });
    assert(!res.ok, "archive tbz2 alias without plugin should fail closed");
    assertEq(res.failCode, "ARCHIVE_PLUGIN_REQUIRED", "expected plugin required code for tbz2 alias");
  }

  {
    const tmp = mkTmp();
    const tgz = path.join(tmp, "case_collision_plugin.tgz");
    writeSimpleTgz(tgz, [
      { name: "A.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const capture = captureTreeV0(tgz, limits);
    const tarAvailable = runCmd("tar", ["--help"]).ok;
    if (tarAvailable) {
      const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: ["tar"], inputPath: tgz, capture });
      assert(!res.ok, "archive adapter should fail closed for strict plugin route with case-colliding entry paths");
      assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for case-colliding plugin archive entries");
    }
  }

  {
    const tmp = mkTmp();
    const badTar = path.join(tmp, "bad.tar");
    fs.writeFileSync(badTar, "not-a-tar", "utf8");
    const capture = captureTreeV0(badTar, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: badTar, capture });
    assert(!res.ok, "archive adapter should fail closed for explicit invalid tar structure");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for invalid tar");
  }

  {
    const tmp = mkTmp();
    const partialTar = path.join(tmp, "partial_after_entries.tar");
    writeSimpleTar(partialTar, [{ name: "a.txt", text: "alpha" }]);
    fs.appendFileSync(partialTar, Buffer.alloc(512, 0x41));
    const capture = captureTreeV0(partialTar, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: partialTar, capture });
    assert(!res.ok, "archive adapter should fail closed when tar metadata is partial after parsed entries");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for partial tar metadata");
  }

  {
    const tmp = mkTmp();
    const badZip = path.join(tmp, "bad.zip");
    fs.writeFileSync(badZip, "not-a-zip", "utf8");
    const capture = captureTreeV0(badZip, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: badZip, capture });
    assert(!res.ok, "archive adapter should fail closed for explicit invalid zip signature");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for invalid zip");
  }

  {
    const tmp = mkTmp();
    const partialZip = path.join(tmp, "partial_after_entries.zip");
    writeStoredZip(partialZip, [
      { name: "a.txt", text: "alpha" },
      { name: "b.txt", text: "beta" },
    ]);
    corruptSecondZipCentralSignature(partialZip);
    const capture = captureTreeV0(partialZip, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: partialZip, capture });
    assert(!res.ok, "archive adapter should fail closed when zip central metadata is partial after parsed entries");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for partial zip metadata");
  }

  {
    const tmp = mkTmp();
    const duplicateZip = path.join(tmp, "duplicate_paths.zip");
    writeStoredZip(duplicateZip, [
      { name: "a.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const capture = captureTreeV0(duplicateZip, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: duplicateZip, capture });
    assert(!res.ok, "archive adapter should fail closed for strict zip route with duplicate entry paths");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for duplicate zip entry paths");
  }

  {
    const tmp = mkTmp();
    const caseCollisionZip = path.join(tmp, "case_collision.zip");
    writeStoredZip(caseCollisionZip, [
      { name: "A.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const capture = captureTreeV0(caseCollisionZip, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: caseCollisionZip, capture });
    assert(!res.ok, "archive adapter should fail closed for strict zip route with case-colliding entry paths");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for case-colliding zip entry paths");
  }

  {
    const tmp = mkTmp();
    const duplicateTar = path.join(tmp, "duplicate_paths.tar");
    writeSimpleTar(duplicateTar, [
      { name: "a.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const capture = captureTreeV0(duplicateTar, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: duplicateTar, capture });
    assert(!res.ok, "archive adapter should fail closed for strict tar route with duplicate entry paths");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for duplicate tar entry paths");
  }

  {
    const tmp = mkTmp();
    const caseCollisionTar = path.join(tmp, "case_collision.tar");
    writeSimpleTar(caseCollisionTar, [
      { name: "A.txt", text: "alpha-a" },
      { name: "a.txt", text: "alpha-b" },
    ]);
    const capture = captureTreeV0(caseCollisionTar, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: caseCollisionTar, capture });
    assert(!res.ok, "archive adapter should fail closed for strict tar route with case-colliding entry paths");
    assertEq(res.failCode, "ARCHIVE_FORMAT_MISMATCH", "expected ARCHIVE_FORMAT_MISMATCH for case-colliding tar entry paths");
  }

  {
    const tmp = mkTmp();
    const txz = path.join(tmp, "sample.txz");
    fs.writeFileSync(txz, "not-a-real-txz", "utf8");
    const capture = captureTreeV0(txz, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: txz, capture });
    assert(!res.ok, "archive txz without plugin should fail closed");
    assertEq(res.failCode, "ARCHIVE_PLUGIN_REQUIRED", "expected plugin required code for txz");
  }

  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "archive",
      enabledPlugins: ["tar", "unknown_plugin_name"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "unknown plugin name should fail closed");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNKNOWN", "expected unknown plugin fail code");
  }

  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "archive",
      enabledPlugins: ["tar", "tar"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "duplicate plugin names should fail closed");
    assertEq(res.failCode, "ADAPTER_PLUGIN_DUPLICATE", "expected duplicate plugin fail code");
  }

  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "none",
      enabledPlugins: ["unknown_plugin_name"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "unknown plugin name should fail closed even with adapter none");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNKNOWN", "expected unknown plugin fail code for adapter none");
  }

  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "none",
      enabledPlugins: ["tar"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "known plugin should fail closed when adapter none is selected");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNUSED", "expected plugin-unused fail code for adapter none");
  }

  {
    const tmp = mkTmp();
    const input = path.join(tmp, "plain.txt");
    fs.writeFileSync(input, "plain text input", "utf8");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "auto",
      enabledPlugins: ["unknown_plugin_name"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "unknown plugin name should fail closed even when auto adapter has no class match");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNKNOWN", "expected unknown plugin fail code for auto unmatched");
  }

  {
    const tmp = mkTmp();
    const input = path.join(tmp, "plain.txt");
    fs.writeFileSync(input, "plain text input", "utf8");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "auto",
      enabledPlugins: ["tar"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "known plugin should fail closed when auto adapter has no class match");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNUSED", "expected plugin-unused fail code for auto unmatched");
  }

  {
    const tmp = mkTmp();
    const input = path.join(tmp, "sample.pdf");
    fs.writeFileSync(input, "pdf-ish bytes", "utf8");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "document",
      enabledPlugins: ["tar"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "known plugin should fail closed for non-plugin adapter selections");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNUSED", "expected plugin-unused fail code for non-plugin adapter");
  }

  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "archive",
      enabledPlugins: ["tar"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "archive zip with tar plugin should fail closed as plugin-unused");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNUSED", "expected plugin-unused fail code for zip+tar");
  }

  {
    const tmp = mkTmp();
    const input = path.join(tmp, "sample.tgz");
    fs.writeFileSync(input, "not-a-real-tgz", "utf8");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({
      selection: "archive",
      enabledPlugins: ["tar", "7z"],
      inputPath: input,
      capture,
    });
    assert(!res.ok, "archive tgz with extra plugin should fail closed as plugin-unused");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNUSED", "expected plugin-unused fail code for tgz+7z");
  }

  {
    const tmp = mkTmp();
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "extension adapter should fail closed for directory without manifest");
    assertEq(res.failCode, "EXTENSION_MANIFEST_MISSING", "expected EXTENSION_MANIFEST_MISSING for extension route mismatch");
  }

  {
    const tmp = mkTmp();
    const badVsix = path.join(tmp, "bad.vsix");
    fs.writeFileSync(badVsix, "not-a-zip-extension", "utf8");
    const capture = captureTreeV0(badVsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: badVsix, capture });
    assert(!res.ok, "extension adapter should fail closed for invalid explicit extension package structure");
    assertEq(res.failCode, "EXTENSION_FORMAT_MISMATCH", "expected EXTENSION_FORMAT_MISMATCH for invalid extension package");
  }

  {
    const tmp = mkTmp();
    const partialVsix = path.join(tmp, "partial_extension.vsix");
    writeStoredZip(partialVsix, [
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo", version: "1.0.0" }) },
      { name: "background.js", text: "console.log('x');" },
    ]);
    corruptSecondZipCentralSignature(partialVsix);
    const capture = captureTreeV0(partialVsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: partialVsix, capture });
    assert(!res.ok, "extension adapter should fail closed when ZIP metadata is partial after parsed entries");
    assertEq(res.failCode, "EXTENSION_FORMAT_MISMATCH", "expected EXTENSION_FORMAT_MISMATCH for partial extension package metadata");
  }

  {
    const tmp = mkTmp();
    fs.writeFileSync(path.join(tmp, "manifest.json"), "{ invalid-json", "utf8");
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "extension adapter should fail closed for invalid manifest");
    assertEq(res.failCode, "EXTENSION_MANIFEST_INVALID", "expected EXTENSION_MANIFEST_INVALID for invalid manifest");
  }

  {
    const tmp = mkTmp();
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({}), "utf8");
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "extension adapter should fail closed for manifest missing core fields");
    assertEq(res.failCode, "EXTENSION_MANIFEST_INVALID", "expected EXTENSION_MANIFEST_INVALID for missing manifest core fields");
  }

  {
    const tmp = mkTmp();
    const emptyManifestVsix = path.join(tmp, "empty_manifest.vsix");
    writeStoredZip(emptyManifestVsix, [{ name: "manifest.json", text: "{}" }]);
    const capture = captureTreeV0(emptyManifestVsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: emptyManifestVsix, capture });
    assert(!res.ok, "extension adapter should fail closed for extension package manifest missing core fields");
    assertEq(res.failCode, "EXTENSION_MANIFEST_INVALID", "expected EXTENSION_MANIFEST_INVALID for extension package manifest core-field mismatch");
  }

  {
    const tmp = mkTmp();
    fs.writeFileSync(
      path.join(tmp, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "demo",
        version: "1.0.0",
        permissions: ["storage"],
        host_permissions: ["https://example.com/*"],
        content_scripts: [{ matches: ["https://example.com/*"], js: ["content.js"] }],
        update_url: "https://updates.example.com/service/update2/crx",
      }),
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "extension adapter should succeed for unpacked manifest dir");
    assertEq(res.adapter?.adapterId, "extension_adapter_v1", "extension adapter id mismatch");
    assert((res.summary?.counts.permissionCount ?? 0) > 0, "expected permission count");
  }

  {
    const tmp = mkTmp();
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "demo", version: "1.0.0" }), "utf8");
    const capture = captureTreeV0(tmp, limits) as any;
    capture.entries = capture.entries.concat([
      { path: "Scripts/Alpha.js", kind: "file", bytes: 1, digest: "sha256:a" },
      { path: "scripts/alpha.js", kind: "file", bytes: 1, digest: "sha256:b" },
    ]);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "extension adapter should fail closed for explicit unpacked extension with case-colliding entry paths");
    assertEq(res.failCode, "EXTENSION_FORMAT_MISMATCH", "expected EXTENSION_FORMAT_MISMATCH for case-colliding unpacked extension entry paths");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "build.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: self-hosted\n    steps:\n      - uses: actions/checkout@main\n      - run: echo ${{ secrets.TOKEN }}\n",
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "iac/cicd adapter should succeed for workflow");
    assertEq(res.summary?.sourceClass, "cicd", "expected cicd source class");
    assert((res.summary?.reasonCodes ?? []).includes("CICD_ADAPTER_V1"), "expected CICD_ADAPTER_V1 reason");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "pinned.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n",
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "cicd adapter should succeed for pinned workflow");
    assertEq(res.summary?.sourceClass, "cicd", "expected cicd class for pinned workflow");
    assertEq(res.summary?.counts.cicdUnpinnedActionCount, 0, "pinned action should not increment unpinned count");
    assert((res.summary?.counts.cicdActionRefCount ?? 0) > 0, "action ref count should be captured");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "auto_class.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n",
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "auto", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "adapter auto should succeed for workflow");
    assertEq(res.summary?.sourceClass, "cicd", "adapter auto should classify workflow as cicd");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "placeholder.yml"), "title: hello\nmessage: plain text\n", "utf8");
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "cicd adapter should fail closed for path-hint-only workflow without ci structure/signals");
    assertEq(res.failCode, "CICD_UNSUPPORTED_FORMAT", "expected CICD_UNSUPPORTED_FORMAT for path-hint-only workflow");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "build.yml"), "name: ci\non: [push]\n", "utf8");
    const capture = captureTreeV0(tmp, limits) as any;
    capture.entries = capture.entries.concat([
      { path: ".github/workflows/Alpha.yml", kind: "file", bytes: 1, digest: "sha256:a" },
      { path: ".github/workflows/alpha.yml", kind: "file", bytes: 1, digest: "sha256:b" },
    ]);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "cicd adapter should fail closed for explicit cicd with case-colliding entry paths");
    assertEq(res.failCode, "CICD_UNSUPPORTED_FORMAT", "expected CICD_UNSUPPORTED_FORMAT for case-colliding cicd entry paths");
  }

  {
    const tmp = mkTmp();
    const tf = path.join(tmp, "main.tf");
    fs.writeFileSync(tf, "resource \"null_resource\" \"x\" {}\n", "utf8");
    const capture = captureTreeV0(tf, limits);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tf, capture });
    assert(!res.ok, "cicd adapter should fail closed for non-cicd terraform input");
    assertEq(res.failCode, "CICD_UNSUPPORTED_FORMAT", "expected CICD_UNSUPPORTED_FORMAT for cicd route mismatch");
  }

  {
    const tmp = mkTmp();
    const yaml = path.join(tmp, "notes.yaml");
    fs.writeFileSync(yaml, "title: hello\nmessage: plain text\n", "utf8");
    const capture = captureTreeV0(yaml, limits);
    const res = runArtifactAdapterV1({ selection: "iac", enabledPlugins: [], inputPath: yaml, capture });
    assert(!res.ok, "iac adapter should fail closed for non-iac yaml under explicit iac route");
    assertEq(res.failCode, "IAC_UNSUPPORTED_FORMAT", "expected IAC_UNSUPPORTED_FORMAT for iac route mismatch");
  }

  {
    const tmp = mkTmp();
    const tf = path.join(tmp, "main.tf");
    fs.writeFileSync(tf, "resource \"null_resource\" \"x\" {}\n", "utf8");
    const capture = captureTreeV0(tmp, limits) as any;
    capture.entries = capture.entries.concat([
      { path: "modules/Alpha.tf", kind: "file", bytes: 1, digest: "sha256:a" },
      { path: "modules/alpha.tf", kind: "file", bytes: 1, digest: "sha256:b" },
    ]);
    const res = runArtifactAdapterV1({ selection: "iac", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "iac adapter should fail closed for explicit iac with case-colliding entry paths");
    assertEq(res.failCode, "IAC_UNSUPPORTED_FORMAT", "expected IAC_UNSUPPORTED_FORMAT for case-colliding iac entry paths");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "build.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n",
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "iac", enabledPlugins: [], inputPath: tmp, capture });
    assert(!res.ok, "iac adapter should fail closed for ci workflow content under explicit iac route");
    assertEq(res.failCode, "IAC_UNSUPPORTED_FORMAT", "expected IAC_UNSUPPORTED_FORMAT for ci workflow under iac route");
  }

  {
    const tmp = mkTmp();
    const tf = path.join(tmp, "main.tf");
    fs.writeFileSync(
      tf,
      "module \"vpc\" {\n  source = \"git::https://github.com/acme/terraform-vpc.git\"\n}\n",
      "utf8"
    );
    const capture = captureTreeV0(tf, limits);
    const res = runArtifactAdapterV1({ selection: "iac", enabledPlugins: [], inputPath: tf, capture });
    assert(res.ok, "iac adapter should succeed for terraform file");
    assertEq(res.summary?.sourceClass, "iac", "expected iac class");
    assert((res.summary?.reasonCodes ?? []).includes("IAC_REMOTE_MODULE_REFERENCE"), "expected remote module reason");
    assert((res.summary?.counts.remoteModulePatternCount ?? 0) > 0, "expected remote module pattern count");
  }

  {
    const tmp = mkTmp();
    const vsix = path.join(tmp, "demo.vsix");
    writeStoredZip(vsix, [
      {
        name: "manifest.json",
        text: JSON.stringify({
          manifest_version: 3,
          name: "demozip",
          version: "1.0.0",
          permissions: ["storage"],
          host_permissions: ["https://example.test/*"],
          content_scripts: [{ matches: ["https://example.test/*"], js: ["content.js"] }],
          update_url: "https://updates.example.test/service/update2/crx",
        }),
      },
    ]);
    const capture = captureTreeV0(vsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: vsix, capture });
    assert(res.ok, "extension adapter should parse zipped manifest");
    assertEq(res.summary?.sourceClass, "extension", "zipped extension class mismatch");
    assert((res.summary?.counts.permissionCount ?? 0) > 0, "zipped extension permission count missing");
  }

  {
    const tmp = mkTmp();
    const nestedVsix = path.join(tmp, "nested_manifest.vsix");
    writeStoredZip(nestedVsix, [
      {
        name: "extension/manifest.json",
        text: JSON.stringify({
          manifest_version: 3,
          name: "nested",
          version: "1.0.0",
        }),
      },
    ]);
    const capture = captureTreeV0(nestedVsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: nestedVsix, capture });
    assert(!res.ok, "extension adapter should fail closed when manifest is not at canonical root path");
    assertEq(res.failCode, "EXTENSION_MANIFEST_MISSING", "expected EXTENSION_MANIFEST_MISSING for nested manifest path");
  }

  {
    const tmp = mkTmp();
    const duplicateVsix = path.join(tmp, "duplicate_manifest.vsix");
    writeStoredZip(duplicateVsix, [
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo-a", version: "1.0.0" }) },
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo-b", version: "1.0.1" }) },
    ]);
    const capture = captureTreeV0(duplicateVsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: duplicateVsix, capture });
    assert(!res.ok, "extension adapter should fail closed for duplicate canonical root manifest entries");
    assertEq(res.failCode, "EXTENSION_FORMAT_MISMATCH", "expected EXTENSION_FORMAT_MISMATCH for duplicate root manifest entries");
  }

  {
    const tmp = mkTmp();
    const caseCollisionVsix = path.join(tmp, "case_collision_entries.vsix");
    writeStoredZip(caseCollisionVsix, [
      { name: "manifest.json", text: JSON.stringify({ manifest_version: 3, name: "demo", version: "1.0.0" }) },
      { name: "scripts/Alpha.js", text: "console.log('a');" },
      { name: "scripts/alpha.js", text: "console.log('b');" },
    ]);
    const capture = captureTreeV0(caseCollisionVsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: caseCollisionVsix, capture });
    assert(!res.ok, "extension adapter should fail closed for case-colliding extension package entry paths");
    assertEq(res.failCode, "EXTENSION_FORMAT_MISMATCH", "expected EXTENSION_FORMAT_MISMATCH for case-colliding extension package entry paths");
  }

  {
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
          host_permissions: ["https://chrome.example/*"],
        }),
      },
    ]);
    const zipBytes = fs.readFileSync(zipPath);
    const header = Buffer.alloc(12, 0);
    header[0] = 0x43; // C
    header[1] = 0x72; // r
    header[2] = 0x32; // 2
    header[3] = 0x34; // 4
    header.writeUInt32LE(3, 4); // crx3
    header.writeUInt32LE(0, 8); // empty header payload
    fs.writeFileSync(crx, Buffer.concat([header, zipBytes]));
    const capture = captureTreeV0(crx, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: crx, capture });
    assert(res.ok, "extension adapter should parse CRX wrapper with valid ZIP payload");
    assertEq(res.summary?.sourceClass, "extension", "crx extension class mismatch");
    assert((res.summary?.counts.permissionCount ?? 0) > 0, "crx permission count missing");
  }

  {
    const tmp = mkTmp();
    const crx = path.join(tmp, "bad.crx");
    const header = Buffer.alloc(12, 0);
    header[0] = 0x43; // C
    header[1] = 0x72; // r
    header[2] = 0x32; // 2
    header[3] = 0x34; // 4
    header.writeUInt32LE(3, 4);
    header.writeUInt32LE(0, 8);
    fs.writeFileSync(crx, Buffer.concat([header, Buffer.from("not-a-zip", "utf8")]));
    const capture = captureTreeV0(crx, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: crx, capture });
    assert(!res.ok, "extension adapter should fail closed for CRX with invalid ZIP payload");
    assertEq(res.failCode, "EXTENSION_FORMAT_MISMATCH", "expected EXTENSION_FORMAT_MISMATCH for invalid CRX payload");
  }

  {
    const tmp = mkTmp();
    const xpi = path.join(tmp, "demo.xpi");
    writeStoredZip(xpi, [
      {
        name: "manifest.json",
        text: JSON.stringify({
          manifest_version: 2,
          name: "demo-xpi",
          version: "1.0.0",
          permissions: ["storage", "https://mozilla.example/*"],
          content_scripts: [{ matches: ["https://mozilla.example/*"], js: ["content.js"] }],
          update_url: "https://updates.mozilla.example/addon/update.json",
        }),
      },
    ]);
    const capture = captureTreeV0(xpi, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: xpi, capture });
    assert(res.ok, "extension adapter should parse xpi manifest");
    assertEq(res.summary?.sourceClass, "extension", "xpi extension class mismatch");
    assert((res.summary?.counts.permissionCount ?? 0) > 0, "xpi permission count missing");
  }

  {
    const tmp = mkTmp();
    const tgz = path.join(tmp, "bad.tgz");
    fs.writeFileSync(tgz, "not-a-real-tgz", "utf8");
    const capture = captureTreeV0(tgz, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: tgz, capture });
    assert(!res.ok, "package adapter should fail closed for compressed tar package without tar plugin");
    assertEq(res.failCode, "PACKAGE_PLUGIN_REQUIRED", "expected PACKAGE_PLUGIN_REQUIRED for package tgz without tar plugin");
  }

  {
    const tmp = mkTmp();
    const tbz2 = path.join(tmp, "bad.tar.bz2");
    fs.writeFileSync(tbz2, "not-a-real-tbz2", "utf8");
    const capture = captureTreeV0(tbz2, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: tbz2, capture });
    assert(!res.ok, "package adapter should fail closed for bzip2 compressed tar package without tar plugin");
    assertEq(res.failCode, "PACKAGE_PLUGIN_REQUIRED", "expected PACKAGE_PLUGIN_REQUIRED for package tar.bz2 without tar plugin");
  }

  {
    const tmp = mkTmp();
    const tbzAlias = path.join(tmp, "bad.tbz2");
    fs.writeFileSync(tbzAlias, "not-a-real-tbz2", "utf8");
    const capture = captureTreeV0(tbzAlias, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: tbzAlias, capture });
    assert(!res.ok, "package adapter should fail closed for tbz2 alias compressed tar package without tar plugin");
    assertEq(res.failCode, "PACKAGE_PLUGIN_REQUIRED", "expected PACKAGE_PLUGIN_REQUIRED for package tbz2 alias without tar plugin");
  }

  {
    const tmp = mkTmp();
    const tgz = path.join(tmp, "valid_package.tgz");
    writeSimpleTgz(tgz, [{ name: "pkg/install.sh", text: "echo ok" }]);
    const capture = captureTreeV0(tgz, limits);
    const tarAvailable = runCmd("tar", ["--help"]).ok;
    if (tarAvailable) {
      const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: ["tar"], inputPath: tgz, capture });
      assert(res.ok, "package adapter should accept compressed tar package when tar plugin is enabled");
      assertEq(res.summary?.sourceClass, "package", "package tgz sourceClass mismatch");
      assertEq(res.adapter?.mode, "plugin", "package tgz adapter mode should be plugin");
    }
  }

  {
    const tmp = mkTmp();
    const tgz = path.join(tmp, "case_collision_package.tgz");
    writeSimpleTgz(tgz, [
      { name: "PKG/Install.sh", text: "echo a" },
      { name: "pkg/install.sh", text: "echo b" },
    ]);
    const capture = captureTreeV0(tgz, limits);
    const tarAvailable = runCmd("tar", ["--help"]).ok;
    if (tarAvailable) {
      const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: ["tar"], inputPath: tgz, capture });
      assert(!res.ok, "package adapter should fail closed for strict package plugin route with case-colliding entry paths");
      assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for case-colliding package plugin entries");
    }
  }

  {
    const tmp = mkTmp();
    const input = path.join(tmp, "bad.msi");
    fs.writeFileSync(input, "not-a-cfb-msi", "utf8");
    const capture = captureTreeV0(input, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: ["tar"], inputPath: input, capture });
    assert(!res.ok, "package adapter should fail closed when tar plugin is provided for non-applicable package format");
    assertEq(res.failCode, "ADAPTER_PLUGIN_UNUSED", "expected ADAPTER_PLUGIN_UNUSED for package msi with tar plugin");
  }

  {
    const tmp = mkTmp();
    const msi = path.join(tmp, "bad.msi");
    fs.writeFileSync(msi, "not-a-cfb-msi", "utf8");
    const capture = captureTreeV0(msi, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msi, capture });
    assert(!res.ok, "package adapter should fail closed for msi header mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad msi");
  }

  {
    const tmp = mkTmp();
    const msi = path.join(tmp, "sample.msi");
    const bytes = Buffer.alloc(1024, 0);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    bytes[4] = 0xa1;
    bytes[5] = 0xb1;
    bytes[6] = 0x1a;
    bytes[7] = 0xe1;
    bytes[26] = 0x03; // major version = 3
    bytes[27] = 0x00;
    bytes[28] = 0xfe; // byte order = 0xFFFE
    bytes[29] = 0xff;
    bytes[30] = 0x09; // sector shift = 9
    bytes[31] = 0x00;
    bytes[32] = 0x06; // mini sector shift = 6
    bytes[33] = 0x00;
    fs.writeFileSync(msi, bytes);
    const capture = captureTreeV0(msi, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msi, capture });
    assert(res.ok, "package adapter should accept msi with valid CFB header");
    assertEq(res.summary?.sourceClass, "package", "msi package class mismatch");
    assert((res.summary?.reasonCodes ?? []).includes("EXECUTION_WITHHELD_INSTALLER"), "msi installer withheld reason missing");
  }

  {
    const tmp = mkTmp();
    const msi = path.join(tmp, "tiny_valid_header.msi");
    const bytes = Buffer.alloc(128, 0);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    bytes[4] = 0xa1;
    bytes[5] = 0xb1;
    bytes[6] = 0x1a;
    bytes[7] = 0xe1;
    bytes[26] = 0x03; // major version = 3
    bytes[27] = 0x00;
    bytes[28] = 0xfe; // byte order = 0xFFFE
    bytes[29] = 0xff;
    bytes[30] = 0x09; // sector shift = 9
    bytes[31] = 0x00;
    bytes[32] = 0x06; // mini sector shift = 6
    bytes[33] = 0x00;
    fs.writeFileSync(msi, bytes);
    const capture = captureTreeV0(msi, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msi, capture });
    assert(!res.ok, "package adapter should fail closed for msi with valid header but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny msi structural size");
  }

  {
    const tmp = mkTmp();
    const msi = path.join(tmp, "magic_only.msi");
    const bytes = Buffer.alloc(64, 0);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    bytes[4] = 0xa1;
    bytes[5] = 0xb1;
    bytes[6] = 0x1a;
    bytes[7] = 0xe1;
    fs.writeFileSync(msi, bytes);
    const capture = captureTreeV0(msi, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msi, capture });
    assert(!res.ok, "package adapter should fail closed for msi with magic only and invalid CFB structure");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for msi with invalid CFB structure");
  }

  {
    const tmp = mkTmp();
    const msix = path.join(tmp, "bad.msix");
    fs.writeFileSync(msix, "not-a-zip-msix", "utf8");
    const capture = captureTreeV0(msix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msix, capture });
    assert(!res.ok, "package adapter should fail closed for msix container mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad msix");
  }

  {
    const tmp = mkTmp();
    const badStructureMsix = path.join(tmp, "bad_structure.msix");
    writeStoredZip(badStructureMsix, [{ name: "file.txt", text: "x" }]);
    const capture = captureTreeV0(badStructureMsix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: badStructureMsix, capture });
    assert(!res.ok, "package adapter should fail closed for msix missing package structure");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for msix missing structure");
  }

  {
    const tmp = mkTmp();
    const nestedStructureMsix = path.join(tmp, "nested_structure.msix");
    writeStoredZip(nestedStructureMsix, [
      { name: "nested/[Content_Types].xml", text: "<Types></Types>" },
      { name: "nested/AppxManifest.xml", text: "<Package></Package>" },
    ]);
    const capture = captureTreeV0(nestedStructureMsix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: nestedStructureMsix, capture });
    assert(!res.ok, "package adapter should fail closed for msix structure markers that are not at canonical root paths");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for nested msix structure markers");
  }

  {
    const tmp = mkTmp();
    const duplicateManifestMsix = path.join(tmp, "duplicate_manifest_markers.msix");
    writeStoredZip(duplicateManifestMsix, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "AppxManifest.xml", text: "<Package></Package>" },
      { name: "AppxBundleManifest.xml", text: "<Bundle></Bundle>" },
    ]);
    const capture = captureTreeV0(duplicateManifestMsix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: duplicateManifestMsix, capture });
    assert(!res.ok, "package adapter should fail closed for msix with ambiguous multiple root manifest markers");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for ambiguous msix manifest markers");
  }

  {
    const tmp = mkTmp();
    const duplicateSamePathMsix = path.join(tmp, "duplicate_same_path_markers.msix");
    writeStoredZip(duplicateSamePathMsix, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "AppxManifest.xml", text: "<Package></Package>" },
    ]);
    const capture = captureTreeV0(duplicateSamePathMsix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: duplicateSamePathMsix, capture });
    assert(!res.ok, "package adapter should fail closed for msix with duplicate same-path required markers");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for duplicate same-path msix required markers");
  }

  {
    const tmp = mkTmp();
    const msix = path.join(tmp, "demo.msix");
    writeStoredZip(msix, [
      {
        name: "[Content_Types].xml",
        text: "<Types><Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>",
      },
      {
        name: "AppxManifest.xml",
        text: "<Package><Capabilities><Capability Name=\"internetClient\"/></Capabilities></Package>\n" + "manifest-padding-".repeat(24),
      },
      {
        name: "AppxSignature.p7x",
        text: "sig-bytes-" + "A".repeat(256),
      },
      {
        name: "scripts/install.ps1",
        text: "Write-Host install\n" + "Write-Host extra\n".repeat(16),
      },
    ]);
    const capture = captureTreeV0(msix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msix, capture });
    assert(res.ok, "package adapter should parse msix metadata");
    assertEq(res.summary?.sourceClass, "package", "msix package class mismatch");
    assert((res.summary?.counts.manifestCount ?? 0) > 0, "msix manifest count missing");
    assert((res.summary?.counts.scriptHintCount ?? 0) > 0, "msix script hint count missing");
    assert((res.summary?.counts.permissionHintCount ?? 0) > 0, "msix permission hint count missing");
    assert((res.summary?.counts.signingEvidenceCount ?? 0) > 0, "msix signing evidence should be present");
    assert((res.summary?.reasonCodes ?? []).includes("PACKAGE_SIGNING_INFO_PRESENT"), "msix signing reason missing");
  }

  {
    const tmp = mkTmp();
    const msix = path.join(tmp, "tiny.msix");
    writeStoredZip(msix, [
      {
        name: "AppxManifest.xml",
        text: "<Package></Package>",
      },
    ]);
    const capture = captureTreeV0(msix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msix, capture });
    assert(!res.ok, "package adapter should fail closed for msix with valid structure but tiny file size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny msix structural size");
  }

  {
    const tmp = mkTmp();
    const badStructureNupkg = path.join(tmp, "bad_structure.nupkg");
    writeStoredZip(badStructureNupkg, [{ name: "content/readme.txt", text: "x" }]);
    const capture = captureTreeV0(badStructureNupkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: badStructureNupkg, capture });
    assert(!res.ok, "package adapter should fail closed for nupkg missing nuspec");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for nupkg missing structure");
  }

  {
    const tmp = mkTmp();
    const nestedNupkg = path.join(tmp, "nested_structure.nupkg");
    writeStoredZip(nestedNupkg, [{ name: "nested/demo.nuspec", text: "<package>\n" + "x".repeat(384) + "\n</package>" }]);
    const capture = captureTreeV0(nestedNupkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: nestedNupkg, capture });
    assert(!res.ok, "package adapter should fail closed for nupkg nuspec markers that are not at canonical root paths");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for nested nupkg nuspec marker path");
  }

  {
    const tmp = mkTmp();
    const duplicateNupkg = path.join(tmp, "duplicate_nuspec.nupkg");
    writeStoredZip(duplicateNupkg, [
      { name: "demo.nuspec", text: "<package>\n" + "x".repeat(384) + "\n</package>" },
      { name: "alt.nuspec", text: "<package>\n" + "y".repeat(384) + "\n</package>" },
    ]);
    const capture = captureTreeV0(duplicateNupkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: duplicateNupkg, capture });
    assert(!res.ok, "package adapter should fail closed for nupkg with multiple root nuspec markers");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for duplicate root nuspec markers");
  }

  {
    const tmp = mkTmp();
    const nupkg = path.join(tmp, "demo.nupkg");
    writeStoredZip(nupkg, [{ name: "demo.nuspec", text: "<package>\n" + "x".repeat(384) + "\n</package>" }]);
    const capture = captureTreeV0(nupkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: nupkg, capture });
    assert(res.ok, "package adapter should parse nupkg package structure");
    assertEq(res.summary?.sourceClass, "package", "nupkg package class mismatch");
    assert((res.summary?.counts.manifestCount ?? 0) > 0, "nupkg manifest count missing");
  }

  {
    const tmp = mkTmp();
    const nupkg = path.join(tmp, "tiny.nupkg");
    writeStoredZip(nupkg, [{ name: "demo.nuspec", text: "<package></package>" }]);
    const capture = captureTreeV0(nupkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: nupkg, capture });
    assert(!res.ok, "package adapter should fail closed for nupkg with valid structure but tiny file size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny nupkg structural size");
  }

  {
    const tmp = mkTmp();
    const partialNupkg = path.join(tmp, "partial.nupkg");
    writeStoredZip(partialNupkg, [
      { name: "demo.nuspec", text: "<package></package>" },
      { name: "content/readme.txt", text: "x" },
    ]);
    corruptSecondZipCentralSignature(partialNupkg);
    const capture = captureTreeV0(partialNupkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: partialNupkg, capture });
    assert(!res.ok, "package adapter should fail closed when package ZIP metadata is partial after parsed entries");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for partial package zip metadata");
  }

  {
    const tmp = mkTmp();
    const badStructureWhl = path.join(tmp, "bad_structure.whl");
    writeStoredZip(badStructureWhl, [{ name: "pkg/__init__.py", text: "" }]);
    const capture = captureTreeV0(badStructureWhl, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: badStructureWhl, capture });
    assert(!res.ok, "package adapter should fail closed for whl missing dist-info metadata");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for whl missing structure");
  }

  {
    const tmp = mkTmp();
    const nestedWhl = path.join(tmp, "nested_structure.whl");
    writeStoredZip(nestedWhl, [
      { name: "nested/demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" + "x".repeat(320) + "\n" },
      { name: "nested/demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\nTag: py3-none-any\n" + "y".repeat(160) + "\n" },
      { name: "nested/demo-1.0.dist-info/RECORD", text: "nested/demo-1.0.dist-info/METADATA,,\n" },
    ]);
    const capture = captureTreeV0(nestedWhl, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: nestedWhl, capture });
    assert(!res.ok, "package adapter should fail closed for whl dist-info markers that are not at canonical root paths");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for nested whl dist-info marker paths");
  }

  {
    const tmp = mkTmp();
    const duplicateWhl = path.join(tmp, "duplicate_dist_info.whl");
    writeStoredZip(duplicateWhl, [
      { name: "demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" + "x".repeat(320) + "\n" },
      { name: "demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\nTag: py3-none-any\n" + "y".repeat(160) + "\n" },
      { name: "demo-1.0.dist-info/RECORD", text: "demo-1.0.dist-info/METADATA,,\n" },
      { name: "alt-1.0.dist-info/METADATA", text: "Name: alt\nVersion: 1.0.0\n" + "z".repeat(320) + "\n" },
    ]);
    const capture = captureTreeV0(duplicateWhl, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: duplicateWhl, capture });
    assert(!res.ok, "package adapter should fail closed for whl with ambiguous multiple dist-info metadata markers");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for duplicate whl dist-info metadata markers");
  }

  {
    const tmp = mkTmp();
    const whl = path.join(tmp, "demo.whl");
    writeStoredZip(whl, [
      { name: "demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" + "x".repeat(320) + "\n" },
      { name: "demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\nTag: py3-none-any\n" + "y".repeat(160) + "\n" },
      { name: "demo-1.0.dist-info/RECORD", text: "demo-1.0.dist-info/METADATA,,\n" },
    ]);
    const capture = captureTreeV0(whl, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: whl, capture });
    assert(res.ok, "package adapter should parse whl package structure");
    assertEq(res.summary?.sourceClass, "package", "whl package class mismatch");
    assert((res.summary?.counts.manifestCount ?? 0) > 0, "whl manifest count missing");
  }

  {
    const tmp = mkTmp();
    const whl = path.join(tmp, "tiny.whl");
    writeStoredZip(whl, [
      { name: "demo-1.0.dist-info/METADATA", text: "Name: demo\nVersion: 1.0.0\n" },
      { name: "demo-1.0.dist-info/WHEEL", text: "Wheel-Version: 1.0\n" },
    ]);
    const capture = captureTreeV0(whl, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: whl, capture });
    assert(!res.ok, "package adapter should fail closed for whl missing required dist-info structure");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for whl missing required dist-info structure");
  }

  {
    const tmp = mkTmp();
    const badStructureJar = path.join(tmp, "bad_structure.jar");
    writeStoredZip(badStructureJar, [{ name: "com/example/App.class", text: "x" }]);
    const capture = captureTreeV0(badStructureJar, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: badStructureJar, capture });
    assert(!res.ok, "package adapter should fail closed for jar missing manifest");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for jar missing structure");
  }

  {
    const tmp = mkTmp();
    const duplicateManifestJar = path.join(tmp, "duplicate_manifest.jar");
    writeStoredZip(duplicateManifestJar, [
      { name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" },
      { name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" },
    ]);
    const capture = captureTreeV0(duplicateManifestJar, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: duplicateManifestJar, capture });
    assert(!res.ok, "package adapter should fail closed for jar with duplicate same-path manifest entries");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for duplicate same-path jar manifest entries");
  }

  {
    const tmp = mkTmp();
    const caseCollisionJar = path.join(tmp, "case_collision.jar");
    writeStoredZip(caseCollisionJar, [
      { name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\nMain-Class: demo.Main\n" + "z".repeat(256) + "\n" },
      { name: "lib/Alpha.class", text: "a" },
      { name: "lib/alpha.class", text: "b" },
    ]);
    const capture = captureTreeV0(caseCollisionJar, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: caseCollisionJar, capture });
    assert(!res.ok, "package adapter should fail closed for jar with case-colliding package entry paths");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for case-colliding package entry paths");
  }

  {
    const tmp = mkTmp();
    const jar = path.join(tmp, "demo.jar");
    writeStoredZip(jar, [{ name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" + "Main-Class: demo.Main\n" + "z".repeat(256) + "\n" }]);
    const capture = captureTreeV0(jar, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: jar, capture });
    assert(res.ok, "package adapter should parse jar package structure");
    assertEq(res.summary?.sourceClass, "package", "jar package class mismatch");
    assert((res.summary?.counts.manifestCount ?? 0) > 0, "jar manifest count missing");
  }

  {
    const tmp = mkTmp();
    const jar = path.join(tmp, "tiny.jar");
    writeStoredZip(jar, [{ name: "META-INF/MANIFEST.MF", text: "Manifest-Version: 1.0\n" }]);
    const capture = captureTreeV0(jar, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: jar, capture });
    assert(!res.ok, "package adapter should fail closed for jar with valid structure but tiny file size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny jar structural size");
  }

  {
    const tmp = mkTmp();
    const exe = path.join(tmp, "bad.exe");
    fs.writeFileSync(exe, "not-a-pe", "utf8");
    const capture = captureTreeV0(exe, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: exe, capture });
    assert(!res.ok, "package adapter should fail closed for exe header mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad exe");
  }

  {
    const tmp = mkTmp();
    const exe = path.join(tmp, "tiny_valid_header.exe");
    const bytes = Buffer.alloc(400, 0);
    bytes[0] = 0x4d; // M
    bytes[1] = 0x5a; // Z
    bytes.writeUInt32LE(0x80, 0x3c); // pe offset
    bytes[0x80] = 0x50; // P
    bytes[0x81] = 0x45; // E
    bytes[0x82] = 0x00;
    bytes[0x83] = 0x00;
    bytes.writeUInt16LE(0x014c, 0x84); // machine
    bytes.writeUInt16LE(1, 0x86); // sections
    bytes.writeUInt16LE(0x00e0, 0x94); // size optional header
    const opt = 0x98;
    bytes.writeUInt16LE(0x010b, opt); // PE32
    bytes.writeUInt32LE(16, opt + 92); // numberOfRvaAndSizes
    const dataDir = opt + 96;
    const certEntry = dataDir + 8 * 4;
    bytes.writeUInt32LE(0x180, certEntry); // cert table file offset
    bytes.writeUInt32LE(0, certEntry + 4); // cert size
    fs.writeFileSync(exe, bytes);
    const capture = captureTreeV0(exe, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: exe, capture });
    assert(!res.ok, "package adapter should fail closed for exe with valid PE header but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny exe structural size");
  }

  {
    const tmp = mkTmp();
    const exe = path.join(tmp, "signed.exe");
    writeMinimalPe(exe, 256);
    const capture = captureTreeV0(exe, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: exe, capture });
    assert(res.ok, "package adapter should parse minimal pe signing evidence");
    assertEq(res.summary?.sourceClass, "package", "exe package class mismatch");
    assertEq(res.summary?.counts.peSignaturePresent, 1, "pe signature should be detected");
    assert((res.summary?.reasonCodes ?? []).includes("PACKAGE_SIGNING_INFO_PRESENT"), "pe signing reason missing");
  }

  {
    const tmp = mkTmp();
    const exe = path.join(tmp, "unsigned.exe");
    writeMinimalPe(exe, 0);
    const capture = captureTreeV0(exe, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: exe, capture });
    assert(res.ok, "package adapter should parse minimal pe unsigned evidence");
    assertEq(res.summary?.counts.peSignaturePresent, 0, "pe signature should be absent");
    assert((res.summary?.reasonCodes ?? []).includes("EXECUTION_WITHHELD_INSTALLER"), "installer withheld reason missing");
  }

  {
    const tmp = mkTmp();
    const deb = path.join(tmp, "bad.deb");
    fs.writeFileSync(deb, "not-an-ar-deb", "utf8");
    const capture = captureTreeV0(deb, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: deb, capture });
    assert(!res.ok, "package adapter should fail closed for deb container mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad deb");
  }

  {
    const tmp = mkTmp();
    const deb = path.join(tmp, "bad_structure.deb");
    writeSimpleAr(deb, [
      { name: "random.txt", bytes: Buffer.from("x", "utf8") },
      { name: "payload.bin", bytes: Buffer.from("y", "utf8") },
    ]);
    const capture = captureTreeV0(deb, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: deb, capture });
    assert(!res.ok, "package adapter should fail closed for deb missing required package structure entries");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for deb missing required entries");
  }

  {
    const tmp = mkTmp();
    const deb = path.join(tmp, "duplicate_structure.deb");
    writeSimpleAr(deb, [
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "control.tar.gz", bytes: Buffer.from("fake-control-".repeat(24), "utf8") },
      { name: "data.tar.xz", bytes: Buffer.from("fake-data-".repeat(24), "utf8") },
    ]);
    const capture = captureTreeV0(deb, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: deb, capture });
    assert(!res.ok, "package adapter should fail closed for deb with duplicate required structure entries");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for duplicate deb structure entries");
  }

  {
    const tmp = mkTmp();
    const deb = path.join(tmp, "tiny_stub.deb");
    writeSimpleAr(deb, [
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "control.tar.gz", bytes: Buffer.from("x", "utf8") },
      { name: "data.tar.xz", bytes: Buffer.from("y", "utf8") },
    ]);
    const capture = captureTreeV0(deb, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: deb, capture });
    assert(!res.ok, "package adapter should fail closed for deb with required entries but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny deb structural size");
  }

  {
    const tmp = mkTmp();
    const deb = path.join(tmp, "sample.deb");
    writeSimpleAr(deb, [
      { name: "debian-binary", bytes: Buffer.from("2.0\n", "utf8") },
      { name: "control.tar.gz", bytes: Buffer.from("fake-control-".repeat(24), "utf8") },
      { name: "data.tar.xz", bytes: Buffer.from("fake-data-".repeat(24), "utf8") },
    ]);
    const capture = captureTreeV0(deb, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: deb, capture });
    assert(res.ok, "package adapter should parse deb ar headers");
    assertEq(res.summary?.sourceClass, "package", "deb package class mismatch");
    assert((res.summary?.counts.debArEntryCount ?? 0) >= 3, "deb ar entry count missing");
    assert((res.summary?.counts.manifestCount ?? 0) > 0, "deb manifest hints missing");
    assert((res.summary?.reasonCodes ?? []).includes("EXECUTION_WITHHELD_INSTALLER"), "deb installer withheld reason missing");
  }

  {
    const tmp = mkTmp();
    const rpm = path.join(tmp, "bad.rpm");
    fs.writeFileSync(rpm, "not-an-rpm", "utf8");
    const capture = captureTreeV0(rpm, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: rpm, capture });
    assert(!res.ok, "package adapter should fail closed for rpm header mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad rpm");
  }

  {
    const tmp = mkTmp();
    const rpm = path.join(tmp, "lead_only.rpm");
    const bytes = Buffer.alloc(128, 0);
    bytes[0] = 0xed;
    bytes[1] = 0xab;
    bytes[2] = 0xee;
    bytes[3] = 0xdb;
    fs.writeFileSync(rpm, bytes);
    const capture = captureTreeV0(rpm, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: rpm, capture });
    assert(!res.ok, "package adapter should fail closed for rpm missing signature header magic");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for rpm missing header magic");
  }

  {
    const tmp = mkTmp();
    const rpm = path.join(tmp, "tiny_magic.rpm");
    const bytes = Buffer.alloc(128, 0);
    bytes[0] = 0xed;
    bytes[1] = 0xab;
    bytes[2] = 0xee;
    bytes[3] = 0xdb;
    bytes[96] = 0x8e;
    bytes[97] = 0xad;
    bytes[98] = 0xe8;
    fs.writeFileSync(rpm, bytes);
    const capture = captureTreeV0(rpm, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: rpm, capture });
    assert(!res.ok, "package adapter should fail closed for rpm with magic/header markers but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny rpm structural size");
  }

  {
    const tmp = mkTmp();
    const rpm = path.join(tmp, "sample.rpm");
    const bytes = Buffer.alloc(768, 0);
    bytes[0] = 0xed;
    bytes[1] = 0xab;
    bytes[2] = 0xee;
    bytes[3] = 0xdb;
    bytes[96] = 0x8e;
    bytes[97] = 0xad;
    bytes[98] = 0xe8;
    Buffer.from("preinstall /bin/sh\npostinstall /bin/sh\ngpgsig: present\n", "ascii").copy(bytes, 128);
    fs.writeFileSync(rpm, bytes);
    const capture = captureTreeV0(rpm, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: rpm, capture });
    assert(res.ok, "package adapter should parse rpm lead hints");
    assertEq(res.summary?.sourceClass, "package", "rpm package class mismatch");
    assertEq(res.summary?.counts.rpmLeadPresent, 1, "rpm lead should be detected");
    assertEq(res.summary?.counts.rpmHeaderPresent, 1, "rpm header magic should be detected");
    assert((res.summary?.reasonCodes ?? []).includes("PACKAGE_SIGNING_INFO_PRESENT"), "rpm signing hint reason missing");
  }

  {
    const tmp = mkTmp();
    const appimage = path.join(tmp, "bad.appimage");
    fs.writeFileSync(appimage, "not-an-elf-appimage", "utf8");
    const capture = captureTreeV0(appimage, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: appimage, capture });
    assert(!res.ok, "package adapter should fail closed for appimage header mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad appimage");
  }

  {
    const tmp = mkTmp();
    const appimage = path.join(tmp, "elf_only.appimage");
    const bytes = Buffer.alloc(512, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    fs.writeFileSync(appimage, bytes);
    const capture = captureTreeV0(appimage, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: appimage, capture });
    assert(!res.ok, "package adapter should fail closed for appimage missing AppImage marker");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for appimage missing marker");
  }

  {
    const tmp = mkTmp();
    const appimage = path.join(tmp, "text_marker_only.appimage");
    const bytes = Buffer.alloc(1024, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    Buffer.from("AppImage runtime", "ascii").copy(bytes, 128); // non-canonical location
    fs.writeFileSync(appimage, bytes);
    const capture = captureTreeV0(appimage, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: appimage, capture });
    assert(!res.ok, "package adapter should fail closed when only loose AppImage text marker is present");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for loose AppImage text marker");
  }

  {
    const tmp = mkTmp();
    const appimage = path.join(tmp, "sample.appimage");
    const bytes = Buffer.alloc(4096, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    bytes[8] = 0x41; // A
    bytes[9] = 0x49; // I
    bytes[10] = 0x02; // AppImage type 2
    Buffer.from("AppImage runtime", "ascii").copy(bytes, 128);
    fs.writeFileSync(appimage, bytes);
    const capture = captureTreeV0(appimage, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: appimage, capture });
    assert(res.ok, "package adapter should parse appimage header hints");
    assertEq(res.summary?.sourceClass, "package", "appimage package class mismatch");
    assertEq(res.summary?.counts.appImageElfPresent, 1, "appimage elf marker missing");
    assertEq(res.summary?.counts.appImageMarkerPresent, 1, "appimage runtime marker missing");
    assertEq(res.summary?.counts.appImageType, 2, "appimage runtime type mismatch");
    assert((res.summary?.reasonCodes ?? []).includes("EXECUTION_WITHHELD_INSTALLER"), "appimage installer withheld reason missing");
  }

  {
    const tmp = mkTmp();
    const appimage = path.join(tmp, "tiny_valid.appimage");
    const bytes = Buffer.alloc(64, 0);
    bytes[0] = 0x7f;
    bytes[1] = 0x45;
    bytes[2] = 0x4c;
    bytes[3] = 0x46;
    bytes[8] = 0x41; // A
    bytes[9] = 0x49; // I
    bytes[10] = 0x02; // AppImage type 2
    fs.writeFileSync(appimage, bytes);
    const capture = captureTreeV0(appimage, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: appimage, capture });
    assert(!res.ok, "package adapter should fail closed for appimage with valid markers but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny appimage structural size");
  }

  {
    const tmp = mkTmp();
    const pkg = path.join(tmp, "bad.pkg");
    fs.writeFileSync(pkg, "not-a-xar", "utf8");
    const capture = captureTreeV0(pkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: pkg, capture });
    assert(!res.ok, "package adapter should fail closed for pkg header mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad pkg");
  }

  {
    const tmp = mkTmp();
    const pkg = path.join(tmp, "bad_header.pkg");
    const bytes = Buffer.alloc(32, 0);
    Buffer.from("xar!", "ascii").copy(bytes, 0);
    // invalid header size/version keeps this structurally invalid in strict mode
    fs.writeFileSync(pkg, bytes);
    const capture = captureTreeV0(pkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: pkg, capture });
    assert(!res.ok, "package adapter should fail closed for pkg with invalid xar header fields");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for invalid pkg header");
  }

  {
    const tmp = mkTmp();
    const pkg = path.join(tmp, "sample.pkg");
    const bytes = Buffer.alloc(1024, 0);
    Buffer.from("xar!", "ascii").copy(bytes, 0);
    bytes.writeUInt16BE(28, 4); // header size
    bytes.writeUInt16BE(1, 6); // version
    Buffer.from("preinstall script payload permission", "ascii").copy(bytes, 64);
    fs.writeFileSync(pkg, bytes);
    const capture = captureTreeV0(pkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: pkg, capture });
    assert(res.ok, "package adapter should parse pkg header hints");
    assertEq(res.summary?.sourceClass, "package", "pkg package class mismatch");
    assertEq(res.summary?.counts.pkgXarHeaderPresent, 1, "pkg xar header marker missing");
    assert((res.summary?.reasonCodes ?? []).includes("EXECUTION_WITHHELD_INSTALLER"), "pkg installer withheld reason missing");
  }

  {
    const tmp = mkTmp();
    const pkg = path.join(tmp, "tiny_valid_header.pkg");
    const bytes = Buffer.alloc(64, 0);
    Buffer.from("xar!", "ascii").copy(bytes, 0);
    bytes.writeUInt16BE(28, 4); // header size
    bytes.writeUInt16BE(1, 6); // version
    fs.writeFileSync(pkg, bytes);
    const capture = captureTreeV0(pkg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: pkg, capture });
    assert(!res.ok, "package adapter should fail closed for pkg with valid header but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny pkg structural size");
  }

  {
    const tmp = mkTmp();
    const dmg = path.join(tmp, "bad.dmg");
    fs.writeFileSync(dmg, "not-a-dmg-trailer", "utf8");
    const capture = captureTreeV0(dmg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: dmg, capture });
    assert(!res.ok, "package adapter should fail closed for dmg trailer mismatch");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for bad dmg");
  }

  {
    const tmp = mkTmp();
    const dmg = path.join(tmp, "misplaced_koly.dmg");
    const bytes = Buffer.alloc(8192, 0);
    Buffer.from("koly", "ascii").copy(bytes, bytes.length - 128);
    fs.writeFileSync(dmg, bytes);
    const capture = captureTreeV0(dmg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: dmg, capture });
    assert(!res.ok, "package adapter should fail closed when dmg koly marker is not at trailer offset");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for misplaced dmg koly marker");
  }

  {
    const tmp = mkTmp();
    const dmg = path.join(tmp, "tiny_koly.dmg");
    const bytes = Buffer.alloc(512, 0);
    Buffer.from("koly", "ascii").copy(bytes, 0); // canonical trailer offset for 512-byte file
    fs.writeFileSync(dmg, bytes);
    const capture = captureTreeV0(dmg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: dmg, capture });
    assert(!res.ok, "package adapter should fail closed for dmg with trailer marker but tiny structural size");
    assertEq(res.failCode, "PACKAGE_FORMAT_MISMATCH", "expected PACKAGE_FORMAT_MISMATCH for tiny dmg structural size");
  }

  {
    const tmp = mkTmp();
    const dmg = path.join(tmp, "sample.dmg");
    const bytes = Buffer.alloc(8192, 0);
    Buffer.from("koly", "ascii").copy(bytes, bytes.length - 512);
    fs.writeFileSync(dmg, bytes);
    const capture = captureTreeV0(dmg, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: dmg, capture });
    assert(res.ok, "package adapter should parse dmg trailer hints");
    assertEq(res.summary?.sourceClass, "package", "dmg package class mismatch");
    assertEq(res.summary?.counts.dmgKolyTrailerPresent, 1, "dmg koly trailer marker missing");
    assert((res.summary?.reasonCodes ?? []).includes("EXECUTION_WITHHELD_INSTALLER"), "dmg installer withheld reason missing");
  }

  {
    const tmp = mkTmp();
    const badDocm = path.join(tmp, "bad.docm");
    fs.writeFileSync(badDocm, "not-a-zip-office-doc", "utf8");
    const badCapture = captureTreeV0(badDocm, limits);
    const badRes = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: badDocm, capture: badCapture });
    assert(!badRes.ok, "document adapter should fail closed for invalid docm container");
    assertEq(badRes.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for invalid docm");
  }

  {
    const tmp = mkTmp();
    const badStructureDocm = path.join(tmp, "bad_structure.docm");
    writeStoredZip(badStructureDocm, [{ name: "word/document.xml", text: "<w:document/>" }]);
    const capture = captureTreeV0(badStructureDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: badStructureDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm missing OOXML structure");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for missing OOXML structure");
  }

  {
    const tmp = mkTmp();
    const partialDocm = path.join(tmp, "partial.docm");
    writeStoredZip(partialDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    corruptSecondZipCentralSignature(partialDocm);
    const capture = captureTreeV0(partialDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: partialDocm, capture });
    assert(!res.ok, "document adapter should fail closed when OOXML ZIP metadata is partial after parsed entries");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for partial docm metadata");
  }

  {
    const tmp = mkTmp();
    const missingPrimaryDocm = path.join(tmp, "missing_primary.docm");
    writeStoredZip(missingPrimaryDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/_rels/document.xml.rels", text: "<Relationships></Relationships>" },
    ]);
    const capture = captureTreeV0(missingPrimaryDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: missingPrimaryDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm missing primary document part");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit docm missing primary document part");
  }

  {
    const tmp = mkTmp();
    const missingPrimaryXlsm = path.join(tmp, "missing_primary.xlsm");
    writeStoredZip(missingPrimaryXlsm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "xl/_rels/workbook.xml.rels", text: "<Relationships></Relationships>" },
    ]);
    const capture = captureTreeV0(missingPrimaryXlsm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: missingPrimaryXlsm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit xlsm missing primary workbook part");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit xlsm missing primary workbook part");
  }

  {
    const tmp = mkTmp();
    const wrongRelDocm = path.join(tmp, "wrong_rel.docm");
    writeStoredZip(wrongRelDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "xl/_rels/workbook.xml.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const capture = captureTreeV0(wrongRelDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: wrongRelDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm with xlsm-only relationship marker");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for docm with mismatched relationship marker");
  }

  {
    const tmp = mkTmp();
    const wrongRelXlsm = path.join(tmp, "wrong_rel.xlsm");
    writeStoredZip(wrongRelXlsm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "word/_rels/document.xml.rels", text: "<Relationships></Relationships>" },
      { name: "xl/workbook.xml", text: "<workbook/>" },
    ]);
    const capture = captureTreeV0(wrongRelXlsm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: wrongRelXlsm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit xlsm with docm-only relationship marker");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for xlsm with mismatched relationship marker");
  }

  {
    const tmp = mkTmp();
    const duplicateContentTypesDocm = path.join(tmp, "duplicate_content_types.docm");
    writeStoredZip(duplicateContentTypesDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const capture = captureTreeV0(duplicateContentTypesDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: duplicateContentTypesDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm with duplicate [Content_Types].xml markers");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for duplicate [Content_Types].xml markers");
  }

  {
    const tmp = mkTmp();
    const duplicatePrimaryDocm = path.join(tmp, "duplicate_primary.docm");
    writeStoredZip(duplicatePrimaryDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const capture = captureTreeV0(duplicatePrimaryDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: duplicatePrimaryDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm with duplicate primary document parts");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for duplicate primary document parts");
  }

  {
    const tmp = mkTmp();
    const duplicateRootRelsDocm = path.join(tmp, "duplicate_root_rels.docm");
    writeStoredZip(duplicateRootRelsDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
    ]);
    const capture = captureTreeV0(duplicateRootRelsDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: duplicateRootRelsDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm with duplicate root relationship markers");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for duplicate OOXML relationship markers");
  }

  {
    const tmp = mkTmp();
    const caseCollisionDocm = path.join(tmp, "case_collision.docm");
    writeStoredZip(caseCollisionDocm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
      { name: "word/Scripts.js", text: "a" },
      { name: "word/scripts.js", text: "b" },
    ]);
    const capture = captureTreeV0(caseCollisionDocm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: caseCollisionDocm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit docm with case-colliding OOXML entry paths");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for case-colliding OOXML entry paths");
  }

  {
    const tmp = mkTmp();
    const pdf = path.join(tmp, "demo.pdf");
    fs.writeFileSync(
      pdf,
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nmacro javascript EmbeddedFile http://example.test\nxref\n0 2\n0000000000 65535 f \n0000000010 00000 n \ntrailer\n<< /Root 1 0 R /Size 2 >>\nstartxref\n42\n%%EOF\n",
      "utf8"
    );
    const capture = captureTreeV0(pdf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: pdf, capture });
    assert(res.ok, "document adapter should parse explicit pdf with header and EOF markers");
    assertEq(res.summary?.sourceClass, "document", "pdf source class mismatch");
    assert((res.summary?.counts.activeContentCount ?? 0) > 0, "pdf active content count missing");
  }

  {
    const tmp = mkTmp();
    const noEofPdf = path.join(tmp, "no_eof.pdf");
    fs.writeFileSync(noEofPdf, "%PDF-1.7\nmacro javascript EmbeddedFile http://example.test\n", "utf8");
    const capture = captureTreeV0(noEofPdf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: noEofPdf, capture });
    assert(!res.ok, "document adapter should fail closed for explicit pdf missing EOF marker");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit pdf missing EOF marker");
  }

  {
    const tmp = mkTmp();
    const noStructurePdf = path.join(tmp, "no_structure.pdf");
    fs.writeFileSync(noStructurePdf, "%PDF-1.7\nplaceholder text only\n%%EOF\n", "utf8");
    const capture = captureTreeV0(noStructurePdf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: noStructurePdf, capture });
    assert(!res.ok, "document adapter should fail closed for explicit pdf without structural markers");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit pdf without structural markers");
  }

  {
    const tmp = mkTmp();
    const noStartxrefPdf = path.join(tmp, "no_startxref.pdf");
    fs.writeFileSync(noStartxrefPdf, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "utf8");
    const capture = captureTreeV0(noStartxrefPdf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: noStartxrefPdf, capture });
    assert(!res.ok, "document adapter should fail closed for explicit pdf missing startxref marker");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit pdf missing startxref marker");
  }

  {
    const tmp = mkTmp();
    const looseObjPdf = path.join(tmp, "loose_obj.pdf");
    fs.writeFileSync(looseObjPdf, "%PDF-1.7\nobj token only trailer\n%%EOF\n", "utf8");
    const capture = captureTreeV0(looseObjPdf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: looseObjPdf, capture });
    assert(!res.ok, "document adapter should fail closed for explicit pdf with loose obj token and no object syntax");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit pdf missing object syntax");
  }

  {
    const tmp = mkTmp();
    const badPdf = path.join(tmp, "bad.pdf");
    fs.writeFileSync(badPdf, "not-a-pdf", "utf8");
    const capture = captureTreeV0(badPdf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: badPdf, capture });
    assert(!res.ok, "document adapter should fail closed for invalid explicit pdf header");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for invalid pdf");
  }

  {
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
    const capture = captureTreeV0(chm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: chm, capture });
    assert(res.ok, "document adapter should parse explicit CHM with minimum structural header evidence");
    assertEq(res.summary?.sourceClass, "document", "chm source class mismatch");
  }

  {
    const tmp = mkTmp();
    const tinyChm = path.join(tmp, "tiny.chm");
    const bytes = Buffer.alloc(8, 0);
    bytes[0] = 0x49;
    bytes[1] = 0x54;
    bytes[2] = 0x53;
    bytes[3] = 0x46;
    fs.writeFileSync(tinyChm, bytes);
    const capture = captureTreeV0(tinyChm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: tinyChm, capture });
    assert(!res.ok, "document adapter should fail closed for explicit CHM with tiny header-only input");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for tiny explicit CHM");
  }

  {
    const tmp = mkTmp();
    const rtf = path.join(tmp, "sample.rtf");
    fs.writeFileSync(rtf, "{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs20 sample text}", "utf8");
    const capture = captureTreeV0(rtf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: rtf, capture });
    assert(res.ok, "document adapter should parse explicit RTF with structural prolog/closing brace");
    assertEq(res.summary?.sourceClass, "document", "rtf source class mismatch");
  }

  {
    const tmp = mkTmp();
    const tinyRtf = path.join(tmp, "tiny.rtf");
    fs.writeFileSync(tinyRtf, "{\\rtf1}", "utf8");
    const capture = captureTreeV0(tinyRtf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: tinyRtf, capture });
    assert(!res.ok, "document adapter should fail closed for explicit RTF missing baseline control-word evidence");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit RTF missing baseline control-word evidence");
  }

  {
    const tmp = mkTmp();
    const noCloseRtf = path.join(tmp, "no_close.rtf");
    fs.writeFileSync(noCloseRtf, "{\\rtf1\\ansi sample text", "utf8");
    const capture = captureTreeV0(noCloseRtf, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: noCloseRtf, capture });
    assert(!res.ok, "document adapter should fail closed for explicit RTF missing closing brace");
    assertEq(res.failCode, "DOC_FORMAT_MISMATCH", "expected DOC_FORMAT_MISMATCH for explicit RTF missing closing brace");
  }

  {
    const tmp = mkTmp();
    const docm = path.join(tmp, "demo.docm");
    writeStoredZip(docm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "word/document.xml", text: "<w:document/>" },
      { name: "word/vbaProject.bin", text: "macro-data" },
      { name: "word/embeddings/oleObject1.bin", text: "ole-data" },
      {
        name: "word/_rels/document.xml.rels",
        text: "<Relationships><Relationship TargetMode=\"External\" Target=\"https://cdn.example.test/payload\"/></Relationships>",
      },
    ]);
    const capture = captureTreeV0(docm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: docm, capture });
    assert(res.ok, "document adapter should parse docm zip signals");
    assertEq(res.summary?.sourceClass, "document", "docm source class mismatch");
    assert((res.summary?.counts.activeContentCount ?? 0) > 0, "docm active content count missing");
    assert((res.summary?.counts.embeddedObjectCount ?? 0) > 0, "docm embedded object count missing");
    assert((res.summary?.counts.externalLinkCount ?? 0) > 0, "docm external link count missing");
  }

  {
    const tmp = mkTmp();
    const xlsm = path.join(tmp, "demo.xlsm");
    writeStoredZip(xlsm, [
      { name: "[Content_Types].xml", text: "<Types></Types>" },
      { name: "_rels/.rels", text: "<Relationships></Relationships>" },
      { name: "xl/workbook.xml", text: "<workbook/>" },
      { name: "xl/_rels/workbook.xml.rels", text: "<Relationships></Relationships>" },
      { name: "xl/vbaProject.bin", text: "macro-data" },
    ]);
    const capture = captureTreeV0(xlsm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: xlsm, capture });
    assert(res.ok, "document adapter should parse xlsm zip signals");
    assertEq(res.summary?.sourceClass, "document", "xlsm source class mismatch");
    assert((res.summary?.counts.activeContentCount ?? 0) > 0, "xlsm active content count missing");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      JSON.stringify({
        schemaVersion: 2,
        manifests: [
          { mediaType: "x", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          { mediaType: "y", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        ],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "y", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(res.ok, "container adapter should parse oci layout counts");
    assert((res.summary?.counts.ociManifestCount ?? 0) === 2, "oci manifest count mismatch");
    assert((res.summary?.counts.ociBlobCount ?? 0) === 2, "oci blob count mismatch");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_case_collision");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      JSON.stringify({
        schemaVersion: 2,
        manifests: [{ mediaType: "x", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits) as any;
    capture.entries = capture.entries.concat([
      { path: "blobs/sha256/Alpha", kind: "file", bytes: 1, digest: "sha256:a" },
      { path: "blobs/sha256/alpha", kind: "file", bytes: 1, digest: "sha256:b" },
    ]);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for explicit container directory with case-colliding entry paths");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for case-colliding container directory entry paths");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_digest_mismatch");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      JSON.stringify({ schemaVersion: 2, manifests: [{ digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }),
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for OCI layout digest refs that do not resolve to blobs");
    assertEq(res.failCode, "CONTAINER_LAYOUT_INVALID", "expected CONTAINER_LAYOUT_INVALID for OCI digest mismatch");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_missing_digest_refs");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      JSON.stringify({ schemaVersion: 2, manifests: [{ mediaType: "application/vnd.oci.image.manifest.v1+json" }] }),
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for OCI layout manifests missing digest references");
    assertEq(res.failCode, "CONTAINER_LAYOUT_INVALID", "expected CONTAINER_LAYOUT_INVALID for OCI layout missing digest refs");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_partial_digest_refs");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      JSON.stringify({
        schemaVersion: 2,
        manifests: [
          { digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          { mediaType: "application/vnd.oci.image.manifest.v1+json" },
        ],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for OCI layout with only partial manifest digest references");
    assertEq(res.failCode, "CONTAINER_LAYOUT_INVALID", "expected CONTAINER_LAYOUT_INVALID for OCI layout partial digest refs");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_bad_layout");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{ invalid-json", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), JSON.stringify({ schemaVersion: 2, manifests: [] }), "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for invalid explicit oci-layout metadata");
    assertEq(res.failCode, "CONTAINER_LAYOUT_INVALID", "expected CONTAINER_LAYOUT_INVALID for invalid oci-layout");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_bad_index");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), "{ invalid-json", "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for invalid explicit OCI index.json");
    assertEq(res.failCode, "CONTAINER_INDEX_INVALID", "expected CONTAINER_INDEX_INVALID for invalid OCI index");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_bad_index_shape");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), JSON.stringify({ schemaVersion: 2, manifests: {} }), "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for explicit OCI index manifests shape mismatch");
    assertEq(res.failCode, "CONTAINER_INDEX_INVALID", "expected CONTAINER_INDEX_INVALID for OCI index manifests shape mismatch");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_empty_manifests");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), JSON.stringify({ schemaVersion: 2, manifests: [] }), "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for explicit OCI index with empty manifests");
    assertEq(res.failCode, "CONTAINER_INDEX_INVALID", "expected CONTAINER_INDEX_INVALID for empty OCI manifests");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout_missing_blobs");
    fs.mkdirSync(ociDir, { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(ociDir, "index.json"), JSON.stringify({ schemaVersion: 2, manifests: [{ mediaType: "x" }] }), "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(!res.ok, "container adapter should fail closed for explicit OCI layout with manifests but missing blobs");
    assertEq(res.failCode, "CONTAINER_LAYOUT_INVALID", "expected CONTAINER_LAYOUT_INVALID for OCI layout missing blobs");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(res.ok, "container adapter should parse container tar entries");
    assert((res.summary?.counts.tarballScanPresent ?? 0) === 1, "container tar flag mismatch");
    assert((res.summary?.counts.tarEntryCount ?? 0) >= 3, "container tar entry count missing");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_no_layer.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "notes.txt", text: "placeholder" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit docker tar markers without layer tar evidence");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for docker tar markers without layer evidence");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_invalid_manifest_json.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: "[]" },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit docker tar invalid manifest payload");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for invalid docker manifest payload");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_invalid_repositories_map.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: {} }) },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit docker tar invalid repositories tag map");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for invalid repositories tag map");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_missing_config_ref.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit docker tar unresolved config reference");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for unresolved docker config reference");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_partial_layer_resolution.tar");
    writeSimpleTar(tarPath, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar", "missing/layer.tar"] }]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit docker tar partial layer reference resolution");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for partial docker layer resolution");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_partial_config_resolution.tar");
    writeSimpleTar(tarPath, [
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
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit docker tar partial config reference resolution");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for partial docker config resolution");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_nested_markers.tar");
    writeSimpleTar(tarPath, [
      {
        name: "nested/manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "nested/repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for docker tar markers that are not at canonical root paths");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for docker tar nested marker paths");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_duplicate_root_markers.tar");
    writeSimpleTar(tarPath, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "manifest.json", text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]) },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for docker tar duplicate root marker entries");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for docker tar duplicate root markers");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_case_collision_paths.tar");
    writeSimpleTar(tarPath, [
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
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for docker tar with case-colliding top-level entry paths");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for case-colliding container tar entry paths");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_partial_manifest_entry_shape.tar");
    writeSimpleTar(tarPath, [
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
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for docker tar partial manifest entry shape");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for docker tar partial manifest entry shape");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_duplicate_layer_ref_path.tar");
    writeSimpleTar(tarPath, [
      {
        name: "manifest.json",
        text: JSON.stringify([{ Config: "config.json", RepoTags: ["demo:latest"], Layers: ["layer.tar"] }]),
      },
      { name: "repositories", text: JSON.stringify({ demo: { latest: "sha256:abc" } }) },
      { name: "config.json", text: "{}" },
      { name: "layer.tar", text: "layer-bytes-a" },
      { name: "layer.tar", text: "layer-bytes-b" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for docker tar with duplicate referenced layer path");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for duplicate docker layer reference path");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container_partial.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: "[]" },
      { name: "repositories", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    fs.appendFileSync(tarPath, Buffer.alloc(512, 0x41));
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit container tar with partial metadata");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for partial container tar metadata");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"size\":1}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(res.ok, "container adapter should parse OCI layout tar markers");
    assertEq(res.summary?.counts.ociLayoutPresent, 1, "OCI layout flag should be present for OCI tar");
    assertEq(res.summary?.counts.ociTarballPresent, 1, "OCI tarball flag should be present");
    assert((res.summary?.reasonCodes ?? []).includes("CONTAINER_OCI_LAYOUT"), "OCI layout reason code missing for OCI tar");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_missing_blobs.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      { name: "index.json", text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar markers without blobs");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for OCI tar missing blobs");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_digest_mismatch.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"size\":1}]}\n",
      },
      { name: "blobs/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", text: "x" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar digest refs that do not resolve to blobs");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for OCI tar digest mismatch");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_duplicate_blob_ref_path.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"size\":1}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x1" },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x2" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar with duplicate referenced blob path");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for duplicate OCI blob reference path");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_missing_digest_refs.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      { name: "index.json", text: "{\"schemaVersion\":2,\"manifests\":[{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"size\":1}]}\n" },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar manifests missing digest references");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for OCI tar missing digest refs");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_partial_digest_refs.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},{\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\"}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar with only partial manifest digest references");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for OCI tar partial digest refs");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_nested_markers.tar");
    writeSimpleTar(tarPath, [
      { name: "nested/oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "nested/index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar markers that are not at canonical root paths");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for OCI tar nested marker paths");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "oci_layout_duplicate_root_markers.tar");
    writeSimpleTar(tarPath, [
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      { name: "oci-layout", text: "{\"imageLayoutVersion\":\"1.0.0\"}\n" },
      {
        name: "index.json",
        text: "{\"schemaVersion\":2,\"manifests\":[{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]}\n",
      },
      { name: "blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", text: "x" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for OCI tar duplicate root marker entries");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for OCI tar duplicate root markers");
  }

  {
    const tmp = mkTmp();
    const badTarPath = path.join(tmp, "bad_container.tar");
    fs.writeFileSync(badTarPath, "not-a-container-tar", "utf8");
    const capture = captureTreeV0(badTarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: badTarPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit tar format mismatch");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for bad container tar");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "manifest.json_only.tar");
    writeSimpleTar(tarPath, [{ name: "notes.txt", text: "not a container tar" }]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(!res.ok, "container adapter should fail closed for tar filenames that only hint docker markers");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for docker-marker filename hint without tar marker entries");
  }

  {
    const tmp = mkTmp();
    const badComposePath = path.join(tmp, "compose.yaml");
    fs.writeFileSync(badComposePath, "not compose syntax", "utf8");
    const capture = captureTreeV0(badComposePath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: badComposePath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit compose format mismatch");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for bad compose");
  }

  {
    const tmp = mkTmp();
    const placeholderComposePath = path.join(tmp, "compose.yaml");
    fs.writeFileSync(placeholderComposePath, "services:\n  web:\n    restart: always\n", "utf8");
    const capture = captureTreeV0(placeholderComposePath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: placeholderComposePath, capture });
    assert(!res.ok, "container adapter should fail closed for compose placeholder without image/build hints");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for compose placeholder without image/build hints");
  }

  {
    const tmp = mkTmp();
    const outOfServiceImageComposePath = path.join(tmp, "compose.yaml");
    fs.writeFileSync(outOfServiceImageComposePath, "services:\n  web:\n    restart: always\nimage: nginx:latest\n", "utf8");
    const capture = captureTreeV0(outOfServiceImageComposePath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: outOfServiceImageComposePath, capture });
    assert(!res.ok, "container adapter should fail closed when compose image hint is outside service block");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for compose image hint outside service block");
  }

  {
    const tmp = mkTmp();
    const shallowComposePath = path.join(tmp, "compose.yaml");
    fs.writeFileSync(shallowComposePath, "services:\nimage: nginx:latest\n", "utf8");
    const capture = captureTreeV0(shallowComposePath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: shallowComposePath, capture });
    assert(!res.ok, "container adapter should fail closed for compose shell without indented service entries");
    assertEq(res.failCode, "CONTAINER_FORMAT_MISMATCH", "expected CONTAINER_FORMAT_MISMATCH for compose shell without service entries");
  }

  {
    const tmp = mkTmp();
    const buildComposePath = path.join(tmp, "compose.yaml");
    fs.writeFileSync(buildComposePath, "services:\n  web:\n    build: .\n", "utf8");
    const capture = captureTreeV0(buildComposePath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: buildComposePath, capture });
    assert(res.ok, "container adapter should accept compose with services and build hint");
    assert((res.summary?.counts.composeBuildHintCount ?? 0) > 0, "compose build hint count mismatch");
    assert((res.summary?.counts.composeServicesBlockCount ?? 0) > 0, "compose services block count mismatch");
  }

  {
    const tmp = mkTmp();
    const sbomPath = path.join(tmp, "demo.spdx.json");
    fs.writeFileSync(
      sbomPath,
      JSON.stringify({
        SPDXID: "SPDXRef-DOCUMENT",
        packages: [{ name: "a" }, { name: "b" }, { name: "c" }],
      }),
      "utf8"
    );
    const capture = captureTreeV0(sbomPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: sbomPath, capture });
    assert(res.ok, "container adapter should parse sbom package count");
    assert((res.summary?.counts.sbomPresent ?? 0) === 1, "sbom present flag mismatch");
    assert((res.summary?.counts.sbomPackageCount ?? 0) === 3, "sbom package count mismatch");
  }

  {
    const tmp = mkTmp();
    const sbomPath = path.join(tmp, "bad_sbom.json");
    fs.writeFileSync(sbomPath, "{ invalid-json", "utf8");
    const capture = captureTreeV0(sbomPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: sbomPath, capture });
    assert(!res.ok, "container adapter should fail closed for invalid explicit sbom json");
    assertEq(res.failCode, "CONTAINER_SBOM_INVALID", "expected CONTAINER_SBOM_INVALID for invalid sbom");
  }

  {
    const tmp = mkTmp();
    const sbomPath = path.join(tmp, "empty_sbom.spdx.json");
    fs.writeFileSync(
      sbomPath,
      JSON.stringify({
        SPDXID: "SPDXRef-DOCUMENT",
        packages: [],
      }),
      "utf8"
    );
    const capture = captureTreeV0(sbomPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: sbomPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit empty sbom package evidence");
    assertEq(res.failCode, "CONTAINER_SBOM_INVALID", "expected CONTAINER_SBOM_INVALID for empty sbom evidence");
  }

  {
    const tmp = mkTmp();
    const sbomPath = path.join(tmp, "shell_sbom.spdx.json");
    fs.writeFileSync(
      sbomPath,
      JSON.stringify({
        SPDXID: "SPDXRef-DOCUMENT",
        packages: [{}],
        components: [{ "bom-ref": "   " }],
      }),
      "utf8"
    );
    const capture = captureTreeV0(sbomPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: sbomPath, capture });
    assert(!res.ok, "container adapter should fail closed for explicit sbom with non-meaningful package/component shells");
    assertEq(res.failCode, "CONTAINER_SBOM_INVALID", "expected CONTAINER_SBOM_INVALID for non-meaningful sbom shells");
  }

  {
    const tmp = mkTmp();
    const badIso = path.join(tmp, "bad.iso");
    fs.writeFileSync(badIso, Buffer.from("not-an-iso", "utf8"));
    const badCapture = captureTreeV0(badIso, limits);
    const badRes = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: badIso, capture: badCapture });
    assert(!badRes.ok, "image adapter should fail closed for image header mismatch");
    assertEq(badRes.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for bad iso");
  }

  {
    const tmp = mkTmp();
    const iso = path.join(tmp, "sample.iso");
    const bytes = Buffer.alloc(18 * 2048, 0);
    bytes[16 * 2048] = 1; // primary volume descriptor
    Buffer.from("CD001", "ascii").copy(bytes, 16 * 2048 + 1);
    bytes[16 * 2048 + 6] = 1; // descriptor version
    bytes[17 * 2048] = 255; // descriptor set terminator
    Buffer.from("CD001", "ascii").copy(bytes, 17 * 2048 + 1);
    bytes[17 * 2048 + 6] = 1;
    fs.writeFileSync(iso, bytes);
    const capture = captureTreeV0(iso, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: iso, capture });
    assert(res.ok, "image adapter should parse iso pvd");
    assertEq(res.summary?.sourceClass, "image", "iso image class mismatch");
    assertEq(res.summary?.counts.isoPvdPresent, 1, "iso pvd should be detected");
    assertEq(res.summary?.counts.isoPvdVersionPresent, 1, "iso pvd version should be detected");
    assertEq(res.summary?.counts.isoTerminatorPresent, 1, "iso terminator should be detected");
    assert((res.summary?.counts.headerMatchCount ?? 0) > 0, "iso header match count missing");
  }

  {
    const tmp = mkTmp();
    const iso = path.join(tmp, "no_terminator.iso");
    const bytes = Buffer.alloc(18 * 2048, 0);
    bytes[16 * 2048] = 1; // primary volume descriptor
    Buffer.from("CD001", "ascii").copy(bytes, 16 * 2048 + 1);
    bytes[16 * 2048 + 6] = 1; // descriptor version
    fs.writeFileSync(iso, bytes);
    const capture = captureTreeV0(iso, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: iso, capture });
    assert(!res.ok, "image adapter should fail closed for explicit iso missing descriptor terminator");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for iso missing descriptor terminator");
  }

  {
    const tmp = mkTmp();
    const vhd = path.join(tmp, "sample.vhd");
    const bytes = Buffer.alloc(1024, 0);
    Buffer.from("conectix", "ascii").copy(bytes, bytes.length - 512);
    fs.writeFileSync(vhd, bytes);
    const capture = captureTreeV0(vhd, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: vhd, capture });
    assert(res.ok, "image adapter should parse vhd footer evidence with minimum structural size");
    assertEq(res.summary?.counts.vhdFooterPresent, 1, "vhd footer should be detected");
  }

  {
    const tmp = mkTmp();
    const tinyVhd = path.join(tmp, "tiny.vhd");
    const bytes = Buffer.alloc(512, 0);
    Buffer.from("conectix", "ascii").copy(bytes, 0);
    fs.writeFileSync(tinyVhd, bytes);
    const capture = captureTreeV0(tinyVhd, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: tinyVhd, capture });
    assert(!res.ok, "image adapter should fail closed for vhd footer-only file below structural minimum in strict route");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for tiny vhd footer-only file");
  }

  {
    const tmp = mkTmp();
    const qcow = path.join(tmp, "sample.qcow2");
    const bytes = Buffer.alloc(96, 0);
    bytes[0] = 0x51; // Q
    bytes[1] = 0x46; // F
    bytes[2] = 0x49; // I
    bytes[3] = 0xfb;
    bytes.writeUInt32BE(3, 4);
    fs.writeFileSync(qcow, bytes);
    const capture = captureTreeV0(qcow, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: qcow, capture });
    assert(res.ok, "image adapter should parse qcow2 header");
    assertEq(res.summary?.counts.qcowMagicPresent, 1, "qcow2 magic should be detected");
    assertEq(res.summary?.counts.qcowVersion, 3, "qcow2 version mismatch");
    assertEq(res.summary?.counts.qcowVersionSupported, 1, "qcow2 version support flag mismatch");
  }

  {
    const tmp = mkTmp();
    const qcow = path.join(tmp, "tiny_valid_header.qcow2");
    const bytes = Buffer.alloc(16, 0);
    bytes[0] = 0x51; // Q
    bytes[1] = 0x46; // F
    bytes[2] = 0x49; // I
    bytes[3] = 0xfb;
    bytes.writeUInt32BE(3, 4);
    fs.writeFileSync(qcow, bytes);
    const capture = captureTreeV0(qcow, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: qcow, capture });
    assert(!res.ok, "image adapter should fail closed for qcow2 header that is structurally too small in strict route");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for tiny qcow2 header");
  }

  {
    const tmp = mkTmp();
    const qcow = path.join(tmp, "bad_version.qcow2");
    const bytes = Buffer.alloc(32, 0);
    bytes[0] = 0x51; // Q
    bytes[1] = 0x46; // F
    bytes[2] = 0x49; // I
    bytes[3] = 0xfb;
    bytes.writeUInt32BE(1, 4); // unsupported qcow2 version
    fs.writeFileSync(qcow, bytes);
    const capture = captureTreeV0(qcow, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: qcow, capture });
    assert(!res.ok, "image adapter should fail closed for unsupported qcow2 version");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for unsupported qcow2 version");
  }

  {
    const tmp = mkTmp();
    const vhdx = path.join(tmp, "sample.vhdx");
    const bytes = Buffer.alloc(64 * 1024, 0);
    Buffer.from("vhdxfile", "ascii").copy(bytes, 0);
    fs.writeFileSync(vhdx, bytes);
    const capture = captureTreeV0(vhdx, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: vhdx, capture });
    assert(res.ok, "image adapter should parse vhdx signature");
    assertEq(res.summary?.counts.vhdxSignaturePresent, 1, "vhdx signature should be detected");
  }

  {
    const tmp = mkTmp();
    const vhdx = path.join(tmp, "tiny.vhdx");
    const bytes = Buffer.alloc(256, 0);
    Buffer.from("vhdxfile", "ascii").copy(bytes, 0);
    fs.writeFileSync(vhdx, bytes);
    const capture = captureTreeV0(vhdx, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: vhdx, capture });
    assert(!res.ok, "image adapter should fail closed for vhdx signature-only file below structural minimum in strict route");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for tiny vhdx header-only file");
  }

  {
    const tmp = mkTmp();
    const vmdk = path.join(tmp, "sample.vmdk");
    fs.writeFileSync(
      vmdk,
      [
        "# Disk DescriptorFile",
        "version=1",
        "CID=fffffffe",
        "parentCID=ffffffff",
        "createType=\"monolithicSparse\"",
        "RW 204800 SPARSE \"disk-s001.vmdk\"",
      ].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(vmdk, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: vmdk, capture });
    assert(res.ok, "image adapter should parse structural vmdk descriptor evidence");
    assertEq(res.summary?.counts.vmdkDescriptorStructuralPresent, 1, "vmdk structural descriptor flag should be detected");
  }

  {
    const tmp = mkTmp();
    const tinyDescriptorVmdk = path.join(tmp, "tiny_descriptor.vmdk");
    fs.writeFileSync(tinyDescriptorVmdk, "# Disk DescriptorFile\ncreateType=\"x\"\nRW 1 SPARSE \"a\"\n", "utf8");
    const capture = captureTreeV0(tinyDescriptorVmdk, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: tinyDescriptorVmdk, capture });
    assert(!res.ok, "image adapter should fail closed for tiny vmdk descriptor-only file below structural minimum in strict route");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for tiny vmdk descriptor-only file");
  }

  {
    const tmp = mkTmp();
    const vmdk = path.join(tmp, "weak_hints.vmdk");
    fs.writeFileSync(vmdk, "createType=\"monolithicSparse\"\n", "utf8");
    const capture = captureTreeV0(vmdk, limits);
    const res = runArtifactAdapterV1({ selection: "image", enabledPlugins: [], inputPath: vmdk, capture });
    assert(!res.ok, "image adapter should fail closed for weak vmdk descriptor hints");
    assertEq(res.failCode, "IMAGE_FORMAT_MISMATCH", "expected IMAGE_FORMAT_MISMATCH for weak vmdk descriptor hints");
  }

  {
    const tmp = mkTmp();
    const pem = path.join(tmp, "chain.pem");
    fs.writeFileSync(
      pem,
      [
        "-----BEGIN CERTIFICATE-----",
        "MIIB",
        "-----END CERTIFICATE-----",
        "-----BEGIN CERTIFICATE-----",
        "MIIC",
        "-----END CERTIFICATE-----",
        "# timestamp countersignature present",
      ].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(pem, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: pem, capture });
    assert(res.ok, "signature adapter should parse pem chain");
    assertEq(res.summary?.sourceClass, "signature", "signature class mismatch");
    assert((res.summary?.counts.pemCertificateCount ?? 0) === 2, "pem certificate count mismatch");
    assert((res.summary?.counts.chainPresent ?? 0) === 1, "chain presence flag mismatch");
    assert((res.summary?.counts.timestampPresent ?? 0) === 1, "timestamp presence flag mismatch");
    assert((res.summary?.reasonCodes ?? []).includes("SIGNER_PRESENT"), "missing SIGNER_PRESENT reason");
  }

  {
    const tmp = mkTmp();
    const p7b = path.join(tmp, "sample.p7b");
    const bytes = Buffer.concat([
      Buffer.from([0x30, 0x82, 0x00, 0x10]),
      Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]), // cms signedData oid
      Buffer.from([0x06, 0x08, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x08]), // timestamp EKU oid
    ]);
    fs.writeFileSync(p7b, bytes);
    const capture = captureTreeV0(p7b, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: p7b, capture });
    assert(res.ok, "signature adapter should parse binary oid hints");
    assert((res.summary?.counts.cmsSignedDataOidCount ?? 0) > 0, "cms signedData oid count missing");
    assert((res.summary?.counts.timestampOidCount ?? 0) > 0, "timestamp oid count missing");
    assert((res.summary?.counts.signerPresent ?? 0) === 1, "signer presence should be set");
  }

  {
    const tmp = mkTmp();
    const cer = path.join(tmp, "sample.cer");
    const bytes = Buffer.alloc(143, 0);
    bytes[0] = 0x30;
    bytes[1] = 0x81;
    bytes[2] = 0x8c;
    Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]).copy(bytes, 20); // 2.5.4.3 (commonName)
    fs.writeFileSync(cer, bytes);
    const capture = captureTreeV0(cer, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: cer, capture });
    assert(res.ok, "explicit signature adapter should accept DER cert evidence with x509 name OID markers");
    assert((res.summary?.counts.x509NameOidCount ?? 0) > 0, "x509 name oid count should be present");
  }

  {
    const tmp = mkTmp();
    const cer = path.join(tmp, "no_x509.cer");
    const bytes = Buffer.alloc(143, 0);
    bytes[0] = 0x30;
    bytes[1] = 0x81;
    bytes[2] = 0x8c;
    fs.writeFileSync(cer, bytes);
    const capture = captureTreeV0(cer, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: cer, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for DER cert input without x509 name OID evidence");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for DER cert input without x509 name OID");
  }

  {
    const tmp = mkTmp();
    const p7b = path.join(tmp, "bad_der_len.p7b");
    const bytes = Buffer.from([0x30, 0x82, 0xff, 0xff, 0x01, 0x02, 0x03]);
    fs.writeFileSync(p7b, bytes);
    const capture = captureTreeV0(p7b, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: p7b, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for malformed DER envelope length");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for malformed DER envelope length");
  }

  {
    const tmp = mkTmp();
    const badPem = path.join(tmp, "bad.pem");
    fs.writeFileSync(badPem, "plain text not signature material", "utf8");
    const capture = captureTreeV0(badPem, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: badPem, capture });
    assert(!res.ok, "explicit signature adapter should fail closed on invalid signature material");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "signature mismatch fail code");
  }

  {
    const tmp = mkTmp();
    const malformedPemPayload = path.join(tmp, "malformed_payload.pem");
    fs.writeFileSync(
      malformedPemPayload,
      ["-----BEGIN CERTIFICATE-----", "%%%%", "-----END CERTIFICATE-----"].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(malformedPemPayload, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: malformedPemPayload, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for malformed PEM envelope payload");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for malformed PEM envelope payload");
  }

  {
    const tmp = mkTmp();
    const sigWithCertEnvelope = path.join(tmp, "sig_with_cert_envelope.sig");
    fs.writeFileSync(
      sigWithCertEnvelope,
      ["-----BEGIN CERTIFICATE-----", "MIIB", "-----END CERTIFICATE-----"].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(sigWithCertEnvelope, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: sigWithCertEnvelope, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for .sig input with certificate-only envelope evidence");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for .sig extension-envelope mismatch");
  }

  {
    const tmp = mkTmp();
    const p7bWithCertEnvelope = path.join(tmp, "p7b_with_cert_envelope.p7b");
    fs.writeFileSync(
      p7bWithCertEnvelope,
      ["-----BEGIN CERTIFICATE-----", "MIIB", "-----END CERTIFICATE-----"].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(p7bWithCertEnvelope, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: p7bWithCertEnvelope, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for .p7b input with certificate-only envelope evidence");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for .p7b extension-envelope mismatch");
  }

  {
    const tmp = mkTmp();
    const unknownEnvelopePem = path.join(tmp, "unknown_envelope.pem");
    fs.writeFileSync(
      unknownEnvelopePem,
      ["-----BEGIN FOO-----", "abcd", "-----END FOO-----"].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(unknownEnvelopePem, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: unknownEnvelopePem, capture });
    assert(!res.ok, "explicit signature adapter should fail closed on unknown PEM envelope");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for unknown PEM envelope");
  }

  {
    const tmp = mkTmp();
    const textHintsOnlySig = path.join(tmp, "text_hints_only.sig");
    fs.writeFileSync(textHintsOnlySig, "timestamp certificate-chain intermediate root-ca", "utf8");
    const capture = captureTreeV0(textHintsOnlySig, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: textHintsOnlySig, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for text-only signature hints without real signature envelope evidence");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for text-only signature hints");
  }

  {
    const tmp = mkTmp();
    const tinyDerSig = path.join(tmp, "tiny_der.sig");
    fs.writeFileSync(tinyDerSig, Buffer.from([0x30, 0x02, 0x01, 0x00]));
    const capture = captureTreeV0(tinyDerSig, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: tinyDerSig, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for tiny generic DER without signature envelope evidence");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for tiny DER signature input");
  }

  {
    const tmp = mkTmp();
    const largeDerSig = path.join(tmp, "large_der.sig");
    const bytes = Buffer.alloc(130, 0);
    bytes[0] = 0x30;
    bytes[1] = 0x81;
    bytes[2] = 0x7f;
    fs.writeFileSync(largeDerSig, bytes);
    const capture = captureTreeV0(largeDerSig, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: largeDerSig, capture });
    assert(!res.ok, "explicit signature adapter should fail closed for large generic DER .sig without signature envelope evidence");
    assertEq(res.failCode, "SIGNATURE_FORMAT_MISMATCH", "expected SIGNATURE_FORMAT_MISMATCH for large generic DER .sig input");
  }

  {
    const tmp = mkTmp();
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo, { recursive: true });
    const gitAvailable = runCmd("git", ["--version"]).ok;
    if (!gitAvailable) {
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.writeFileSync(path.join(repo, "a.txt"), "x", "utf8");
      const capture = captureTreeV0(repo, limits);
      const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
      assert(!res.ok, "explicit scm adapter should fail closed when git refs are unresolved");
      assertEq(res.failCode, "SCM_REF_UNRESOLVED", "expected SCM_REF_UNRESOLVED without git refs");
    } else {
      assert(runCmd("git", ["init"], repo).ok, "git init failed");
      fs.writeFileSync(path.join(repo, "a.txt"), "x", "utf8");
      assert(runCmd("git", ["add", "a.txt"], repo).ok, "git add failed");
      assert(
        runCmd(
          "git",
          ["-c", "user.name=weft", "-c", "user.email=weft@example.invalid", "-c", "commit.gpgSign=false", "commit", "-m", "init"],
          repo
        ).ok,
        "git commit failed"
      );
      const capture = captureTreeV0(repo, limits);
      const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
      assert(res.ok, "scm adapter should capture git repo evidence");
      assertEq(res.summary?.sourceClass, "scm", "scm source class mismatch");
      assertEq(res.summary?.counts.commitResolved, 1, "commit should resolve");
      assert((res.summary?.counts.treeEntryCount ?? 0) >= 1, "tree entry count missing");
      assert((res.summary?.counts.branchRefCount ?? 0) >= 1, "branch ref count missing");
      assert((res.summary?.reasonCodes ?? []).includes("SCM_TREE_CAPTURED"), "missing SCM_TREE_CAPTURED reason");

      // Dirty worktree evidence
      fs.writeFileSync(path.join(repo, "a.txt"), "y", "utf8"); // unstaged
      fs.writeFileSync(path.join(repo, "b.txt"), "z", "utf8"); // untracked then staged
      assert(runCmd("git", ["add", "b.txt"], repo).ok, "git add b.txt failed");
      const captureDirty = captureTreeV0(repo, limits);
      const dirty = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture: captureDirty });
      assert(dirty.ok, "scm adapter should capture dirty worktree evidence");
      assertEq(dirty.summary?.counts.worktreeDirty, 1, "dirty worktree flag missing");
      assert((dirty.summary?.counts.stagedPathCount ?? 0) >= 1, "staged path count missing");
      assert((dirty.summary?.counts.unstagedPathCount ?? 0) >= 1, "unstaged path count missing");
      assert((dirty.summary?.reasonCodes ?? []).includes("SCM_WORKTREE_DIRTY"), "missing SCM_WORKTREE_DIRTY reason");
    }
  }

  {
    const tmp = mkTmp();
    const repo = path.join(tmp, "repo_unresolved");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, "file.txt"), "x", "utf8");
    const capture = captureTreeV0(repo, limits);
    const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
    assert(!res.ok, "explicit scm adapter should fail closed for unresolved native .git refs");
    assertEq(res.failCode, "SCM_REF_UNRESOLVED", "expected SCM_REF_UNRESOLVED for unresolved native refs");
  }

  {
    const tmp = mkTmp();
    const repo = path.join(tmp, "pseudo_repo");
    const gitData = path.join(repo, ".gitdata");
    fs.mkdirSync(path.join(gitData, "refs", "heads"), { recursive: true });
    fs.mkdirSync(path.join(gitData, "refs", "tags"), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: .gitdata\n", "utf8");
    fs.writeFileSync(path.join(gitData, "HEAD"), "ref: refs/heads/main\n", "utf8");
    fs.writeFileSync(path.join(gitData, "refs", "heads", "main"), "0123456789abcdef0123456789abcdef01234567\n", "utf8");
    fs.writeFileSync(path.join(gitData, "refs", "tags", "v1.0.0"), "89abcdef0123456789abcdef0123456789abcdef\n", "utf8");
    fs.writeFileSync(path.join(repo, "a.txt"), "hello", "utf8");

    const capture = captureTreeV0(repo, limits);
    const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
    assert(res.ok, "scm adapter should support native .git fallback refs");
    assertEq(res.summary?.sourceClass, "scm", "pseudo scm source class mismatch");
    assertEq(res.summary?.counts.commitResolved, 1, "pseudo refs should resolve commit");
    assert((res.summary?.counts.branchRefCount ?? 0) >= 1, "pseudo branch ref count missing");
    assert((res.summary?.counts.tagRefCount ?? 0) >= 1, "pseudo tag ref count missing");
  }

  {
    const tmp = mkTmp();
    const repo = path.join(tmp, "pseudo_repo_partial");
    const gitData = path.join(repo, ".gitdata");
    fs.mkdirSync(path.join(gitData, "refs", "tags"), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: .gitdata\n", "utf8");
    fs.writeFileSync(path.join(gitData, "HEAD"), "ref: refs/heads/main\n", "utf8");
    // Intentionally do not create refs/heads/main to force partial native ref evidence.
    fs.writeFileSync(path.join(gitData, "refs", "tags", "v1.0.0"), "89abcdef0123456789abcdef0123456789abcdef\n", "utf8");
    fs.writeFileSync(path.join(repo, "a.txt"), "hello", "utf8");

    const capture = captureTreeV0(repo, limits);
    const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
    assert(!res.ok, "scm adapter should fail closed for partial native .git fallback refs in explicit mode");
    assertEq(res.failCode, "SCM_REF_UNRESOLVED", "expected SCM_REF_UNRESOLVED for partial native refs");
  }

  {
    const tmp = mkTmp();
    const repo = path.join(tmp, "pseudo_repo_case_collision");
    const gitData = path.join(repo, ".gitdata");
    fs.mkdirSync(path.join(gitData, "refs", "heads"), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: .gitdata\n", "utf8");
    fs.writeFileSync(path.join(gitData, "HEAD"), "ref: refs/heads/main\n", "utf8");
    fs.writeFileSync(path.join(gitData, "refs", "heads", "main"), "0123456789abcdef0123456789abcdef01234567\n", "utf8");
    fs.writeFileSync(path.join(repo, "a.txt"), "hello", "utf8");

    const capture = captureTreeV0(repo, limits) as any;
    capture.entries = capture.entries.concat([
      { path: "src/Alpha.txt", kind: "file", bytes: 1, digest: "sha256:a" },
      { path: "src/alpha.txt", kind: "file", bytes: 1, digest: "sha256:b" },
    ]);
    const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
    assert(!res.ok, "scm adapter should fail closed for explicit scm with case-colliding worktree entry paths");
    assertEq(res.failCode, "SCM_REF_UNRESOLVED", "expected SCM_REF_UNRESOLVED for case-colliding scm worktree entry paths");
  }
};

try {
  run();
  console.log("artifact_adapter_v1.test: PASS");
} catch (error) {
  console.error("artifact_adapter_v1.test: FAIL");
  console.error(error);
  process.exit(1);
}
