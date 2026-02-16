/* src/cli/adapter_cli_smoke.test.ts */

import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-adapter-cli-"));

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
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
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
    fs.writeFileSync(input, "macro javascript EmbeddedFile http://example.test", "utf8");
    const res = await runCliCapture(["safe-run", input, "--out", outDir, "--adapter", "document"]);
    assertEq(res.status, 0, `safe-run document should succeed\n${res.stderr}`);
    const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(safe.adapter?.adapterId, "document_adapter_v1", "document adapter id mismatch");
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
    const badIso = path.join(tmp, "bad.iso");
    fs.writeFileSync(badIso, "not-an-iso", "utf8");
    const badRes = await runCliCapture(["safe-run", badIso, "--out", outDir, "--adapter", "image"]);
    assertEq(badRes.status, 40, "safe-run should fail closed for image header mismatch");
    assert(badRes.stderr.includes("IMAGE_FORMAT_MISMATCH"), "expected IMAGE_FORMAT_MISMATCH on stderr");
  }

  {
    const outDir = mkTmp();
    const tmp = mkTmp();
    fs.mkdirSync(path.join(tmp, "oci_image"));
    fs.writeFileSync(path.join(tmp, "oci_image", "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(path.join(tmp, "oci_image", "index.json"), "{\"schemaVersion\":2}\n", "utf8");
    const res = await runCliCapture(["safe-run", path.join(tmp, "oci_image"), "--out", outDir, "--adapter", "container"]);
    assertEq(res.status, 0, `safe-run container should succeed\n${res.stderr}`);
    const safe = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(safe.adapter?.adapterId, "container_adapter_v1", "container adapter id mismatch");
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
