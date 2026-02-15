// scripts/verify_360.js
// 360 commit gate with evidence-first behavior:
// - host preconditions do not silently block analysis
// - every run writes a receipt/report
// - failures are explicit and bounded
// - output finalize uses two-phase stage -> finalize

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();
const OUT_ROOT = process.env.WEFTEND_360_OUT_ROOT
  ? path.resolve(root, process.env.WEFTEND_360_OUT_ROOT)
  : path.join(root, "out", "verify_360");
const HISTORY_ROOT = path.join(OUT_ROOT, "history");
const MAX_STEPS = 64;
const RUN_STATES = [
  "INIT",
  "PRECHECKED",
  "COMPILE_DONE",
  "TEST_DONE",
  "PROOFCHECK_DONE",
  "DETERMINISM_DONE",
  "STAGED",
  "FINALIZED",
  "RECORDED",
];
const CAPABILITY_REQUESTS = [
  "cli.compare",
  "cli.safe_run",
  "fixture.deterministic_input",
  "fixture.release",
  "git.head",
  "git.status",
  "npm.compile",
  "npm.proofcheck",
  "npm.test",
  "output.update_latest_pointer",
  "output.write_receipt",
  "runtime.privacy_lint",
];
const VERIFY360_EXPLAIN_VERSION = "weftend.verify360Explain/0";
const VERDICT_EXPLANATIONS = {
  PASS: "All required verification checks completed successfully with deterministic evidence recorded.",
  PARTIAL: "Verification completed with partial knowledge; evidence is recorded and reusable state advancement remains constrained.",
  FAIL: "Verification failed closed; evidence is recorded and reusable state must not advance until issues are resolved.",
};
const buildCapabilityDecisions = (capabilityMap) =>
  stableSortUnique(CAPABILITY_REQUESTS).map((capability) => {
    const entry = capabilityMap.get(capability);
    return {
      capability,
      status: entry?.status || "DENIED",
      reasonCodes: stableSortUnique(entry?.reasonCodes || ["VERIFY360_CAPABILITY_UNSET"]),
    };
  });
const buildExplain = (verdict, idempotenceMode) => ({
  schema: VERIFY360_EXPLAIN_VERSION,
  schemaVersion: 0,
  verdictMeaning:
    VERDICT_EXPLANATIONS[verdict] ||
    "Verification result recorded with deterministic evidence and stable reason codes.",
  idempotenceMeaning:
    idempotenceMode === "NEW"
      ? "This run key is new; latest pointer updates are allowed."
      : idempotenceMode === "REPLAY"
        ? "This run key replays prior evidence; latest pointer updates are suppressed."
        : "Idempotence history was partially readable; latest pointer updates are suppressed fail-closed.",
  nextAction:
    verdict === "PASS"
      ? "Proceed with reusable commit or release flow under normal controls."
      : verdict === "PARTIAL"
        ? "Review partial reason codes and resolve missing preconditions before reusable commit or release."
        : "Resolve fail reason codes, then rerun verify:360 before reusable commit or release.",
});
const exceptionReasonCodes = (error) => {
  const out = ["VERIFY360_INTERNAL_EXCEPTION"];
  const nameToken =
    String(error?.name || "ERROR")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 48) || "ERROR";
  out.push(`VERIFY360_EXCEPTION_NAME_${nameToken}`);
  const msg = String(error?.message || "").toUpperCase();
  const match = msg.match(/VERIFY360_[A-Z0-9_]+/);
  if (match && match[0]) out.push(match[0]);
  return stableSortUnique(out);
};
const stateHistoryDigest = (history) => sha256Text(canonicalJSON(Array.isArray(history) ? history : []));
const historyLinkDigest = (historyLink) =>
  sha256Text(
    canonicalJSON({
      priorReceiptFileDigest: String(historyLink?.priorReceiptFileDigest || "NONE"),
      priorRunId: String(historyLink?.priorRunId || "NONE"),
    })
  );
