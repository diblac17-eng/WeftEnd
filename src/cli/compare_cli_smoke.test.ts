/* src/cli/compare_cli_smoke.test.ts */
/**
 * CLI smoke tests for `weftend compare`.
 */

import { runCliCapture } from "./cli_test_runner";
import { computeSafeRunReceiptDigestV0, validateCompareReceiptV0 } from "../core/validate";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";

declare const require: any;
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-compare-"));

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8").trim());

const listRelativeFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
    entries
      .slice()
      .sort((a, b) => {
        const an = String(a.name);
        const bn = String(b.name);
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
      })
      .forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          return;
        }
        const rel = path.relative(root, full).split(path.sep).join("/");
        out.push(rel);
      });
  };
  walk(root);
  return out;
};

const runSafeRunFixture = async (fixture: string, outDir: string): Promise<void> => {
  const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", fixture);
  const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
  const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", outDir]);
  assertEq(result.status, 0, `expected safe-run success\n${result.stderr}`);
  assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "expected safe_run_receipt.json");
};

const runSafeRunPath = async (inputPath: string, outDir: string): Promise<void> => {
  const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
  const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", outDir]);
  assertEq(result.status, 0, `expected safe-run success\n${result.stderr}`);
  assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "expected safe_run_receipt.json");
};

const runEmailSafeRunFixture = async (fixture: string, outDir: string): Promise<void> => {
  const inputPath = path.join(process.cwd(), "tests", "fixtures", "email", fixture);
  const result = await runCliCapture(["email", "safe-run", inputPath, "--out", outDir]);
  assertEq(result.status, 0, `expected email safe-run success\n${result.stderr}`);
  assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "expected safe_run_receipt.json");
};

