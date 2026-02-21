/* src/cli/summarize_export_cli_smoke.test.ts */
// CLI smoke tests for summarize + export-json integration helpers.

import { runCliCapture } from "./cli_test_runner";
import { validateNormalizedSummaryV0 } from "../integrations/contracts/normalized_summary_v0";

declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const assertEq = (actual: unknown, expected: unknown, message: string): void => {
  if (actual !== expected) throw new Error(`${message} (actual=${String(actual)} expected=${String(expected)})`);
};

const hasAbsPath = (text: string): boolean =>
  /\b[A-Za-z]:\\/.test(text) || /\/Users\//.test(text) || /\/home\//.test(text);

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-summary-"));

const readText = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const run = async (): Promise<void> => {
  const temp = makeTempDir();
  const outDir = path.join(temp, "run");
  const fixture = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
  const safe = await runCliCapture(["safe-run", fixture, "--out", outDir]);
  assertEq(safe.status, 0, `expected safe-run success\n${safe.stderr}`);

  const summarize = await runCliCapture(["summarize", outDir]);
  assertEq(summarize.status, 0, `expected summarize success\n${summarize.stderr}`);
  assert(summarize.stdout.includes("WEFTEND SUMMARY"), "summarize output missing header");
  assert(!hasAbsPath(summarize.stdout), "summarize output must not include absolute paths");

  const exportPath = path.join(temp, "normalized", "summary.json");
  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  fs.writeFileSync(exportPath, "stale", "utf8");
  const exported = await runCliCapture(["export-json", outDir, "--format", "normalized_v0", "--out", exportPath]);
  assertEq(exported.status, 0, `expected export-json success\n${exported.stderr}`);
  assert(fs.existsSync(exportPath), "normalized summary json missing");
  assert(!fs.existsSync(`${exportPath}.stage`), "export-json stage file must not remain after finalize");
  const raw = readText(exportPath);
  assert(raw !== "stale", "export-json output must replace stale file content");
  assert(!hasAbsPath(raw), "normalized summary must not include absolute paths");
  const parsed = JSON.parse(raw);
  const issues = validateNormalizedSummaryV0(parsed, "normalizedSummary");
  assertEq(issues.length, 0, "normalized summary should validate");

  const bad = await runCliCapture(["export-json", outDir, "--format", "other"]);
  assertEq(bad.status, 40, "unsupported format should fail closed");
};

run()
  .then(() => {
    console.log("summarize_export_cli_smoke.test: PASS");
  })
  .catch((error: unknown) => {
    console.error("summarize_export_cli_smoke.test: FAIL");
    console.error(error);
    process.exit(1);
  });