const assertPayloadConsistency = (payload) => {
  const stateHistory = Array.isArray(payload?.stateHistory) ? payload.stateHistory : [];
  if (stateHistory.length === 0) throw new Error("VERIFY360_INCONSISTENT_STATE_HISTORY_EMPTY");
  if (stateHistory[0] !== "INIT") throw new Error("VERIFY360_INCONSISTENT_STATE_HISTORY_ROOT");
  const stateAtStage = String(payload?.stateAtStage || "");
  if (stateAtStage.length === 0) throw new Error("VERIFY360_INCONSISTENT_STATE_AT_STAGE_MISSING");
  if (stateHistory[stateHistory.length - 1] !== stateAtStage) {
    throw new Error("VERIFY360_INCONSISTENT_STATE_HISTORY_TAIL");
  }
  for (let i = 1; i < stateHistory.length; i += 1) {
    const prev = RUN_STATES.indexOf(stateHistory[i - 1]);
    const next = RUN_STATES.indexOf(stateHistory[i]);
    if (prev < 0 || next < 0 || next < prev) {
      throw new Error("VERIFY360_INCONSISTENT_STATE_HISTORY_ORDER");
    }
  }
  const interpretedState = String(payload?.interpreted?.gateState || "");
  if (interpretedState !== stateAtStage) throw new Error("VERIFY360_INCONSISTENT_INTERPRETED_GATE_STATE");
  const interpretedHistory = Array.isArray(payload?.interpreted?.stateHistory) ? payload.interpreted.stateHistory : [];
  if (interpretedHistory.length !== stateHistory.length) {
    throw new Error("VERIFY360_INCONSISTENT_INTERPRETED_STATE_HISTORY_LENGTH");
  }
  for (let i = 0; i < stateHistory.length; i += 1) {
    if (stateHistory[i] !== interpretedHistory[i]) {
      throw new Error("VERIFY360_INCONSISTENT_INTERPRETED_STATE_HISTORY_CONTENT");
    }
  }
  const rc = Array.isArray(payload?.reasonCodes) ? payload.reasonCodes : [];
  const expectedRc = stableSortUnique(rc);
  if (expectedRc.length !== rc.length || expectedRc.some((v, i) => v !== rc[i])) {
    throw new Error("VERIFY360_INCONSISTENT_REASON_CODES_ORDER");
  }
  const priorRunId = String(payload?.historyLink?.priorRunId || "NONE");
  const priorReceiptFileDigest = String(payload?.historyLink?.priorReceiptFileDigest || "NONE");
  if (priorRunId === "NONE") {
    if (priorReceiptFileDigest !== "NONE") throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_NONE");
  } else {
    if (!/^run_[0-9]{6}$/.test(priorRunId)) throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_RUN_ID");
    if (!/^sha256:[a-f0-9]{64}$/.test(priorReceiptFileDigest)) {
      throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_DIGEST");
    }
  }
  const ePrevRun = String(payload?.evidenceChain?.links?.priorVerifyRunId || "NONE");
  const ePrevDigest = String(payload?.evidenceChain?.links?.priorVerifyReceiptFileDigest || "NONE");
  if (ePrevRun !== priorRunId || ePrevDigest !== priorReceiptFileDigest) {
    throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_EVIDENCE_CHAIN");
  }
  const linkDigest = String(payload?.historyLinkDigest || "");
  if (!/^sha256:[a-f0-9]{64}$/.test(linkDigest)) throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_DIGEST_SHAPE");
  if (linkDigest !== historyLinkDigest(payload?.historyLink || {})) {
    throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_DIGEST_VALUE");
  }
  const eLinkDigest = String(payload?.evidenceChain?.links?.priorVerifyHistoryLinkDigest || "");
  if (eLinkDigest !== linkDigest) throw new Error("VERIFY360_INCONSISTENT_HISTORY_LINK_DIGEST_EVIDENCE_CHAIN");
};
const summarizeStepStatuses = (steps) => {
  const summary = {
    FAIL: 0,
    PARTIAL: 0,
    PASS: 0,
    SKIP: 0,
    OTHER: 0,
  };
  (steps || []).forEach((step) => {
    const status = String(step?.status || "");
    if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status] += 1;
    else summary.OTHER += 1;
  });
  return summary;
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const stableSortUnique = (items) =>
  Array.from(new Set((items || []).filter((x) => typeof x === "string" && x.length > 0))).sort(cmp);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value)
      .sort(cmp)
      .forEach((k) => {
        out[k] = canonicalize(value[k]);
      });
    return out;
  }
  return value;
};

const canonicalJSON = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;

const sha256Text = (text) => {
  const h = crypto.createHash("sha256");
  h.update(String(text || ""));
  return `sha256:${h.digest("hex")}`;
};

const sha256File = (filePath) => {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return `sha256:${h.digest("hex")}`;
};

const rel = (absPath) => path.relative(root, absPath).split(path.sep).join("/");

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const nextRunDir = () => {
  ensureDir(HISTORY_ROOT);
  const dirs = fs
    .readdirSync(HISTORY_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^run_[0-9]{6}$/.test(d.name))
    .map((d) => d.name)
    .sort(cmp);
  const last = dirs.length > 0 ? Number.parseInt(dirs[dirs.length - 1].slice(4), 10) : 0;
  const next = Number.isFinite(last) ? last + 1 : 1;
  return path.join(HISTORY_ROOT, `run_${String(next).padStart(6, "0")}`);
};

const npmExec = () => {
  const cli = process.env.npm_execpath || "";
  if (cli.length > 0) return { cmd: process.execPath, argsPrefix: [cli] };
  return { cmd: "npm", argsPrefix: [] };
};

const runCommand = (label, cmd, args, envExtra = {}) => {
  const env = { ...process.env, ...envExtra };
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env,
    windowsHide: true,
  });
  const status = typeof res.status === "number" ? res.status : 1;
  return {
    label,
    ok: status === 0,
    exitCode: status,
  };
};

const gitChangedFiles = () => {
  const res = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (typeof res.status !== "number" || res.status !== 0) return null;
  const out = String(res.stdout || "");
  return out
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => {
      const body = line.slice(3).trim();
      const renameIdx = body.indexOf("->");
      const pathText = renameIdx >= 0 ? body.slice(renameIdx + 2).trim() : body;
      return pathText.split(path.sep).join("/");
    });
};

const runPostingEtiquetteCheck = () => {
  const targets = ["README.md", "docs/RELEASE_ANNOUNCEMENT.txt", "docs/RELEASE_NOTES.txt"];
  const issues = [];
  const bannedPatterns = [
    { code: "ETIQUETTE_AI_SELF_REFERENCE", re: /\b(as an ai|language model|chatgpt|llm)\b/i },
    { code: "ETIQUETTE_APOLOGY_TONE", re: /\b(i apologize|sorry\b|i can't|i cannot)\b/i },
    { code: "ETIQUETTE_HYPE_LANGUAGE", re: /\b(revolutionary|game[\s-]?changer|unbeatable|world[\s-]?class)\b/i },
  ];
  const mojibakeRe = /�|â€™|â€œ|â€|Ã./;
  const emojiRe = /[\u{1F300}-\u{1FAFF}]/u;

  targets.forEach((relPath) => {
    const absPath = path.join(root, relPath);
    if (!fs.existsSync(absPath)) return;
    const text = fs.readFileSync(absPath, "utf8");
    if (mojibakeRe.test(text)) issues.push({ code: "ETIQUETTE_MOJIBAKE_TEXT", relPath });
    if (emojiRe.test(text)) issues.push({ code: "ETIQUETTE_EMOJI_PRESENT", relPath });
    bannedPatterns.forEach(({ code, re }) => {
      if (re.test(text)) issues.push({ code, relPath });
    });
    if (relPath === "docs/RELEASE_ANNOUNCEMENT.txt") {
      if (!/\bHighlights\b/i.test(text)) issues.push({ code: "ETIQUETTE_RELEASE_HIGHLIGHTS_MISSING", relPath });
      if (!/\bValidation\b/i.test(text)) issues.push({ code: "ETIQUETTE_RELEASE_VALIDATION_MISSING", relPath });
    }
  });

  return issues.sort((a, b) => {
    const c0 = cmp(a.code, b.code);
    if (c0 !== 0) return c0;
    return cmp(a.relPath, b.relPath);
  });
};

const compareFilesEqual = (a, b) => {
  const hasA = fs.existsSync(a);
  const hasB = fs.existsSync(b);
  if (!hasA && !hasB) return { ok: true };
  if (hasA !== hasB) return { ok: false, reason: "VERIFY360_FILE_MISSING" };
  const aa = fs.readFileSync(a);
  const bb = fs.readFileSync(b);
  if (!aa.equals(bb)) return { ok: false, reason: "VERIFY360_NONDETERMINISTIC_OUTPUT" };
  return { ok: true };
};

const digestIfExists = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return sha256File(filePath);
  } catch {
    return null;
  }
};

