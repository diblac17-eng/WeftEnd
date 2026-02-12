/* src/cli/run_cli_smoke.test.ts */
/**
 * CLI run smoke tests (deterministic receipts).
 */

import { runCliCapture } from "./cli_test_runner";
import { validateOperatorReceiptV0, validateRunReceiptV0 } from "../core/validate";
import { buildReceiptReadmeV0 } from "../runtime/receipt_readme";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";

declare const require: any;
declare const __dirname: string;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");

type TestFn = () => void | Promise<void>;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    fail(`${msg}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

const g: any = globalThis as any;
const hasBDD = typeof g.describe === "function" && typeof g.it === "function";
const localTests: Array<{ name: string; fn: TestFn }> = [];

function register(name: string, fn: TestFn): void {
  if (hasBDD) g.it(name, fn);
  else localTests.push({ name, fn });
}

function suite(name: string, define: () => void): void {
  if (hasBDD) g.describe(name, define);
  else define();
}

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-run-"));

const readJson = (dir: string, name: string) => {
  const raw = fs.readFileSync(path.join(dir, name), "utf8").trim();
  return JSON.parse(raw);
};

suite("cli/run", () => {
  register("run produces receipt even on deny", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "net_attempt");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["run", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 0, `expected zero exit code\n${result.stderr}`);
    const receipt = readJson(outDir, "run_receipt.json");
    assertEq(receipt.schema, "weftend.runReceipt/0", "expected run receipt schema");
    assertEq(receipt.intakeAction, "QUEUE", "expected QUEUE action");
    assertEq(receipt.modeRequested, "strict", "expected strict mode requested");
    assertEq(receipt.strictExecute.result, "SKIP", "expected strict execute skip on deny");
    assertEq(receipt.strictVerify.verdict, "DENY", "expected strict verify deny");
    assert(Array.isArray(receipt.artifactsWritten), "expected artifactsWritten array");
    assertEq(receipt.schemaVersion, 0, "expected schemaVersion 0");
    assert(receipt.weftendBuild && receipt.weftendBuild.algo === "fnv1a32", "expected weftendBuild block");

    const missingVersion = { ...receipt };
    delete (missingVersion as any).schemaVersion;
    const issuesMissing = validateRunReceiptV0(missingVersion, "receipt");
    assert(issuesMissing.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");

    const issuesWrong = validateRunReceiptV0({ ...receipt, schemaVersion: 1 }, "receipt");
    assert(issuesWrong.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");

    const readmePath = path.join(outDir, "weftend", "README.txt");
    assert(fs.existsSync(readmePath), "expected README.txt");
    const readme = fs.readFileSync(readmePath, "utf8");
    const expectedReadme = buildReceiptReadmeV0(receipt.weftendBuild, receipt.schemaVersion);
    assertEq(readme, expectedReadme, "README must match expected snapshot");
    assert(!/[A-Za-z]:\\/.test(readme), "README must not include absolute Windows paths");
    assert(!/\/Users\//.test(readme), "README must not include user paths");
    assert(!/HOME=/.test(readme), "README must not include env markers");

    const operatorPath = path.join(outDir, "operator_receipt.json");
    assert(fs.existsSync(operatorPath), "expected operator_receipt.json");
    const operator = JSON.parse(fs.readFileSync(operatorPath, "utf8"));
    const opIssues = validateOperatorReceiptV0(operator, "operatorReceipt");
    assertEq(opIssues.length, 0, "expected operator receipt to validate");

    const privacy = runPrivacyLintV0({ root: outDir, weftendBuild: receipt.weftendBuild });
    assertEq(privacy.report.verdict, "PASS", "expected privacy lint pass");
  });

  register("run deny is deterministic", async () => {
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "net_attempt");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const outA = makeTempDir();
    const outB = makeTempDir();
    const resultA = await runCliCapture(["run", inputPath, "--policy", policyPath, "--out", outA]);
    const resultB = await runCliCapture(["run", inputPath, "--policy", policyPath, "--out", outB]);
    assertEq(resultA.status, 0, `expected zero exit code\n${resultA.stderr}`);
    assertEq(resultB.status, 0, `expected zero exit code\n${resultB.stderr}`);
    const a = fs.readFileSync(path.join(outA, "run_receipt.json"), "utf8").trim();
    const b = fs.readFileSync(path.join(outB, "run_receipt.json"), "utf8").trim();
    assertEq(a, b, "expected run receipt to be deterministic");
  });

  register("summary reports build digest unavailable", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "net_attempt");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const prevArgv1 = process.argv[1];
    process.argv[1] = path.join(outDir, "missing_main.js");
    try {
      const result = await runCliCapture(["run", inputPath, "--policy", policyPath, "--out", outDir]);
      const combined = `${result.stdout}\n${result.stderr}`;
      assert(
        combined.includes("buildDigest=UNAVAILABLE (WEFTEND_BUILD_DIGEST_UNAVAILABLE)"),
        "expected build digest unavailable summary"
      );
      assert(combined.includes("privacyLint=PASS"), "expected privacy lint summary");
      assert(!/[A-Za-z]:\\/.test(combined), "summary must not include absolute paths");
      assert(!/\/Users\//.test(combined), "summary must not include user paths");
    } finally {
      process.argv[1] = prevArgv1;
    }
  });

  register("run allow path writes expected files", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["run", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 0, `expected APPROVE exit code\n${result.stderr}`);
    const decision = readJson(outDir, "intake_decision.json");
    assertEq(decision.action, "APPROVE", "expected APPROVE decision");
    const receipt = readJson(outDir, "run_receipt.json");
    assertEq(receipt.strictExecute.result, "SKIP", "expected strict execute skip by default");
    ["weftend_mint_v1.json", "weftend_mint_v1.txt", "intake_decision.json", "disclosure.txt", "appeal_bundle.json", "run_receipt.json"].forEach(
      (name) => {
        assert(fs.existsSync(path.join(outDir, name)), `expected ${name} to exist`);
      }
    );
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`run_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
