/* src/cli/safe_run_cli_smoke.test.ts */
/**
 * CLI safe-run smoke tests (deterministic receipts).
 */

import { runCliCapture } from "./cli_test_runner";
import { runSafeRun } from "./safe_run";
import { validateOperatorReceiptV0, validateSafeRunReceiptV0 } from "../core/validate";
import { installHostUpdateV0 } from "../runtime/host/host_update";
import { deriveDemoPublicKey } from "../ports/crypto-demo";
import { buildReceiptReadmeV0 } from "../runtime/receipt_readme";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "../core/intake_policy_v1";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-safe-run-"));

const readJson = (dir: string, name: string) => {
  const raw = fs.readFileSync(path.join(dir, name), "utf8").trim();
  return JSON.parse(raw);
};

const listStageResidue = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith(".stage")) out.push(path.relative(root, full).split(path.sep).join("/"));
      if (entry.isDirectory()) walk(full);
    });
  };
  walk(root);
  out.sort();
  return out;
};

const loadPolicyId = (policyPath: string): string => {
  const raw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  return computeWeftEndPolicyIdV1(canonicalizeWeftEndPolicyV1(raw));
};

const setupHostRoot = (): { hostRoot: string; trustRootPath: string } => {
  const hostRoot = makeTempDir();
  const trustRootPath = path.join(hostRoot, "trust_root.json");
  const keyId = "host-demo-key";
  const secret = "host-update-demo";
  const publicKey = deriveDemoPublicKey(secret);
  fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");
  const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
  const outDir = path.join(hostRoot, "receipts");
  const res = installHostUpdateV0({
    releaseDir,
    hostRoot,
    trustRootPath,
    signingSecret: secret,
    outDir,
  });
  assertEq(res.receipt.decision, "ALLOW", "expected host update allow");
  assertEq(res.receipt.apply.result, "APPLIED", "expected host update applied");
  return { hostRoot, trustRootPath };
};