const safeGitHead = () => {
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (typeof res.status !== "number" || res.status !== 0) return "UNKNOWN";
  const value = String(res.stdout || "").trim();
  return /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : "UNKNOWN";
};

const deterministicFileList = [
  "safe_run_receipt.json",
  "operator_receipt.json",
  "report_card.txt",
  "report_card_v0.json",
  path.join("analysis", "adapter_summary_v0.json"),
  path.join("analysis", "adapter_findings_v0.json"),
];

const collectFiles = (dir) => {
  const out = [];
  const walk = (cur, base) => {
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    entries.sort((a, b) => cmp(a.name, b.name));
    entries.forEach((entry) => {
      const abs = path.join(cur, entry.name);
      const relPath = path.join(base, entry.name).split(path.sep).join("/");
      if (entry.isDirectory()) walk(abs, relPath);
      else out.push({ abs, relPath });
    });
  };
  walk(dir, "");
  return out;
};

const findPriorRunByIdempotenceKey = (idempotenceKey) => {
  ensureDir(HISTORY_ROOT);
  const runs = fs
    .readdirSync(HISTORY_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^run_[0-9]{6}$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => cmp(b, a));

  const parseErrors = [];
  for (const runName of runs) {
    const receiptPath = path.join(HISTORY_ROOT, runName, "verify_360_receipt.json");
    if (!fs.existsSync(receiptPath)) continue;
    try {
      const text = fs.readFileSync(receiptPath, "utf8");
      const parsed = JSON.parse(text);
      if (parsed && parsed.idempotenceKey === idempotenceKey) {
        return { priorRunId: runName, parseErrors };
      }
    } catch {
      parseErrors.push(runName);
    }
  }
  return { priorRunId: null, parseErrors };
};
const findLatestVerifyHistoryLink = () => {
  ensureDir(HISTORY_ROOT);
  const runs = fs
    .readdirSync(HISTORY_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^run_[0-9]{6}$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => cmp(b, a));
  for (const runName of runs) {
    const receiptPath = path.join(HISTORY_ROOT, runName, "verify_360_receipt.json");
    if (!fs.existsSync(receiptPath)) continue;
    const digest = digestIfExists(receiptPath);
    if (!digest) continue;
    return {
      priorRunId: runName,
      priorReceiptFileDigest: digest,
    };
  }
  return {
    priorRunId: "NONE",
    priorReceiptFileDigest: "NONE",
  };
};

const writeOutputs = (runDir, payload, options = {}) => {
  ensureDir(HISTORY_ROOT);
  const updateLatestPointer = options.updateLatestPointer !== false;
  const stageDir = `${runDir}.stage`;
  fs.rmSync(stageDir, { recursive: true, force: true });
  ensureDir(stageDir);

  const jsonPath = path.join(stageDir, "verify_360_receipt.json");
  const txtPath = path.join(stageDir, "verify_360_report.txt");

  const lines = [];
  lines.push(`VERIFY360 ${payload.verdict}`);
  lines.push(`runId=${payload.runId}`);
  lines.push(`history.prevRun=${payload.historyLink?.priorRunId || "NONE"}`);
  lines.push(`history.prevDigest=${payload.historyLink?.priorReceiptFileDigest || "NONE"}`);
  lines.push(`history.linkDigest=${payload.historyLinkDigest || "-"}`);
  lines.push(`reasonCodes=${(payload.reasonCodes || []).join(",") || "-"}`);
  lines.push(`observed.stepStatus=${canonicalJSON(payload.observed?.stepStatusSummary || {}).trim()}`);
  lines.push(`observed.capabilities=${payload.observed?.capabilityDecisionCount ?? "-"}`);
  lines.push(`interpreted.verdict=${payload.interpreted?.verdict || payload.verdict || "-"}`);
  lines.push(`interpreted.gateState=${payload.interpreted?.gateState || "-"}`);
  lines.push(`interpreted.statePath=${(payload.interpreted?.stateHistory || []).join(">") || "-"}`);
  lines.push(`interpreted.statePathDigest=${payload.interpreted?.stateHistoryDigest || "-"}`);
  lines.push(`explain.version=${payload.explain?.schema || VERIFY360_EXPLAIN_VERSION}`);
  lines.push(`explain.verdict=${payload.explain?.verdictMeaning || "-"}`);
  lines.push(`explain.idempotence=${payload.explain?.idempotenceMeaning || "-"}`);
  lines.push(`explain.next=${payload.explain?.nextAction || "-"}`);
  lines.push(`steps=${payload.steps.length}`);
  payload.steps.forEach((s) => {
    lines.push(
      `${s.id} status=${s.status} exit=${typeof s.exitCode === "number" ? s.exitCode : "-"} reasons=${(s.reasonCodes || []).join("|") || "-"}`
    );
  });
  const reportText = `${lines.join("\n")}\n`;
  fs.writeFileSync(txtPath, reportText, "utf8");
  const reportDigest = sha256Text(reportText);

  const corePayload = {
    ...payload,
    evidenceChain: {
      ...(payload.evidenceChain || {}),
      reportDigest,
    },
  };
  const receiptDigest = sha256Text(canonicalJSON(corePayload));
  const receiptPayload = {
    ...corePayload,
    receiptDigest,
    evidenceChain: {
      ...(corePayload.evidenceChain || {}),
      reportDigest,
      receiptDigest,
      chainDigest: sha256Text(
        canonicalJSON({
          reportDigest,
          receiptDigest,
          links: corePayload.evidenceChain?.links || {},
        })
      ),
    },
  };
  const receiptText = canonicalJSON(receiptPayload);
  fs.writeFileSync(jsonPath, receiptText, "utf8");

  const files = collectFiles(stageDir).map((f) => ({
    name: f.relPath,
    digest: sha256File(f.abs),
  }));
  const manifest = {
    schema: "weftend.verify360OutputManifest/0",
    schemaVersion: 0,
    files,
  };
  const manifestPath = path.join(stageDir, "verify_360_output_manifest.json");
  fs.writeFileSync(manifestPath, canonicalJSON(manifest), "utf8");
  const manifestNames = new Set(files.map((f) => f.name).concat("verify_360_output_manifest.json"));
  const orphans = collectFiles(stageDir)
    .map((f) => f.relPath)
    .filter((name) => !manifestNames.has(name));
  if (orphans.length > 0) {
    throw new Error(`VERIFY360_ORPHAN_OUTPUT:${orphans.join(",")}`);
  }

  fs.rmSync(runDir, { recursive: true, force: true });
  fs.renameSync(stageDir, runDir);

  if (updateLatestPointer) {
    ensureDir(OUT_ROOT);
    const latestTmp = path.join(OUT_ROOT, "latest.txt.stage");
    const latestFinal = path.join(OUT_ROOT, "latest.txt");
    fs.writeFileSync(latestTmp, `${rel(runDir)}\n`, "utf8");
    fs.renameSync(latestTmp, latestFinal);
  }
};

