// scripts/verify_360_harness.js
// Deterministic harness for verify:360 corridor behavior:
// 1) normal run succeeds and advances latest pointer
// 2) replay run succeeds and suppresses pointer advance
// 3) forced exception run fails but still writes receipt/report and does not advance pointer

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weftend-verify360-harness-"));
const historyRoot = path.join(outRoot, "history");
const latestPath = path.join(outRoot, "latest.txt");

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const readTextIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
};

const readLatest = () => {
  const text = readTextIfExists(latestPath);
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const listRunNames = () => {
  ensureDir(historyRoot);
  return fs
    .readdirSync(historyRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^run_[0-9]{6}$/.test(d.name))
    .map((d) => d.name)
    .sort(cmp);
};

const diffNewRuns = (beforeRuns, afterRuns) => {
  const seen = new Set(beforeRuns || []);
  return (afterRuns || []).filter((r) => !seen.has(r));
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const readText = (filePath) => fs.readFileSync(filePath, "utf8");
const sha256File = (filePath) => {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return `sha256:${h.digest("hex")}`;
};
const historyLinkDigest = (historyLink) => {
  const canonical = {
    priorReceiptFileDigest: String(historyLink?.priorReceiptFileDigest || "NONE"),
    priorRunId: String(historyLink?.priorRunId || "NONE"),
  };
  const text = `${JSON.stringify(canonical, null, 2)}\n`;
  const h = crypto.createHash("sha256");
  h.update(text);
  return `sha256:${h.digest("hex")}`;
};
const assertStateReceipt = (receipt, expectedVerdict) => {
  assert(receipt && typeof receipt === "object", "VERIFY360_HARNESS_RECEIPT_INVALID");
  assert(String(receipt.verdict || "") === expectedVerdict, `VERIFY360_HARNESS_VERDICT_MISMATCH_${expectedVerdict}`);
  const stateHistory = Array.isArray(receipt.stateHistory) ? receipt.stateHistory : [];
  assert(stateHistory.length > 0, "VERIFY360_HARNESS_STATE_HISTORY_MISSING");
  assert(stateHistory[0] === "INIT", "VERIFY360_HARNESS_STATE_HISTORY_ROOT_INVALID");
  const gateState = String(receipt.interpreted?.gateState || "");
  assert(gateState.length > 0, "VERIFY360_HARNESS_GATE_STATE_MISSING");
  assert(stateHistory[stateHistory.length - 1] === gateState, "VERIFY360_HARNESS_STATE_HISTORY_TAIL_MISMATCH");
  const interpretedHistory = Array.isArray(receipt.interpreted?.stateHistory) ? receipt.interpreted.stateHistory : [];
  assert(interpretedHistory.length === stateHistory.length, "VERIFY360_HARNESS_INTERPRETED_HISTORY_LENGTH_MISMATCH");
  const digestA = String(receipt.stateHistoryDigest || "");
  const digestB = String(receipt.interpreted?.stateHistoryDigest || "");
  assert(digestA.length > 0 && digestB.length > 0, "VERIFY360_HARNESS_STATE_DIGEST_MISSING");
  assert(digestA === digestB, "VERIFY360_HARNESS_STATE_DIGEST_MISMATCH");
};
const assertSortedUnique = (items, code) => {
  const arr = Array.isArray(items) ? items.slice() : [];
  const sorted = Array.from(new Set(arr)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert(arr.length === sorted.length, `${code}_DUPLICATE`);
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] !== sorted[i]) throw new Error(`${code}_ORDER`);
  }
};
const assertCapabilityLedger = (receipt) => {
  const ledger = receipt.capabilityLedger || {};
  const requested = Array.isArray(ledger.requested) ? ledger.requested : [];
  const decisions = Array.isArray(ledger.decisions) ? ledger.decisions : [];
  assert(requested.length > 0, "VERIFY360_HARNESS_LEDGER_REQUESTED_EMPTY");
  assert(decisions.length === requested.length, "VERIFY360_HARNESS_LEDGER_DECISION_COUNT_MISMATCH");
  const requestedSet = new Set(requested);
  const decisionsSet = new Set(decisions.map((d) => d.capability));
  assert(requestedSet.size === requested.length, "VERIFY360_HARNESS_LEDGER_REQUESTED_DUP");
  assert(decisionsSet.size === decisions.length, "VERIFY360_HARNESS_LEDGER_DECISION_DUP");
  requested.forEach((cap) => assert(decisionsSet.has(cap), "VERIFY360_HARNESS_LEDGER_DECISION_MISSING"));
  decisions.forEach((d) => {
    assert(d.status === "GRANTED" || d.status === "DENIED", "VERIFY360_HARNESS_LEDGER_STATUS_INVALID");
    assertSortedUnique(d.reasonCodes, "VERIFY360_HARNESS_LEDGER_REASON_CODES");
  });
};
const assertHistoryLink = (receipt, expectedPrevRunId, expectedPrevReceiptPath) => {
  const link = receipt.historyLink || {};
  const evidence = receipt.evidenceChain?.links || {};
  const gotPrevRun = String(link.priorRunId || "NONE");
  const gotPrevDigest = String(link.priorReceiptFileDigest || "NONE");
  assert(gotPrevRun === expectedPrevRunId, "VERIFY360_HARNESS_HISTORY_PREV_RUN_MISMATCH");
  if (expectedPrevRunId === "NONE") {
    assert(gotPrevDigest === "NONE", "VERIFY360_HARNESS_HISTORY_PREV_DIGEST_NONE_MISMATCH");
  } else {
    const expectedDigest = sha256File(expectedPrevReceiptPath);
    assert(gotPrevDigest === expectedDigest, "VERIFY360_HARNESS_HISTORY_PREV_DIGEST_MISMATCH");
  }
  assert(String(evidence.priorVerifyRunId || "NONE") === gotPrevRun, "VERIFY360_HARNESS_HISTORY_EVIDENCE_RUN_MISMATCH");
  assert(
    String(evidence.priorVerifyReceiptFileDigest || "NONE") === gotPrevDigest,
    "VERIFY360_HARNESS_HISTORY_EVIDENCE_DIGEST_MISMATCH"
  );
  const gotLinkDigest = String(receipt.historyLinkDigest || "");
  assert(/^sha256:[a-f0-9]{64}$/.test(gotLinkDigest), "VERIFY360_HARNESS_HISTORY_LINK_DIGEST_SHAPE");
  const expectedLinkDigest = historyLinkDigest({ priorRunId: gotPrevRun, priorReceiptFileDigest: gotPrevDigest });
  assert(gotLinkDigest === expectedLinkDigest, "VERIFY360_HARNESS_HISTORY_LINK_DIGEST_VALUE_MISMATCH");
  assert(
    String(evidence.priorVerifyHistoryLinkDigest || "") === gotLinkDigest,
    "VERIFY360_HARNESS_HISTORY_LINK_DIGEST_EVIDENCE_MISMATCH"
  );
};