suite("cli/compare", () => {
  register("compare writes deterministic receipt/report and passes privacy lint", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    await runSafeRunFixture("safe_no_caps", leftDir);
    await runSafeRunFixture("net_attempt", rightDir);

    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outDir]);
    assertEq(result.status, 0, `expected compare success\n${result.stderr}`);
    assert(result.stdout.includes("COMPARE CHANGED"), "expected CHANGED summary line");
    assert(result.stdout.includes("privacyLint=PASS"), "expected privacyLint=PASS summary");

    const compareReceiptPath = path.join(outDir, "compare_receipt.json");
    const compareReportPath = path.join(outDir, "compare_report.txt");
    const operatorPath = path.join(outDir, "operator_receipt.json");
    const compareStagePath = `${outDir}.stage`;
    assert(fs.existsSync(compareReceiptPath), "expected compare_receipt.json");
    assert(fs.existsSync(compareReportPath), "expected compare_report.txt");
    assert(fs.existsSync(operatorPath), "expected operator_receipt.json");
    assert(!fs.existsSync(compareStagePath), "compare stage directory must not remain after finalize");
    const receipt = readJson(compareReceiptPath);
    const issues = validateCompareReceiptV0(receipt, "compareReceipt");
    assertEq(issues.length, 0, "expected compare receipt to validate");
    assertEq(receipt.schemaVersion, 0, "expected schemaVersion 0");
    assert(receipt.weftendBuild && receipt.weftendBuild.algo === "sha256", "expected weftendBuild");
    assertEq(receipt.privacyLint, "PASS", "expected receipt privacy lint pass");
    const operator = readJson(operatorPath);
    assert(Array.isArray(operator.receipts), "expected operator receipts array");
    const relPaths = operator.receipts.map((r: any) => String(r.relPath || ""));
    assert(relPaths.includes("compare_receipt.json"), "operator receipt must include compare_receipt.json");
    assert(relPaths.includes("compare_report.txt"), "operator receipt must include compare_report.txt");
    assert(relPaths.includes("weftend/README.txt"), "operator receipt must include weftend/README.txt");
    assert(relPaths.includes("weftend/privacy_lint_v0.json"), "operator receipt must include weftend/privacy_lint_v0.json");
    const digestLines = operator.receipts.map((r: any) => String(r.digest || ""));
    assert(digestLines.every((d: string) => /^sha256:[a-f0-9]{64}$/.test(d)), "operator receipt digests must be sha256:<64hex>");
    const relPathSet = new Set(relPaths);
    const producedFiles = listRelativeFiles(outDir);
    const stageResidue = producedFiles.filter((rel) => rel.endsWith(".stage"));
    assertEq(stageResidue.length, 0, `compare output must not include staged file residue\n${stageResidue.join(",")}`);
    const orphans = producedFiles.filter((rel) => rel !== "operator_receipt.json" && !relPathSet.has(rel));
    assertEq(orphans.length, 0, `compare output must not include orphan files\n${orphans.join(",")}`);

    const report = fs.readFileSync(compareReportPath, "utf8");
    assert(report.includes("EVIDENCE TAGS:"), "compare report must include evidence tags legend");
    assert(report.includes("evidence.verdict=[POL]"), "compare report must include verdict evidence claim");
    assert(report.includes("evidence.buckets=[INF]"), "compare report must include bucket evidence claim");
    assert(report.includes("evidence.artifactDigest=[OBS]"), "compare report must include artifact digest evidence claim");
    assert(!/[A-Za-z]:\\/.test(report), "compare report must not include absolute Windows paths");
    assert(!/\/Users\//.test(report), "compare report must not include user paths");
    assert(!/HOME=/.test(report), "compare report must not include env markers");

    const privacy = runPrivacyLintV0({ root: outDir, weftendBuild: receipt.weftendBuild });
    assertEq(privacy.report.verdict, "PASS", "expected compare output privacy lint pass");
  });

  register("compare returns SAME for identical roots", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "same");
    const outDir = path.join(root, "cmp");
    await runSafeRunFixture("safe_no_caps", leftDir);
    const result = await runCliCapture(["compare", leftDir, leftDir, "--out", outDir]);
    assertEq(result.status, 0, `expected compare success\n${result.stderr}`);
    assert(result.stdout.includes("COMPARE SAME"), "expected SAME summary");
    const receipt = readJson(path.join(outDir, "compare_receipt.json"));
    assertEq(receipt.verdict, "SAME", "expected SAME verdict");
  });

  register("compare finalize replaces stale output roots", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    await runSafeRunFixture("safe_no_caps", leftDir);
    await runSafeRunFixture("net_attempt", rightDir);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale_marker.txt"), "old", "utf8");

    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outDir]);
    assertEq(result.status, 0, `expected compare success\n${result.stderr}`);
    assert(fs.existsSync(path.join(outDir, "compare_receipt.json")), "expected compare_receipt.json after finalize");
    assert(!fs.existsSync(path.join(outDir, "stale_marker.txt")), "stale out-root files must be replaced during finalize");
    assert(!fs.existsSync(`${outDir}.stage`), "compare stage directory must not remain after finalize");
  });

  register("compare reports content buckets for divergent inputs", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    const nativePath = path.join(process.cwd(), "tests", "fixtures", "intake", "native_app_stub", "app.exe");
    const webPath = path.join(process.cwd(), "tests", "fixtures", "intake", "web_export_stub");
    await runSafeRunPath(nativePath, leftDir);
    await runSafeRunPath(webPath, rightDir);

    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outDir]);
    assertEq(result.status, 0, `expected compare success\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "compare_receipt.json"));
    assert(receipt.changeBuckets.includes("KIND_PROFILE_CHANGED"), "expected KIND_PROFILE_CHANGED bucket");
    assert(receipt.changeBuckets.includes("CONTENT_CHANGED"), "expected CONTENT_CHANGED bucket");
    assert(receipt.changeBuckets.includes("EXTERNALREFS_CHANGED"), "expected EXTERNALREFS_CHANGED bucket");
  });

  register("compare fails closed when left receipt contains absolute path key", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    fs.mkdirSync(leftDir, { recursive: true });
    const unsafe: any = {
        schema: "weftend.safeRunReceipt/0",
        v: 0,
        schemaVersion: 0,
        weftendBuild: { algo: "sha256", digest: "sha256:11111111", source: "NODE_MAIN_JS" },
        inputKind: "raw",
        artifactKind: "TEXT",
        entryHint: null,
        analysisVerdict: "WITHHELD",
        executionVerdict: "NOT_ATTEMPTED",
        topReasonCode: "SAFE_RUN_EXECUTION_NOT_REQUESTED",
        policyId: "sha256:22222222",
        execution: { result: "WITHHELD", reasonCodes: ["SAFE_RUN_EXECUTION_NOT_REQUESTED"] },
        subReceipts: [],
        receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "C:\\\\Users\\\\leak": "BAD",
      };
    unsafe.receiptDigest = computeSafeRunReceiptDigestV0(unsafe);
    fs.writeFileSync(path.join(leftDir, "safe_run_receipt.json"), JSON.stringify(unsafe), "utf8");
    await runSafeRunFixture("safe_no_caps", rightDir);
    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outDir]);
    assertEq(result.status, 40, "expected fail-closed exit code");
    assert(result.stderr.includes("COMPARE_LEFT_RECEIPT_INVALID") || result.stderr.includes("RECEIPT_OLD_CONTRACT"), "expected invalid receipt reason");
  });

  register("compare fails closed when left root is missing", async () => {
    const root = makeTempDir();
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    await runSafeRunFixture("safe_no_caps", rightDir);
    const missing = path.join(root, "missing");
    const result = await runCliCapture(["compare", missing, rightDir, "--out", outDir]);
    assertEq(result.status, 40, "expected fail-closed exit code");
    assert(result.stderr.includes("COMPARE_LEFT_RECEIPT_MISSING"), "expected left missing reason code");
  });

  register("compare fails closed when out root overlaps input roots", async () => {
    const root = makeTempDir();
    const inputsRoot = path.join(root, "inputs");
    const leftDir = path.join(inputsRoot, "left");
    const rightDir = path.join(inputsRoot, "right");
    await runSafeRunFixture("safe_no_caps", leftDir);
    await runSafeRunFixture("net_attempt", rightDir);

    const outAsLeft = await runCliCapture(["compare", leftDir, rightDir, "--out", leftDir]);
    assertEq(outAsLeft.status, 40, "expected fail-closed exit when out equals left root");
    assert(outAsLeft.stderr.includes("COMPARE_OUT_CONFLICTS_INPUT"), "expected out/input conflict reason for left");

    const outAsRight = await runCliCapture(["compare", leftDir, rightDir, "--out", rightDir]);
    assertEq(outAsRight.status, 40, "expected fail-closed exit when out equals right root");
    assert(outAsRight.stderr.includes("COMPARE_OUT_CONFLICTS_INPUT"), "expected out/input conflict reason for right");

    const outNestedInLeft = await runCliCapture(["compare", leftDir, rightDir, "--out", path.join(leftDir, "cmp")]);
    assertEq(outNestedInLeft.status, 40, "expected fail-closed exit when out is nested under left root");
    assert(outNestedInLeft.stderr.includes("COMPARE_OUT_CONFLICTS_INPUT"), "expected overlap reason for nested left out");

    const outParentOfInputs = await runCliCapture(["compare", leftDir, rightDir, "--out", inputsRoot]);
    assertEq(outParentOfInputs.status, 40, "expected fail-closed exit when out is parent of input roots");
    assert(outParentOfInputs.stderr.includes("COMPARE_OUT_CONFLICTS_INPUT"), "expected overlap reason for parent out");
  });

  register("compare fails closed when out path is an existing file", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    await runSafeRunFixture("safe_no_caps", leftDir);
    await runSafeRunFixture("net_attempt", rightDir);
    const outFile = path.join(root, "cmp.txt");
    fs.writeFileSync(outFile, "keep", "utf8");
    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outFile]);
    assertEq(result.status, 40, `expected compare out-file fail-closed exit code\n${result.stderr}`);
    assert(result.stderr.includes("COMPARE_OUT_PATH_NOT_DIRECTORY"), "expected compare out-file code");
    assertEq(fs.readFileSync(outFile, "utf8"), "keep", "existing out file must not be replaced");
    assert(!fs.existsSync(`${outFile}.stage`), "compare stage dir must not be created when out is a file");
  });

  register("compare fails closed when parent of out path is a file", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    await runSafeRunFixture("safe_no_caps", leftDir);
    await runSafeRunFixture("net_attempt", rightDir);
    const parentFile = path.join(root, "parent-file.txt");
    fs.writeFileSync(parentFile, "keep", "utf8");
    const outPath = path.join(parentFile, "cmp");
    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outPath]);
    assertEq(result.status, 40, `expected compare out-parent-file fail-closed exit code\n${result.stderr}`);
    assert(result.stderr.includes("COMPARE_OUT_PATH_PARENT_NOT_DIRECTORY"), "expected compare out parent-file code");
    assertEq(fs.readFileSync(parentFile, "utf8"), "keep", "parent file must not be modified");
    assert(!fs.existsSync(`${outPath}.stage`), "compare stage dir must not be created when out parent is a file");
  });

  register("compare fails closed on old-contract receipts", async () => {
    const root = makeTempDir();
    const oldDir = path.join(root, "old");
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldDir, "operator_receipt.json"),
      JSON.stringify({
        schema: "weftend.operatorReceipt/0",
        v: 0,
        command: "safe-run",
        outRootDigest: "sha256:11111111",
        receipts: [],
        warnings: [],
        receiptDigest: "sha256:22222222",
      }),
      "utf8"
    );
    await runSafeRunFixture("safe_no_caps", rightDir);
    const result = await runCliCapture(["compare", oldDir, rightDir, "--out", outDir]);
    assertEq(result.status, 40, "expected fail-closed exit code");
    assert(result.stderr.includes("RECEIPT_OLD_CONTRACT"), "expected old-contract reason code");
  });

  register("compare captures adapter-driven deltas for email inputs", async () => {
    const root = makeTempDir();
    const leftDir = path.join(root, "left");
    const rightDir = path.join(root, "right");
    const outDir = path.join(root, "cmp");
    await runEmailSafeRunFixture("simple_html.eml", leftDir);
    await runEmailSafeRunFixture("with_attachment.eml", rightDir);
    const result = await runCliCapture(["compare", leftDir, rightDir, "--out", outDir]);
    assertEq(result.status, 0, `expected compare success\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "compare_receipt.json"));
    assert(receipt.changeBuckets.includes("CONTENT_CHANGED"), "expected CONTENT_CHANGED for adapter outputs");
    assert(receipt.changeBuckets.includes("DIGEST_CHANGED"), "expected DIGEST_CHANGED for adapter outputs");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`compare_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