const writeEmergencyOutputs = (runDir, payload, writeError) => {
  ensureDir(HISTORY_ROOT);
  const stageDir = `${runDir}.stage`;
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.rmSync(runDir, { recursive: true, force: true });
  ensureDir(runDir);

  const writeErrorDigest = sha256Text(String(writeError?.message || writeError || "UNKNOWN"));
  const emergencyPayload = {
    ...payload,
    reasonCodes: stableSortUnique([...(payload.reasonCodes || []), "VERIFY360_EMERGENCY_WRITE_PATH"]),
    emergencyWrite: {
      enabled: true,
      reasonCodes: ["VERIFY360_EMERGENCY_WRITE_PATH"],
      writeErrorDigest,
    },
  };
  const receiptText = canonicalJSON(emergencyPayload);
  const reportText = [
    "VERIFY360 FAIL",
    `runId=${payload.runId}`,
    `reasonCodes=${(payload.reasonCodes || []).join(",") || "-"}`,
    "emergencyWrite=1",
    `emergencyWriteDigest=${writeErrorDigest}`,
  ].join("\n");

  fs.writeFileSync(path.join(runDir, "verify_360_receipt.json"), receiptText, "utf8");
  fs.writeFileSync(path.join(runDir, "verify_360_report.txt"), `${reportText}\n`, "utf8");
  const manifest = {
    schema: "weftend.verify360OutputManifest/0",
    schemaVersion: 0,
    files: [
      { name: "verify_360_receipt.json", digest: sha256File(path.join(runDir, "verify_360_receipt.json")) },
      { name: "verify_360_report.txt", digest: sha256File(path.join(runDir, "verify_360_report.txt")) },
    ],
  };
  const manifestPath = path.join(runDir, "verify_360_output_manifest.json");
  fs.writeFileSync(manifestPath, canonicalJSON(manifest), "utf8");
  const allowed = new Set(["verify_360_receipt.json", "verify_360_report.txt", "verify_360_output_manifest.json"]);
  const orphans = collectFiles(runDir)
    .map((f) => f.relPath)
    .filter((name) => !allowed.has(name));
  if (orphans.length > 0) {
    throw new Error(`VERIFY360_ORPHAN_OUTPUT_EMERGENCY:${orphans.join(",")}`);
  }
};