const assertReportPolicyLines = (reportText) => {
  const text = String(reportText || "");
  const requiredPrefixes = [
    "policy.auditStrict=",
    "policy.adapterDoctorStrict=",
    "policy.failOnPartial=",
    "policy.partialBlocked=",
    "policy.safeRunAdapter=",
    "adapterDoctor.status=",
    "adapterDoctor.strictStatus=",
    "adapterDoctor.strictReasons=",
  ];
  requiredPrefixes.forEach((prefix) => {
    assert(text.includes(prefix), `VERIFY360_HARNESS_REPORT_MISSING_${prefix.replace(/[^A-Z0-9]/gi, "_")}`);
  });
};
const assertReportStepLine = (reportText, stepId) => {
  const text = String(reportText || "");
  const re = new RegExp(`^${stepId}\\s+status=`, "m");
  assert(re.test(text), `VERIFY360_HARNESS_REPORT_MISSING_STEP_${String(stepId).toUpperCase()}`);
};

const runVerify = (envExtra = {}) => {
  const env = {
    ...process.env,
    WEFTEND_360_OUT_ROOT: outRoot,
    ...envExtra,
  };
  const res = spawnSync(process.execPath, ["scripts/verify_360.js"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return typeof res.status === "number" ? res.status : 1;
};
const runAuditStrict = () => {
  const env = {
    ...process.env,
    WEFTEND_360_OUT_ROOT: outRoot,
    WEFTEND_360_AUDIT_STRICT: "1",
  };
  const res = spawnSync(process.execPath, ["scripts/verify_360_audit.js"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return typeof res.status === "number" ? res.status : 1;
};

const main = () => {
  ensureDir(historyRoot);

  const beforeLatest = readLatest();
  const beforeRuns = listRunNames();
  const prevRunBeforeA = beforeRuns.length > 0 ? beforeRuns[beforeRuns.length - 1] : "NONE";
  const prevReceiptBeforeA =
    prevRunBeforeA === "NONE" ? null : path.join(historyRoot, prevRunBeforeA, "verify_360_receipt.json");

  const statusA = runVerify();
  assert(statusA === 0, `VERIFY360_HARNESS_PASS1_FAILED status=${statusA}`);
  const runsAfterA = listRunNames();
  const newRunsA = diffNewRuns(beforeRuns, runsAfterA);
  assert(newRunsA.length === 1, "VERIFY360_HARNESS_PASS1_RUN_COUNT_INVALID");
  const runA = newRunsA[0];
  const latestA = readLatest();
  assert(latestA, "VERIFY360_HARNESS_LATEST_MISSING_AFTER_PASS1");
  const receiptAPath = path.join(historyRoot, runA, "verify_360_receipt.json");
  const reportAPath = path.join(historyRoot, runA, "verify_360_report.txt");
  assert(fs.existsSync(receiptAPath), "VERIFY360_HARNESS_RECEIPT_A_MISSING");
  assert(fs.existsSync(reportAPath), "VERIFY360_HARNESS_REPORT_A_MISSING");
  const receiptA = readJson(receiptAPath);
  const reportA = readText(reportAPath);
  assertStateReceipt(receiptA, "PASS");
  assertReportPolicyLines(reportA);
  assertReportStepLine(reportA, "stage_residue");
  assertSortedUnique(receiptA.reasonCodes, "VERIFY360_HARNESS_REASON_CODES");
  assertCapabilityLedger(receiptA);
  assert(receiptA.idempotence?.mode === "NEW", "VERIFY360_HARNESS_PASS1_EXPECTED_NEW");
  assertHistoryLink(receiptA, prevRunBeforeA, prevReceiptBeforeA);

  const statusB = runVerify();
  assert(statusB === 0, `VERIFY360_HARNESS_PASS2_FAILED status=${statusB}`);
  const runsAfterB = listRunNames();
  const newRunsB = diffNewRuns(runsAfterA, runsAfterB);
  assert(newRunsB.length === 1, "VERIFY360_HARNESS_PASS2_RUN_COUNT_INVALID");
  const runB = newRunsB[0];
  const latestB = readLatest();
  assert(latestB === latestA, "VERIFY360_HARNESS_REPLAY_POINTER_ADVANCED");
  const receiptBPath = path.join(historyRoot, runB, "verify_360_receipt.json");
  const reportBPath = path.join(historyRoot, runB, "verify_360_report.txt");
  assert(fs.existsSync(receiptBPath), "VERIFY360_HARNESS_RECEIPT_B_MISSING");
  assert(fs.existsSync(reportBPath), "VERIFY360_HARNESS_REPORT_B_MISSING");
  const receiptB = readJson(receiptBPath);
  const reportB = readText(reportBPath);
  assertStateReceipt(receiptB, "PASS");
  assertReportPolicyLines(reportB);
  assertReportStepLine(reportB, "stage_residue");
  assertSortedUnique(receiptB.reasonCodes, "VERIFY360_HARNESS_REASON_CODES");
  assertCapabilityLedger(receiptB);
  assert(receiptB.idempotence?.mode === "REPLAY", "VERIFY360_HARNESS_REPLAY_MODE_MISSING");
  assert(receiptB.idempotence?.pointerPolicy === "UPDATE_SUPPRESSED", "VERIFY360_HARNESS_REPLAY_POINTER_POLICY_INVALID");
  assertHistoryLink(receiptB, runA, receiptAPath);

  const strictReplayEnv = {
    WEFTEND_360_ADAPTER_DOCTOR_STRICT: "1",
  };
  const statusD = runVerify(strictReplayEnv);
  assert(statusD === 0, `VERIFY360_HARNESS_STRICT_NEW_FAILED status=${statusD}`);
  const runsAfterD = listRunNames();
  const newRunsD = diffNewRuns(runsAfterB, runsAfterD);
  assert(newRunsD.length === 1, "VERIFY360_HARNESS_STRICT_NEW_RUN_COUNT_INVALID");
  const runD = newRunsD[0];
  const latestD = readLatest();
  assert(latestD, "VERIFY360_HARNESS_LATEST_MISSING_AFTER_STRICT_NEW");
  const receiptDPath = path.join(historyRoot, runD, "verify_360_receipt.json");
  const reportDPath = path.join(historyRoot, runD, "verify_360_report.txt");
  assert(fs.existsSync(receiptDPath), "VERIFY360_HARNESS_RECEIPT_D_MISSING");
  assert(fs.existsSync(reportDPath), "VERIFY360_HARNESS_REPORT_D_MISSING");
  const receiptD = readJson(receiptDPath);
  const reportD = readText(reportDPath);
  const verdictD = String(receiptD.verdict || "");
  assert(verdictD === "PASS" || verdictD === "PARTIAL", "VERIFY360_HARNESS_STRICT_NEW_VERDICT_INVALID");
  assertStateReceipt(receiptD, verdictD);
  assertReportPolicyLines(reportD);
  assertReportStepLine(reportD, "stage_residue");
  assertSortedUnique(receiptD.reasonCodes, "VERIFY360_HARNESS_REASON_CODES");
  assertCapabilityLedger(receiptD);
  assert(receiptD.idempotence?.mode === "NEW", "VERIFY360_HARNESS_STRICT_NEW_EXPECTED_NEW");
  assertHistoryLink(receiptD, runB, receiptBPath);

  const statusE = runVerify(strictReplayEnv);
  assert(statusE === 0, `VERIFY360_HARNESS_STRICT_REPLAY_FAILED status=${statusE}`);
  const runsAfterE = listRunNames();
  const newRunsE = diffNewRuns(runsAfterD, runsAfterE);
  assert(newRunsE.length === 1, "VERIFY360_HARNESS_STRICT_REPLAY_RUN_COUNT_INVALID");
  const runE = newRunsE[0];
  const latestE = readLatest();
  assert(latestE === latestD, "VERIFY360_HARNESS_STRICT_REPLAY_POINTER_ADVANCED");
  const receiptEPath = path.join(historyRoot, runE, "verify_360_receipt.json");
  const reportEPath = path.join(historyRoot, runE, "verify_360_report.txt");
  assert(fs.existsSync(receiptEPath), "VERIFY360_HARNESS_RECEIPT_E_MISSING");
  assert(fs.existsSync(reportEPath), "VERIFY360_HARNESS_REPORT_E_MISSING");
  const receiptE = readJson(receiptEPath);
  const reportE = readText(reportEPath);
  const verdictE = String(receiptE.verdict || "");
  assert(verdictE === "PASS" || verdictE === "PARTIAL", "VERIFY360_HARNESS_STRICT_REPLAY_VERDICT_INVALID");
  assertStateReceipt(receiptE, verdictE);
  assertReportPolicyLines(reportE);
  assertReportStepLine(reportE, "stage_residue");
  assertSortedUnique(receiptE.reasonCodes, "VERIFY360_HARNESS_REASON_CODES");
  assertCapabilityLedger(receiptE);
  assert(receiptE.idempotence?.mode === "REPLAY", "VERIFY360_HARNESS_STRICT_REPLAY_MODE_MISSING");
  assert(receiptE.idempotence?.pointerPolicy === "UPDATE_SUPPRESSED", "VERIFY360_HARNESS_STRICT_REPLAY_POINTER_POLICY_INVALID");
  assertHistoryLink(receiptE, runD, receiptDPath);

  const statusF = runVerify({ WEFTEND_360_FORCE_EXCEPTION: "1" });
  assert(statusF !== 0, "VERIFY360_HARNESS_FORCED_EXCEPTION_DID_NOT_FAIL");
  const runsAfterF = listRunNames();
  const newRunsF = diffNewRuns(runsAfterE, runsAfterF);
  assert(newRunsF.length === 1, "VERIFY360_HARNESS_FORCED_EXCEPTION_RUN_COUNT_INVALID");
  const runF = newRunsF[0];
  const latestF = readLatest();
  assert(latestF === latestD, "VERIFY360_HARNESS_FORCED_EXCEPTION_POINTER_ADVANCED");
  const receiptFPath = path.join(historyRoot, runF, "verify_360_receipt.json");
  const reportFPath = path.join(historyRoot, runF, "verify_360_report.txt");
  assert(fs.existsSync(receiptFPath), "VERIFY360_HARNESS_RECEIPT_F_MISSING");
  assert(fs.existsSync(reportFPath), "VERIFY360_HARNESS_REPORT_F_MISSING");
  const receiptF = readJson(receiptFPath);
  const reportF = readText(reportFPath);
  assertStateReceipt(receiptF, "FAIL");
  assertReportPolicyLines(reportF);
  assertSortedUnique(receiptF.reasonCodes, "VERIFY360_HARNESS_REASON_CODES");
  assertCapabilityLedger(receiptF);
  const reasonCodes = Array.isArray(receiptF.reasonCodes) ? receiptF.reasonCodes : [];
  assert(reasonCodes.includes("VERIFY360_INTERNAL_EXCEPTION"), "VERIFY360_HARNESS_INTERNAL_EXCEPTION_REASON_MISSING");
  assert(reasonCodes.includes("VERIFY360_FORCED_EXCEPTION"), "VERIFY360_HARNESS_FORCED_EXCEPTION_REASON_MISSING");
  assertHistoryLink(receiptF, runE, receiptEPath);
  assert(
    reasonCodes.includes(`VERIFY360_FAIL_CLOSED_AT_${String(receiptF.interpreted?.gateState || "").toUpperCase()}`),
    "VERIFY360_HARNESS_FAIL_CLOSED_AT_REASON_MISSING"
  );

  const statusG = runVerify({ WEFTEND_360_SAFE_RUN_ADAPTER: "invalid_adapter_value" });
  assert(statusG !== 0, "VERIFY360_HARNESS_INVALID_ADAPTER_DID_NOT_FAIL");
  const runsAfterG = listRunNames();
  const newRunsG = diffNewRuns(runsAfterF, runsAfterG);
  assert(newRunsG.length === 1, "VERIFY360_HARNESS_INVALID_ADAPTER_RUN_COUNT_INVALID");
  const runG = newRunsG[0];
  const latestG = readLatest();
  assert(latestG === latestD, "VERIFY360_HARNESS_INVALID_ADAPTER_POINTER_ADVANCED");
  const receiptGPath = path.join(historyRoot, runG, "verify_360_receipt.json");
  const reportGPath = path.join(historyRoot, runG, "verify_360_report.txt");
  assert(fs.existsSync(receiptGPath), "VERIFY360_HARNESS_RECEIPT_G_MISSING");
  assert(fs.existsSync(reportGPath), "VERIFY360_HARNESS_REPORT_G_MISSING");
  const receiptG = readJson(receiptGPath);
  const reportG = readText(reportGPath);
  assertStateReceipt(receiptG, "FAIL");
  assertReportPolicyLines(reportG);
  assertSortedUnique(receiptG.reasonCodes, "VERIFY360_HARNESS_REASON_CODES");
  assertCapabilityLedger(receiptG);
  const reasonCodesG = Array.isArray(receiptG.reasonCodes) ? receiptG.reasonCodes : [];
  assert(reasonCodesG.includes("VERIFY360_SAFE_RUN_ADAPTER_INVALID"), "VERIFY360_HARNESS_INVALID_ADAPTER_REASON_MISSING");
  assertHistoryLink(receiptG, runF, receiptFPath);

  const auditStatus = runAuditStrict();
  assert(auditStatus === 0, `VERIFY360_HARNESS_AUDIT_STRICT_FAILED status=${auditStatus}`);

  console.log(
    `verify:360:harness PASS outRoot=${outRoot} beforeLatest=${beforeLatest || "NONE"} passRun=${runA} replayRun=${runB} strictRun=${runD} strictReplayRun=${runE} forcedRun=${runF} invalidAdapterRun=${runG}`
  );
};

main();
