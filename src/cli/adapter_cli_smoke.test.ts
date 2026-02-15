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
    assert(parsed.adapters.length >= 3, "adapter list should include adapters");
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