const main = () => {
  const runDir = nextRunDir();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weftend-verify-360-"));
  const outA = path.join(tmpRoot, "run_a");
  const outB = path.join(tmpRoot, "run_b");
  const outCompare = path.join(tmpRoot, "compare");

  const releaseDirEnv = process.env.WEFTEND_RELEASE_DIR || "tests/fixtures/release_demo";
  const releaseDirAbs = path.resolve(root, releaseDirEnv);
  const deterministicInputEnv = process.env.WEFTEND_360_INPUT || "tests/fixtures/intake/tampered_manifest/tampered.zip";
  const deterministicInputAbs = path.resolve(root, deterministicInputEnv);
  const changedFiles = gitChangedFiles();
  const head = safeGitHead();
  const idempotenceContext = {
    command: "verify:360",
    gateVersion: "v2",
    releaseDir: fs.existsSync(releaseDirAbs) ? releaseDirEnv : "MISSING",
    deterministicInput: fs.existsSync(deterministicInputAbs) ? deterministicInputEnv : "MISSING",
    gitHead: head,
    changedFiles: changedFiles || ["UNKNOWN"],
  };
  const idempotenceKey = sha256Text(canonicalJSON(idempotenceContext));
  const idempotenceHistory = findPriorRunByIdempotenceKey(idempotenceKey);
  const priorHistoryLink = findLatestVerifyHistoryLink();
  const idempotencePriorRunId = idempotenceHistory.priorRunId;
  const idempotenceParseErrors = stableSortUnique(idempotenceHistory.parseErrors);
  const idempotenceMode =
    idempotencePriorRunId !== null
      ? "REPLAY"
      : idempotenceParseErrors.length > 0
        ? "PARTIAL"
        : "NEW";
  const idempotencePointerPolicy = idempotenceMode === "NEW" ? "UPDATE_ALLOWED" : "UPDATE_SUPPRESSED";
  let corridorState = "INIT";
  const corridorStateHistory = ["INIT"];
  const advanceState = (next) => {
    const fromIdx = RUN_STATES.indexOf(corridorState);
    const toIdx = RUN_STATES.indexOf(next);
    if (fromIdx < 0 || toIdx < 0 || toIdx < fromIdx) {
      throw new Error(`FAIL_CLOSED_AT_${corridorState}_TO_${next}`);
    }
    corridorState = next;
    corridorStateHistory.push(next);
  };

  const steps = [];
  const addStep = (step) => {
    if (steps.length < MAX_STEPS) steps.push(step);
  };
  const capabilityMap = new Map();
  const recordCapability = (capability, granted, reasonCodes = []) => {
    if (typeof capability !== "string" || capability.length === 0) return;
    capabilityMap.set(capability, {
      capability,
      status: granted ? "GRANTED" : "DENIED",
      reasonCodes: stableSortUnique(reasonCodes),
    });
  };

  const npm = npmExec();
  const npmRun = (name, extraArgs = [], envExtra = {}) =>
    runCommand(name, npm.cmd, [...npm.argsPrefix, "run", name, ...extraArgs], envExtra);

  try {
  if (process.env.WEFTEND_360_FORCE_EXCEPTION === "1") {
    throw new Error("VERIFY360_FORCED_EXCEPTION");
  }
  if (idempotenceMode === "REPLAY") {
    addStep({
      id: "idempotence",
      status: "PASS",
      reasonCodes: ["VERIFY360_IDEMPOTENT_REPLAY", "VERIFY360_POINTER_UPDATE_SUPPRESSED"],
      details: {
        priorRunId: idempotencePriorRunId,
      },
    });
  } else if (idempotenceMode === "PARTIAL") {
    addStep({
      id: "idempotence",
      status: "PARTIAL",
      reasonCodes: ["VERIFY360_IDEMPOTENCE_HISTORY_PARTIAL", "VERIFY360_POINTER_UPDATE_SUPPRESSED"],
      details: {
        parseErrorRuns: idempotenceParseErrors,
      },
    });
  } else {
    addStep({
      id: "idempotence",
      status: "PASS",
      reasonCodes: [],
      details: {
        priorRunId: "NONE",
      },
    });
  }
  recordCapability(
    "output.update_latest_pointer",
    idempotencePointerPolicy === "UPDATE_ALLOWED",
    idempotencePointerPolicy === "UPDATE_ALLOWED" ? [] : ["VERIFY360_POINTER_UPDATE_SUPPRESSED"]
  );

  // Docs/update discipline check (catches "little misses" before commit/release).
  if (!changedFiles) {
    addStep({
      id: "docs_sync",
      status: "PARTIAL",
      reasonCodes: ["VERIFY360_GIT_STATUS_UNAVAILABLE"],
    });
  } else {
    const codeTouched = changedFiles.some(
      (p) =>
        p === "package.json" ||
        p.startsWith("src/") ||
        p.startsWith("scripts/") ||
        p.startsWith("tools/")
    );
    const docsTouched = changedFiles.some(
      (p) =>
        p === "README.md" ||
        p === "docs/RELEASE_NOTES.txt" ||
        p === "docs/QUICKSTART.txt" ||
        p === "docs/RELEASE_CHECKLIST_ALPHA.md"
    );
    if (codeTouched && !docsTouched) {
      addStep({
        id: "docs_sync",
        status: "FAIL",
        reasonCodes: ["VERIFY360_DOC_SYNC_MISSING"],
      });
    } else {
      addStep({
        id: "docs_sync",
        status: "PASS",
        reasonCodes: [],
      });
    }
  }
  advanceState("PRECHECKED");
  recordCapability("git.status", changedFiles !== null, changedFiles !== null ? [] : ["VERIFY360_GIT_STATUS_UNAVAILABLE"]);
  recordCapability("git.head", head !== "UNKNOWN", head !== "UNKNOWN" ? [] : ["VERIFY360_GIT_HEAD_UNAVAILABLE"]);

  // Git/posting etiquette check (avoid odd LLM-style communication artifacts).
  const etiquetteIssues = runPostingEtiquetteCheck();
  if (etiquetteIssues.length > 0) {
    addStep({
      id: "git_etiquette",
      status: "FAIL",
      reasonCodes: stableSortUnique(["VERIFY360_GIT_ETIQUETTE_FAILED", ...etiquetteIssues.map((i) => i.code)]),
      details: {
        issueCount: etiquetteIssues.length,
        issueFiles: stableSortUnique(etiquetteIssues.map((i) => i.relPath)),
      },
    });
  } else {
    addStep({
      id: "git_etiquette",
      status: "PASS",
      reasonCodes: [],
    });
  }

  // Compile
  const compile = npmRun("compile", ["--silent"]);
  addStep({
    id: "compile",
    status: compile.ok ? "PASS" : "FAIL",
    exitCode: compile.exitCode,
    reasonCodes: compile.ok ? [] : ["VERIFY360_COMPILE_FAILED"],
  });
  advanceState("COMPILE_DONE");
  recordCapability("npm.compile", compile.ok, compile.ok ? [] : ["VERIFY360_COMPILE_FAILED"]);

  // Full tests
  const tests = npmRun("test");
  addStep({
    id: "test",
    status: tests.ok ? "PASS" : "FAIL",
    exitCode: tests.exitCode,
    reasonCodes: tests.ok ? [] : ["VERIFY360_TEST_FAILED"],
  });
  advanceState("TEST_DONE");
  recordCapability("npm.test", tests.ok, tests.ok ? [] : ["VERIFY360_TEST_FAILED"]);

  // Proofcheck: host precondition missing is evidence SKIP/PARTIAL, not silent hard block.
  let proofEnv = {};
  const proofReasons = [];
  if (fs.existsSync(releaseDirAbs)) {
    proofEnv = { WEFTEND_RELEASE_DIR: releaseDirEnv };
  } else {
    proofEnv = { WEFTEND_ALLOW_SKIP_RELEASE: "1", WEFTEND_RELEASE_DIR: "" };
    proofReasons.push("VERIFY360_RELEASE_FIXTURE_MISSING");
    proofReasons.push("VERIFY360_RELEASE_SMOKE_SKIPPED");
  }
  recordCapability(
    "fixture.release",
    fs.existsSync(releaseDirAbs),
    fs.existsSync(releaseDirAbs) ? [] : ["VERIFY360_RELEASE_FIXTURE_MISSING"]
  );
  const proof = npmRun("proofcheck", [], proofEnv);
  addStep({
    id: "proofcheck",
    status: proof.ok ? (proofReasons.length > 0 ? "PARTIAL" : "PASS") : "FAIL",
    exitCode: proof.exitCode,
    reasonCodes: proof.ok ? proofReasons : stableSortUnique(["VERIFY360_PROOFCHECK_FAILED", ...proofReasons]),
  });
  advanceState("PROOFCHECK_DONE");
  recordCapability("npm.proofcheck", proof.ok, proof.ok ? [] : ["VERIFY360_PROOFCHECK_FAILED"]);

  // Determinism replay precondition.
  if (!fs.existsSync(deterministicInputAbs)) {
    addStep({
      id: "determinism_input",
      status: "PARTIAL",
      reasonCodes: ["VERIFY360_INPUT_FIXTURE_MISSING", "VERIFY360_DETERMINISM_SKIPPED"],
    });
    addStep({
      id: "safe_run_pair",
      status: "SKIP",
      reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
    });
    addStep({
      id: "privacy_lint_pair",
      status: "SKIP",
      reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
    });
    addStep({
      id: "compare_smoke",
      status: "SKIP",
      reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
    });
    recordCapability("fixture.deterministic_input", false, ["VERIFY360_INPUT_FIXTURE_MISSING"]);
    recordCapability("cli.safe_run", false, ["VERIFY360_DEPENDENCY_MISSING"]);
    recordCapability("runtime.privacy_lint", false, ["VERIFY360_DEPENDENCY_MISSING"]);
    recordCapability("cli.compare", false, ["VERIFY360_DEPENDENCY_MISSING"]);
  } else {
    addStep({
      id: "determinism_input",
      status: "PASS",
      reasonCodes: [],
    });
    recordCapability("fixture.deterministic_input", true, []);

    const safeA = runCommand("safe-run-a", process.execPath, [
      "dist/src/cli/main.js",
      "safe-run",
      deterministicInputAbs,
      "--out",
      outA,
      "--withhold-exec",
    ]);
    const safeB = runCommand("safe-run-b", process.execPath, [
      "dist/src/cli/main.js",
      "safe-run",
      deterministicInputAbs,
      "--out",
      outB,
      "--withhold-exec",
    ]);
    const pairReasons = [];
    let pairOk = safeA.ok && safeB.ok;
    if (!safeA.ok) pairReasons.push("VERIFY360_SAFE_RUN_A_FAILED");
    if (!safeB.ok) pairReasons.push("VERIFY360_SAFE_RUN_B_FAILED");

    if (pairOk) {
      deterministicFileList.forEach((relPath) => {
        const cmpRes = compareFilesEqual(path.join(outA, relPath), path.join(outB, relPath));
        if (!cmpRes.ok) {
          pairOk = false;
          pairReasons.push(cmpRes.reason);
        }
      });
    }
    addStep({
      id: "safe_run_pair",
      status: pairOk ? "PASS" : "FAIL",
      reasonCodes: stableSortUnique(pairReasons),
    });
    recordCapability("cli.safe_run", pairOk, pairReasons);

    if (pairOk) {
      const lintA = runCommand("privacy-lint-a", process.execPath, ["dist/src/runtime/privacy_lint.js", outA]);
      const lintB = runCommand("privacy-lint-b", process.execPath, ["dist/src/runtime/privacy_lint.js", outB]);
      const lintOk = lintA.ok && lintB.ok;
      addStep({
        id: "privacy_lint_pair",
        status: lintOk ? "PASS" : "FAIL",
        reasonCodes: stableSortUnique([
          ...(lintA.ok ? [] : ["VERIFY360_PRIVACY_LINT_A_FAILED"]),
          ...(lintB.ok ? [] : ["VERIFY360_PRIVACY_LINT_B_FAILED"]),
        ]),
      });
      recordCapability(
        "runtime.privacy_lint",
        lintOk,
        stableSortUnique([
          ...(lintA.ok ? [] : ["VERIFY360_PRIVACY_LINT_A_FAILED"]),
          ...(lintB.ok ? [] : ["VERIFY360_PRIVACY_LINT_B_FAILED"]),
        ])
      );

      const cmp = runCommand("compare-smoke", process.execPath, [
        "dist/src/cli/main.js",
        "compare",
        outA,
        outB,
        "--out",
        outCompare,
      ]);
      let cmpOk = cmp.ok;
      const cmpReasons = [];
      if (!cmp.ok) cmpReasons.push("VERIFY360_COMPARE_FAILED");
      if (!fs.existsSync(path.join(outCompare, "compare_receipt.json"))) {
        cmpOk = false;
        cmpReasons.push("VERIFY360_COMPARE_RECEIPT_MISSING");
      }
      if (!fs.existsSync(path.join(outCompare, "compare_report.txt"))) {
        cmpOk = false;
        cmpReasons.push("VERIFY360_COMPARE_REPORT_MISSING");
      }
      if (cmpOk) {
        const lintCompare = runCommand("privacy-lint-compare", process.execPath, ["dist/src/runtime/privacy_lint.js", outCompare]);
        if (!lintCompare.ok) {
          cmpOk = false;
          cmpReasons.push("VERIFY360_COMPARE_PRIVACY_LINT_FAILED");
        }
      }
      addStep({
        id: "compare_smoke",
        status: cmpOk ? "PASS" : "FAIL",
        reasonCodes: stableSortUnique(cmpReasons),
      });
      recordCapability("cli.compare", cmpOk, cmpReasons);
    } else {
      addStep({
        id: "privacy_lint_pair",
        status: "SKIP",
        reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
      });
      addStep({
        id: "compare_smoke",
        status: "SKIP",
        reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
      });
      recordCapability("runtime.privacy_lint", false, ["VERIFY360_DEPENDENCY_MISSING"]);
      recordCapability("cli.compare", false, ["VERIFY360_DEPENDENCY_MISSING"]);
    }
  }
  advanceState("DETERMINISM_DONE");

  const statuses = steps.map((s) => s.status);
  const hasFail = statuses.includes("FAIL");
  const hasPartial = statuses.includes("PARTIAL") || statuses.includes("SKIP");
  const verdict = hasFail ? "FAIL" : hasPartial ? "PARTIAL" : "PASS";
  const reasonCodes = stableSortUnique(
    steps.flatMap((s) => (Array.isArray(s.reasonCodes) ? s.reasonCodes : []))
  );
  recordCapability("output.write_receipt", true, []);
  const stepStatusSummary = summarizeStepStatuses(steps);
  const capabilityDecisions = buildCapabilityDecisions(capabilityMap);
  const explain = buildExplain(verdict, idempotenceMode);
  const stateHistorySnapshot = corridorStateHistory.slice();
  const stateHistorySnapshotDigest = stateHistoryDigest(stateHistorySnapshot);

  const payload = {
    schema: "weftend.verify360/0",
    schemaVersion: 0,
    runId: path.basename(runDir),
    command: "verify:360",
    stateAtStage: corridorState,
    stateTarget: "RECORDED",
    stateHistory: stateHistorySnapshot,
    stateHistoryDigest: stateHistorySnapshotDigest,
    historyLink: {
      priorRunId: priorHistoryLink.priorRunId,
      priorReceiptFileDigest: priorHistoryLink.priorReceiptFileDigest,
    },
    historyLinkDigest: historyLinkDigest(priorHistoryLink),
    idempotenceKey,
    idempotenceContext,
    idempotence: {
      mode: idempotenceMode,
      pointerPolicy: idempotencePointerPolicy,
      priorRunId: idempotencePriorRunId || "NONE",
      historyParseErrors: idempotenceParseErrors,
    },
    verdict,
    reasonCodes,
    observed: {
      schema: "weftend.verify360Observed/0",
      schemaVersion: 0,
      releaseFixturePresent: fs.existsSync(releaseDirAbs),
      deterministicInputPresent: fs.existsSync(deterministicInputAbs),
      runArtifactPresence: {
        runAExists: fs.existsSync(outA) ? 1 : 0,
        runBExists: fs.existsSync(outB) ? 1 : 0,
        compareOutExists: fs.existsSync(outCompare) ? 1 : 0,
      },
      stepCount: steps.length,
      stepStatusSummary,
      capabilityDecisionCount: capabilityDecisions.length,
    },
    interpreted: {
      schema: "weftend.verify360Interpreted/0",
      schemaVersion: 0,
      gateState: corridorState,
      stateHistory: stateHistorySnapshot,
      stateHistoryDigest: stateHistorySnapshotDigest,
      verdict,
      reasonCodes,
      idempotenceMode,
      idempotencePointerPolicy,
      expectedStateTarget: "RECORDED",
    },
    explain,
    releaseFixture: fs.existsSync(releaseDirAbs) ? releaseDirEnv : "MISSING",
    deterministicInput: fs.existsSync(deterministicInputAbs) ? deterministicInputEnv : "MISSING",
    steps,
    artifacts: {
      receiptPath: rel(path.join(runDir, "verify_360_receipt.json")),
      reportPath: rel(path.join(runDir, "verify_360_report.txt")),
      runAExists: fs.existsSync(outA) ? 1 : 0,
      runBExists: fs.existsSync(outB) ? 1 : 0,
      compareOutExists: fs.existsSync(outCompare) ? 1 : 0,
    },
    capabilityLedger: {
      schema: "weftend.verify360CapabilityLedger/0",
      schemaVersion: 0,
      requested: stableSortUnique(CAPABILITY_REQUESTS),
      decisions: capabilityDecisions,
    },
    evidenceChain: {
      links: {
        priorVerifyRunId: priorHistoryLink.priorRunId,
        priorVerifyReceiptFileDigest: priorHistoryLink.priorReceiptFileDigest,
        priorVerifyHistoryLinkDigest: historyLinkDigest(priorHistoryLink),
        safeRunAReceiptDigest: digestIfExists(path.join(outA, "safe_run_receipt.json")),
        safeRunAOperatorDigest: digestIfExists(path.join(outA, "operator_receipt.json")),
        safeRunBReceiptDigest: digestIfExists(path.join(outB, "safe_run_receipt.json")),
        safeRunBOperatorDigest: digestIfExists(path.join(outB, "operator_receipt.json")),
        compareReceiptDigest: digestIfExists(path.join(outCompare, "compare_receipt.json")),
        compareReportDigest: digestIfExists(path.join(outCompare, "compare_report.txt")),
      },
    },
  };
  assertPayloadConsistency(payload);
  advanceState("STAGED");
  writeOutputs(runDir, payload, {
    updateLatestPointer: idempotencePointerPolicy === "UPDATE_ALLOWED",
  });
  advanceState("FINALIZED");
  const finalPayloadPath = path.join(runDir, "verify_360_receipt.json");
  if (!fs.existsSync(finalPayloadPath)) {
    throw new Error("FAIL_CLOSED_AT_FINALIZED_MISSING_RECEIPT");
  }
  advanceState("RECORDED");
  console.log(`verify:360 ${verdict} receipt=${rel(path.join(runDir, "verify_360_receipt.json"))}`);

  if (verdict === "FAIL") process.exit(1);
  process.exit(0);
  } catch (error) {
    const errorDigest = sha256Text(String(error?.message || error || "UNKNOWN"));
    const failClosedAtReason = `VERIFY360_FAIL_CLOSED_AT_${String(corridorState || "UNKNOWN")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 48)}`;
    const emergencyReasonCodes = stableSortUnique([
      ...steps.flatMap((s) => (Array.isArray(s.reasonCodes) ? s.reasonCodes : [])),
      failClosedAtReason,
      ...exceptionReasonCodes(error),
    ]);
    addStep({
      id: "internal_exception",
      status: "FAIL",
      reasonCodes: exceptionReasonCodes(error),
      details: {
        messageDigest: errorDigest,
      },
    });
    recordCapability("output.write_receipt", true, []);
    const capabilityDecisions = buildCapabilityDecisions(capabilityMap);
    const stepStatusSummary = summarizeStepStatuses(steps);
    const failureStateHistory = corridorStateHistory.slice();
    const failureStateHistoryDigest = stateHistoryDigest(failureStateHistory);
    const failurePayload = {
      schema: "weftend.verify360/0",
      schemaVersion: 0,
      runId: path.basename(runDir),
      command: "verify:360",
      stateAtStage: corridorState,
      stateTarget: "RECORDED",
      stateHistory: failureStateHistory,
      stateHistoryDigest: failureStateHistoryDigest,
      historyLink: {
        priorRunId: priorHistoryLink.priorRunId,
        priorReceiptFileDigest: priorHistoryLink.priorReceiptFileDigest,
      },
      historyLinkDigest: historyLinkDigest(priorHistoryLink),
      idempotenceKey,
      idempotenceContext,
      idempotence: {
        mode: idempotenceMode,
        pointerPolicy: "UPDATE_SUPPRESSED",
        priorRunId: idempotencePriorRunId || "NONE",
        historyParseErrors: idempotenceParseErrors,
      },
      verdict: "FAIL",
      reasonCodes: emergencyReasonCodes,
      observed: {
        schema: "weftend.verify360Observed/0",
        schemaVersion: 0,
        releaseFixturePresent: fs.existsSync(releaseDirAbs),
        deterministicInputPresent: fs.existsSync(deterministicInputAbs),
        runArtifactPresence: {
          runAExists: fs.existsSync(outA) ? 1 : 0,
          runBExists: fs.existsSync(outB) ? 1 : 0,
          compareOutExists: fs.existsSync(outCompare) ? 1 : 0,
        },
        stepCount: steps.length,
        stepStatusSummary,
        capabilityDecisionCount: capabilityDecisions.length,
      },
      interpreted: {
        schema: "weftend.verify360Interpreted/0",
        schemaVersion: 0,
        gateState: corridorState,
        stateHistory: failureStateHistory,
        stateHistoryDigest: failureStateHistoryDigest,
        verdict: "FAIL",
        reasonCodes: emergencyReasonCodes,
        idempotenceMode,
        idempotencePointerPolicy: "UPDATE_SUPPRESSED",
        expectedStateTarget: "RECORDED",
      },
      explain: buildExplain("FAIL", idempotenceMode),
      releaseFixture: fs.existsSync(releaseDirAbs) ? releaseDirEnv : "MISSING",
      deterministicInput: fs.existsSync(deterministicInputAbs) ? deterministicInputEnv : "MISSING",
      steps,
      artifacts: {
        receiptPath: rel(path.join(runDir, "verify_360_receipt.json")),
        reportPath: rel(path.join(runDir, "verify_360_report.txt")),
        runAExists: fs.existsSync(outA) ? 1 : 0,
        runBExists: fs.existsSync(outB) ? 1 : 0,
        compareOutExists: fs.existsSync(outCompare) ? 1 : 0,
      },
      capabilityLedger: {
        schema: "weftend.verify360CapabilityLedger/0",
        schemaVersion: 0,
        requested: stableSortUnique(CAPABILITY_REQUESTS),
        decisions: capabilityDecisions,
      },
      evidenceChain: {
        links: {
          priorVerifyRunId: priorHistoryLink.priorRunId,
          priorVerifyReceiptFileDigest: priorHistoryLink.priorReceiptFileDigest,
          priorVerifyHistoryLinkDigest: historyLinkDigest(priorHistoryLink),
          safeRunAReceiptDigest: digestIfExists(path.join(outA, "safe_run_receipt.json")),
          safeRunAOperatorDigest: digestIfExists(path.join(outA, "operator_receipt.json")),
          safeRunBReceiptDigest: digestIfExists(path.join(outB, "safe_run_receipt.json")),
          safeRunBOperatorDigest: digestIfExists(path.join(outB, "operator_receipt.json")),
          compareReceiptDigest: digestIfExists(path.join(outCompare, "compare_receipt.json")),
          compareReportDigest: digestIfExists(path.join(outCompare, "compare_report.txt")),
          exceptionDigest: errorDigest,
        },
      },
    };
    assertPayloadConsistency(failurePayload);
    try {
      writeOutputs(runDir, failurePayload, { updateLatestPointer: false });
    } catch (writeError) {
      writeEmergencyOutputs(runDir, failurePayload, writeError);
    }
    console.log(`verify:360 FAIL receipt=${rel(path.join(runDir, "verify_360_receipt.json"))}`);
    process.exit(1);
  }
};

main();
