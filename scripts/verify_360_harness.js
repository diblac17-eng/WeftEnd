// scripts/verify_360_harness.js
// Deterministic harness for verify:360 corridor behavior:
// 1) normal run succeeds and advances latest pointer
// 2) replay run succeeds and suppresses pointer advance
// 3) forced exception run fails but still writes receipt/report and does not advance pointer

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const outRoot = path.join(root, "out", "verify_360");
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

const runVerify = (envExtra = {}) => {
  const env = { ...process.env, ...envExtra };
  const res = spawnSync(process.execPath, ["scripts/verify_360.js"], {
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

  const statusA = runVerify();
  assert(statusA === 0, `VERIFY360_HARNESS_PASS1_FAILED status=${statusA}`);
  const runsAfterA = listRunNames();
  const newRunsA = diffNewRuns(beforeRuns, runsAfterA);
  assert(newRunsA.length === 1, "VERIFY360_HARNESS_PASS1_RUN_COUNT_INVALID");
  const runA = newRunsA[0];
  const latestA = readLatest();
  assert(latestA, "VERIFY360_HARNESS_LATEST_MISSING_AFTER_PASS1");
  const receiptAPath = path.join(historyRoot, runA, "verify_360_receipt.json");
  assert(fs.existsSync(receiptAPath), "VERIFY360_HARNESS_RECEIPT_A_MISSING");
  const receiptA = readJson(receiptAPath);
  assertStateReceipt(receiptA, "PASS");
  assert(["NEW", "REPLAY", "PARTIAL"].includes(String(receiptA.idempotence?.mode || "")), "VERIFY360_HARNESS_PASS1_IDEMPOTENCE_INVALID");

  const statusB = runVerify();
  assert(statusB === 0, `VERIFY360_HARNESS_PASS2_FAILED status=${statusB}`);
  const runsAfterB = listRunNames();
  const newRunsB = diffNewRuns(runsAfterA, runsAfterB);
  assert(newRunsB.length === 1, "VERIFY360_HARNESS_PASS2_RUN_COUNT_INVALID");
  const runB = newRunsB[0];
  const latestB = readLatest();
  assert(latestB === latestA, "VERIFY360_HARNESS_REPLAY_POINTER_ADVANCED");
  const receiptBPath = path.join(historyRoot, runB, "verify_360_receipt.json");
  assert(fs.existsSync(receiptBPath), "VERIFY360_HARNESS_RECEIPT_B_MISSING");
  const receiptB = readJson(receiptBPath);
  assertStateReceipt(receiptB, "PASS");
  assert(receiptB.idempotence?.mode === "REPLAY", "VERIFY360_HARNESS_REPLAY_MODE_MISSING");
  assert(receiptB.idempotence?.pointerPolicy === "UPDATE_SUPPRESSED", "VERIFY360_HARNESS_REPLAY_POINTER_POLICY_INVALID");

  const statusC = runVerify({ WEFTEND_360_FORCE_EXCEPTION: "1" });
  assert(statusC !== 0, "VERIFY360_HARNESS_FORCED_EXCEPTION_DID_NOT_FAIL");
  const runsAfterC = listRunNames();
  const newRunsC = diffNewRuns(runsAfterB, runsAfterC);
  assert(newRunsC.length === 1, "VERIFY360_HARNESS_FORCED_EXCEPTION_RUN_COUNT_INVALID");
  const runC = newRunsC[0];
  const latestC = readLatest();
  assert(latestC === latestA, "VERIFY360_HARNESS_FORCED_EXCEPTION_POINTER_ADVANCED");
  const receiptCPath = path.join(historyRoot, runC, "verify_360_receipt.json");
  const reportCPath = path.join(historyRoot, runC, "verify_360_report.txt");
  assert(fs.existsSync(receiptCPath), "VERIFY360_HARNESS_RECEIPT_C_MISSING");
  assert(fs.existsSync(reportCPath), "VERIFY360_HARNESS_REPORT_C_MISSING");
  const receiptC = readJson(receiptCPath);
  assertStateReceipt(receiptC, "FAIL");
  const reasonCodes = Array.isArray(receiptC.reasonCodes) ? receiptC.reasonCodes : [];
  assert(reasonCodes.includes("VERIFY360_INTERNAL_EXCEPTION"), "VERIFY360_HARNESS_INTERNAL_EXCEPTION_REASON_MISSING");
  assert(reasonCodes.includes("VERIFY360_FORCED_EXCEPTION"), "VERIFY360_HARNESS_FORCED_EXCEPTION_REASON_MISSING");
  assert(
    reasonCodes.includes(`VERIFY360_FAIL_CLOSED_AT_${String(receiptC.interpreted?.gateState || "").toUpperCase()}`),
    "VERIFY360_HARNESS_FAIL_CLOSED_AT_REASON_MISSING"
  );

  console.log(
    `verify:360:harness PASS beforeLatest=${beforeLatest || "NONE"} passRun=${runA} replayRun=${runB} forcedRun=${runC}`
  );
};

main();