suite("cli/safe-run", () => {
  register("safe-run on release dir executes host", async () => {
    const host = setupHostRoot();
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(
      ["safe-run", inputPath, "--policy", policyPath, "--out", outDir, "--execute"],
      { env: { WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(result.status, 0, `expected exit code 0\n${result.stderr}`);
    const receipt = readJson(outDir, "safe_run_receipt.json");
    assertEq(receipt.schema, "weftend.safeRunReceipt/0", "expected safe-run schema");
    assertEq(receipt.inputKind, "release", "expected release inputKind");
    assertEq(receipt.execution.result, "ALLOW", "expected ALLOW execute result");
    assertEq(receipt.analysisVerdict, "ALLOW", "expected ALLOW analysis verdict");
    assertEq(receipt.executionVerdict, "ALLOW", "expected ALLOW execution verdict");
    assertEq(receipt.artifactKind, "RELEASE_DIR", "expected RELEASE_DIR kind");
    assertEq(receipt.schemaVersion, 0, "expected schemaVersion 0");
    assert(receipt.weftendBuild && receipt.weftendBuild.algo === "sha256", "expected weftendBuild block");
    const readmePath = path.join(outDir, "weftend", "README.txt");
    assert(fs.existsSync(readmePath), "expected README.txt");
    const readme = fs.readFileSync(readmePath, "utf8");
    const expectedReadme = buildReceiptReadmeV0(receipt.weftendBuild, receipt.schemaVersion);
    assertEq(readme, expectedReadme, "README must match expected snapshot");
    assert(!/[A-Za-z]:\\/.test(readme), "README must not include absolute Windows paths");
    assert(!/\/Users\//.test(readme), "README must not include user paths");
    assert(!/HOME=/.test(readme), "README must not include env markers");
    const issues = validateSafeRunReceiptV0(receipt, "safeRunReceipt");
    assertEq(issues.length, 0, "expected valid receipt");
    const operatorPath = path.join(outDir, "operator_receipt.json");
    assert(fs.existsSync(operatorPath), "expected operator_receipt.json");
    const operator = JSON.parse(fs.readFileSync(operatorPath, "utf8"));
    const opIssues = validateOperatorReceiptV0(operator, "operatorReceipt");
    assertEq(opIssues.length, 0, "expected operator receipt to validate");
    const opEntries = Array.isArray(operator.receipts) ? operator.receipts : [];
    const hasReadmeEntry = opEntries.some((entry: any) => entry?.kind === "receipt_readme" && entry?.relPath === "weftend/README.txt");
    assert(hasReadmeEntry, "expected operator receipt to include README digest link");
    const opWarnings = Array.isArray(operator.warnings) ? operator.warnings : [];
    assert(
      !opWarnings.includes("SAFE_RUN_EVIDENCE_DIGEST_MISMATCH"),
      "safe-run evidence verification must not emit digest mismatch warnings in nominal release flow"
    );

    const combined = `${result.stdout}\n${result.stderr}`;
    assert(combined.includes("privacyLint=PASS"), "expected privacy lint summary");
    assert(combined.includes("kind=RELEASE_DIR"), "expected artifact kind in summary");
    const privacy = runPrivacyLintV0({ root: outDir, weftendBuild: receipt.weftendBuild });
    assertEq(privacy.report.verdict, "PASS", "expected privacy lint pass");

    const missingVersion = { ...receipt };
    delete (missingVersion as any).schemaVersion;
    const issuesMissing = validateSafeRunReceiptV0(missingVersion, "safeRunReceipt");
    assert(issuesMissing.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");

    const issuesWrong = validateSafeRunReceiptV0({ ...receipt, schemaVersion: 1 }, "safeRunReceipt");
    assert(issuesWrong.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");
  });

  register("safe-run raw input yields receipt even on skip", async () => {
    const host = setupHostRoot();
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(
      ["safe-run", inputPath, "--policy", policyPath, "--out", outDir],
      { env: { WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(outDir, "safe_run_receipt.json");
    assertEq(receipt.schema, "weftend.safeRunReceipt/0", "expected safe-run schema");
    assertEq(receipt.inputKind, "raw", "expected raw inputKind");
    assertEq(receipt.analysisVerdict, "WITHHELD", "expected WITHHELD analysis");
    assertEq(receipt.executionVerdict, "NOT_ATTEMPTED", "expected NOT_ATTEMPTED execution");
    assertEq(receipt.execution.result, "WITHHELD", "expected WITHHELD result");
    assert(
      receipt.execution.reasonCodes.includes("SAFE_RUN_EXECUTION_NOT_REQUESTED"),
      "expected SAFE_RUN_EXECUTION_NOT_REQUESTED"
    );
    const issues = validateSafeRunReceiptV0(receipt, "safeRunReceipt");
    assertEq(issues.length, 0, "expected valid receipt");
    const operatorPath = path.join(outDir, "operator_receipt.json");
    assert(fs.existsSync(operatorPath), "expected operator_receipt.json");
    const operator = JSON.parse(fs.readFileSync(operatorPath, "utf8"));
    const opIssues = validateOperatorReceiptV0(operator, "operatorReceipt");
    assertEq(opIssues.length, 0, "expected operator receipt to validate");
    const opEntries = Array.isArray(operator.receipts) ? operator.receipts : [];
    const hasAnalysisEntry = opEntries.some((entry: any) => entry?.kind === "analysis_receipt" && entry?.relPath === "analysis/intake_decision.json");
    assert(hasAnalysisEntry, "expected operator receipt to include analysis sub-receipt digest links");
    const opWarnings = Array.isArray(operator.warnings) ? operator.warnings : [];
    assert(
      !opWarnings.includes("SAFE_RUN_EVIDENCE_DIGEST_MISMATCH"),
      "safe-run evidence verification must not emit digest mismatch warnings in nominal raw flow"
    );
    const privacy = runPrivacyLintV0({ root: outDir, weftendBuild: receipt.weftendBuild });
    assertEq(privacy.report.verdict, "PASS", "expected privacy lint pass");
  });

  register("safe-run records orphan evidence warning without blocking analysis", async () => {
    const host = setupHostRoot();
    const outDir = makeTempDir();
    fs.mkdirSync(path.join(outDir, "analysis"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "analysis", "stale.txt"), "stale", "utf8");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(
      ["safe-run", inputPath, "--policy", policyPath, "--out", outDir],
      { env: { WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(result.status, 0, `expected analyze-only exit code with orphan warning\n${result.stderr}`);
    const operator = readJson(outDir, "operator_receipt.json");
    const warnings = Array.isArray(operator.warnings) ? operator.warnings : [];
    assert(warnings.includes("SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"), "expected orphan evidence warning in operator receipt");
    assert(!fs.existsSync(path.join(outDir, "analysis", "stale.txt")), "stale analysis output must be replaced during finalize");
    assert(!fs.existsSync(`${outDir}.stage`), "safe-run stage directory must not remain after finalize");
    assertEq(listStageResidue(outDir).length, 0, "safe-run output must not include staged file residue");
  });

  register("safe-run records orphan evidence warning for root-level stale outputs", async () => {
    const host = setupHostRoot();
    const outDir = makeTempDir();
    fs.writeFileSync(path.join(outDir, "stale_root.txt"), "stale", "utf8");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(
      ["safe-run", inputPath, "--policy", policyPath, "--out", outDir],
      { env: { WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(result.status, 0, `expected analyze-only exit code with root orphan warning\n${result.stderr}`);
    const operator = readJson(outDir, "operator_receipt.json");
    const warnings = Array.isArray(operator.warnings) ? operator.warnings : [];
    assert(warnings.includes("SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"), "expected root-level orphan evidence warning in operator receipt");
    assert(!fs.existsSync(path.join(outDir, "stale_root.txt")), "stale root output must be replaced during finalize");
    assert(!fs.existsSync(`${outDir}.stage`), "safe-run stage directory must not remain after finalize");
    assertEq(listStageResidue(outDir).length, 0, "safe-run output must not include staged file residue");
  });

  register("safe-run auto policy selection uses web default for html", async () => {
    const host = setupHostRoot();
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const expectedPolicy = path.join(process.cwd(), "policies", "web_component_default.json");
    const expectedId = loadPolicyId(expectedPolicy);
    const result = await runCliCapture(
      ["safe-run", inputPath, "--out", outDir],
      { env: { WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(outDir, "safe_run_receipt.json");
    assertEq(receipt.policyId, expectedId, "expected web default policyId");
  });

  register("safe-run .exe input is WITHHELD with exit 0", async () => {
    const outDir = makeTempDir();
    const exePath = path.join(outDir, "demo.exe");
    fs.writeFileSync(exePath, "MZ", "utf8");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", exePath, "--policy", policyPath, "--out", path.join(outDir, "run")]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.artifactKind, "NATIVE_EXE", "expected NATIVE_EXE kind");
    assertEq(receipt.analysisVerdict, "WITHHELD", "expected WITHHELD");
    assertEq(receipt.executionVerdict, "NOT_ATTEMPTED", "expected NOT_ATTEMPTED");
    assert(
      receipt.execution.reasonCodes.includes("ARTIFACT_NATIVE_BINARY_WITHHELD"),
      "expected native-binary withheld reason"
    );
  });

  register("safe-run content summary captures native stub signals", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "native_app_stub", "app.exe");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", path.join(outDir, "run")]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.contentSummary.targetKind, "nativeBinary", "expected nativeBinary targetKind");
    assertEq(receipt.contentSummary.artifactKind, "executable", "expected executable artifactKind");
    assertEq(receipt.contentSummary.hasNativeBinaries, true, "expected hasNativeBinaries true");
    assertEq(typeof receipt.contentSummary.totalFiles, "number", "expected totalFiles number");
  });

  register("safe-run content summary captures web export signals", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "web_export_stub");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", path.join(outDir, "run")]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.contentSummary.targetKind, "directory", "expected directory targetKind");
    assertEq(receipt.contentSummary.artifactKind, "webBundle", "expected webBundle artifactKind");
    assertEq(receipt.contentSummary.hasHtml, true, "expected hasHtml true");
    assert(receipt.contentSummary.externalRefs.count >= 1, "expected externalRefs count >= 1");
  });

  register("safe-run --withhold-exec on native stub writes withheld receipt", async () => {
    const outDir = makeTempDir();
    const sysPath = path.join(process.cwd(), "tests", "fixtures", "intake", "native_binary_stub", "notepad.exe");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture([
      "safe-run",
      sysPath,
      "--policy",
      policyPath,
      "--withhold-exec",
      "--out",
      path.join(outDir, "run"),
    ]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.artifactKind, "NATIVE_EXE", "expected NATIVE_EXE kind");
    assertEq(receipt.analysisVerdict, "WITHHELD", "expected WITHHELD");
    assertEq(receipt.executionVerdict, "NOT_ATTEMPTED", "expected NOT_ATTEMPTED");
    assertEq(receipt.execution.result, "WITHHELD", "expected WITHHELD execution result");
    assert(receipt.execution.reasonCodes.includes("SAFE_RUN_WITHHOLD_EXEC_REQUESTED"), "expected withhold flag reason");
    assert(receipt.execution.reasonCodes.includes("ARTIFACT_NATIVE_BINARY_WITHHELD"), "expected native withheld reason");
  });

  register("safe-run --withhold-exec on shortcut stub writes withheld receipt", async () => {
    const outDir = makeTempDir();
    const linkPath = path.join(process.cwd(), "tests", "fixtures", "intake", "shortcut_stub", "thing.lnk");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture([
      "safe-run",
      linkPath,
      "--policy",
      policyPath,
      "--withhold-exec",
      "--out",
      path.join(outDir, "run"),
    ]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.artifactKind, "SHORTCUT_LNK", "expected SHORTCUT_LNK kind");
    assertEq(receipt.execution.result, "WITHHELD", "expected WITHHELD execution result");
    assert(receipt.execution.reasonCodes.includes("ARTIFACT_SHORTCUT_UNSUPPORTED"), "expected shortcut withheld reason");
  });

  register("safe-run folder without entrypoint is WITHHELD with exit 0", async () => {
    const outDir = makeTempDir();
    const folder = path.join(outDir, "input");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "blob.bin"), "bin", "utf8");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", folder, "--policy", policyPath, "--out", path.join(outDir, "run")]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.analysisVerdict, "WITHHELD", "expected WITHHELD");
    assert(receipt.execution.reasonCodes.includes("SAFE_RUN_NO_ENTRYPOINT_FOUND"), "expected no entrypoint reason");
    assert(receipt.execution.reasonCodes.includes("ANALYSIS_ONLY_UNKNOWN_ARTIFACT"), "expected unknown-artifact reason");
    assert(
      !receipt.execution.reasonCodes.includes("EXECUTION_WITHHELD_UNSUPPORTED_ARTIFACT"),
      "expected unsupported-artifact code reserved for native/shortcut"
    );
  });

  register("safe-run html-like extensionless file is classified as webBundle summary", async () => {
    const outDir = makeTempDir();
    const folder = path.join(outDir, "input");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "landing"), "<!doctype html><html><body>hello</body></html>", "utf8");
    const policyPath = path.join(process.cwd(), "policies", "generic_default.json");
    const result = await runCliCapture(["safe-run", folder, "--policy", policyPath, "--out", path.join(outDir, "run")]);
    assertEq(result.status, 0, `expected analyze-only exit code\n${result.stderr}`);
    const receipt = readJson(path.join(outDir, "run"), "safe_run_receipt.json");
    assertEq(receipt.contentSummary.artifactKind, "webBundle", "expected webBundle from html-like content");
    assertEq(receipt.contentSummary.hasHtml, true, "expected hasHtml true");
    assert(receipt.contentSummary.entryHints.includes("ENTRY_HTML_LIKE"), "expected ENTRY_HTML_LIKE hint");
  });

  register("safe-run adapter disabled policy still writes deterministic receipts", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(
      ["safe-run", inputPath, "--policy", policyPath, "--adapter", "archive", "--out", path.join(outDir, "run")],
      { env: { WEFTEND_ADAPTER_DISABLE: "archive" } }
    );
    assertEq(result.status, 40, `expected adapter-disabled fail-closed exit code\n${result.stderr}`);
    assert(result.stderr.includes("ADAPTER_TEMPORARILY_UNAVAILABLE"), "expected ADAPTER_TEMPORARILY_UNAVAILABLE stderr");
    const runRoot = path.join(outDir, "run");
    assert(fs.existsSync(path.join(runRoot, "safe_run_receipt.json")), "expected safe_run_receipt.json on adapter-disabled failure");
    assert(fs.existsSync(path.join(runRoot, "operator_receipt.json")), "expected operator_receipt.json on adapter-disabled failure");
    assert(fs.existsSync(path.join(runRoot, "analysis", "intake_decision.json")), "expected analysis intake decision artifact");
    assert(fs.existsSync(path.join(runRoot, "analysis", "capability_ledger_v0.json")), "expected capability ledger artifact");
    const receipt = readJson(runRoot, "safe_run_receipt.json");
    const capability = readJson(path.join(runRoot, "analysis"), "capability_ledger_v0.json");
    assertEq(receipt.analysisVerdict, "DENY", "expected DENY analysis verdict on adapter-disabled failure");
    assert(receipt.execution.reasonCodes.includes("ADAPTER_TEMPORARILY_UNAVAILABLE"), "expected adapter fail code in execution reasons");
    assert(
      Array.isArray(capability.deniedCaps) &&
        capability.deniedCaps.some(
          (entry: any) =>
            entry?.capId === "adapter.selection.archive" &&
            Array.isArray(entry?.reasonCodes) &&
            entry.reasonCodes.includes("ADAPTER_TEMPORARILY_UNAVAILABLE")
        ),
      "expected denied adapter capability in capability ledger"
    );
  });

  register("safe-run invalid adapter disable policy still writes deterministic receipts", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(
      ["safe-run", inputPath, "--policy", policyPath, "--adapter", "archive", "--out", path.join(outDir, "run")],
      { env: { WEFTEND_ADAPTER_DISABLE: "archive,bogus_lane" } }
    );
    assertEq(result.status, 40, `expected adapter-policy-invalid fail-closed exit code\n${result.stderr}`);
    assert(result.stderr.includes("ADAPTER_POLICY_INVALID"), "expected ADAPTER_POLICY_INVALID stderr");
    const runRoot = path.join(outDir, "run");
    assert(fs.existsSync(path.join(runRoot, "safe_run_receipt.json")), "expected safe_run_receipt.json on policy-invalid failure");
    assert(fs.existsSync(path.join(runRoot, "operator_receipt.json")), "expected operator_receipt.json on policy-invalid failure");
    const receipt = readJson(runRoot, "safe_run_receipt.json");
    assertEq(receipt.analysisVerdict, "DENY", "expected DENY analysis verdict on adapter policy invalid");
    assert(receipt.execution.reasonCodes.includes("ADAPTER_POLICY_INVALID"), "expected adapter policy invalid code in execution reasons");
  });

  register("safe-run malformed input exits 40", async () => {
    const outDir = makeTempDir();
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const inputPath = path.join(outDir, "does-not-exist");
    const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", path.join(outDir, "run")]);
    assertEq(result.status, 40, `expected malformed-input exit code\n${result.stderr}`);
  });

  register("safe-run out path conflict fails closed without modifying input", async () => {
    const root = makeTempDir();
    const inputDir = path.join(root, "input");
    fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, "blob.bin"), "bin", "utf8");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", inputDir, "--policy", policyPath, "--out", inputDir]);
    assertEq(result.status, 40, `expected out-conflict exit code\n${result.stderr}`);
    assert(result.stderr.includes("SAFE_RUN_OUT_CONFLICTS_INPUT"), "expected SAFE_RUN_OUT_CONFLICTS_INPUT stderr");
    assert(fs.existsSync(path.join(inputDir, "blob.bin")), "input file must remain present after out conflict");
    assert(!fs.existsSync(`${inputDir}.stage`), "stage dir must not be created on out conflict");
  });

  register("safe-run fails closed when out path overlaps policy file", async () => {
    const root = makeTempDir();
    const outDir = path.join(root, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const policyPath = path.join(outDir, "policy.json");
    fs.copyFileSync(path.join(process.cwd(), "policies", "web_component_default.json"), policyPath);
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 40, `expected safe-run policy/out conflict exit code\n${result.stderr}`);
    assert(result.stderr.includes("SAFE_RUN_OUT_CONFLICTS_POLICY"), "expected SAFE_RUN_OUT_CONFLICTS_POLICY stderr");
    assert(fs.existsSync(policyPath), "policy file must remain present after safe-run policy/out conflict");
    assert(!fs.existsSync(`${outDir}.stage`), "stage dir must not be created on policy/out conflict");
  });

  register("safe-run core fails closed when out path overlaps policy file", async () => {
    const root = makeTempDir();
    const outDir = path.join(root, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const policyPath = path.join(outDir, "policy.json");
    fs.copyFileSync(path.join(process.cwd(), "policies", "web_component_default.json"), policyPath);
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const prevErr = console.error;
    const errors: string[] = [];
    (console as any).error = (...args: any[]) => errors.push(args.map((a) => String(a)).join(" "));
    try {
      const status = await runSafeRun({
        inputPath,
        outDir,
        policyPath,
        profile: "web",
        mode: "strict",
        executeRequested: false,
        withholdExec: true,
      });
      assertEq(status, 40, "expected safe-run core fail-closed code");
    } finally {
      (console as any).error = prevErr;
    }
    assert(errors.some((line) => line.includes("SAFE_RUN_OUT_CONFLICTS_POLICY")), "expected SAFE_RUN_OUT_CONFLICTS_POLICY stderr");
    assert(fs.existsSync(policyPath), "policy file must remain present after safe-run core policy/out conflict");
    assert(!fs.existsSync(`${outDir}.stage`), "stage dir must not be created on safe-run core policy/out conflict");
  });

  register("safe-run core fails closed when out path overlaps script file", async () => {
    const root = makeTempDir();
    const outDir = path.join(root, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const scriptPath = path.join(outDir, "rules.js");
    fs.writeFileSync(scriptPath, "module.exports = {};\n", "utf8");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const prevErr = console.error;
    const errors: string[] = [];
    (console as any).error = (...args: any[]) => errors.push(args.map((a) => String(a)).join(" "));
    try {
      const status = await runSafeRun({
        inputPath,
        outDir,
        profile: "web",
        mode: "strict",
        scriptPath,
        executeRequested: false,
        withholdExec: true,
      });
      assertEq(status, 40, "expected safe-run core fail-closed code");
    } finally {
      (console as any).error = prevErr;
    }
    assert(errors.some((line) => line.includes("SAFE_RUN_OUT_CONFLICTS_SCRIPT")), "expected SAFE_RUN_OUT_CONFLICTS_SCRIPT stderr");
    assert(fs.existsSync(scriptPath), "script file must remain present after safe-run core script/out conflict");
    assert(!fs.existsSync(`${outDir}.stage`), "stage dir must not be created on safe-run core script/out conflict");
  });

  register("safe-run fails closed when out path is an existing file", async () => {
    const root = makeTempDir();
    const outFile = path.join(root, "out.txt");
    fs.writeFileSync(outFile, "keep", "utf8");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", outFile]);
    assertEq(result.status, 40, `expected safe-run out-file fail-closed exit code\n${result.stderr}`);
    assert(result.stderr.includes("SAFE_RUN_OUT_PATH_NOT_DIRECTORY"), "expected SAFE_RUN_OUT_PATH_NOT_DIRECTORY stderr");
    assertEq(fs.readFileSync(outFile, "utf8"), "keep", "existing out file must not be replaced");
    assert(!fs.existsSync(`${outFile}.stage`), "stage dir must not be created when out is a file");
  });

  register("safe-run fails closed when out path overlaps adapter maintenance policy file", async () => {
    const root = makeTempDir();
    const outDir = path.join(root, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const maintenancePolicyPath = path.join(outDir, "adapter_maintenance.json");
    fs.writeFileSync(maintenancePolicyPath, "{\"disabledAdapters\":[]}\n", "utf8");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const result = await runCliCapture(["safe-run", inputPath, "--out", outDir], {
      env: { WEFTEND_ADAPTER_DISABLE_FILE: maintenancePolicyPath },
    });
    assertEq(result.status, 40, `expected safe-run adapter-policy-file/out conflict exit code\n${result.stderr}`);
    assert(
      result.stderr.includes("SAFE_RUN_OUT_CONFLICTS_ADAPTER_POLICY_FILE"),
      "expected SAFE_RUN_OUT_CONFLICTS_ADAPTER_POLICY_FILE stderr"
    );
    assert(fs.existsSync(maintenancePolicyPath), "adapter maintenance policy file must remain present after conflict");
    assert(!fs.existsSync(`${outDir}.stage`), "stage dir must not be created on adapter policy file conflict");
  });

  register("safe-run oversize release input exits 40", async () => {
    const outDir = makeTempDir();
    const releaseDir = path.join(outDir, "release");
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, "release_manifest.json"), "x".repeat(1024 * 1024 + 10), "utf8");
    fs.writeFileSync(path.join(releaseDir, "runtime_bundle.json"), "{}", "utf8");
    fs.writeFileSync(path.join(releaseDir, "evidence.json"), "{}", "utf8");
    fs.writeFileSync(path.join(releaseDir, "release_public_key.json"), "{}", "utf8");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["safe-run", releaseDir, "--policy", policyPath, "--out", path.join(outDir, "run"), "--execute"]);
    assertEq(result.status, 40, `expected oversize exit code\n${result.stderr}`);
    assert(result.stderr.includes("HOST_INPUT_OVERSIZE"), "expected HOST_INPUT_OVERSIZE message");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`safe_run_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
