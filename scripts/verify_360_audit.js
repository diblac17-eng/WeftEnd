// scripts/verify_360_audit.js
// Audits verify:360 run history integrity for a given output root.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = process.cwd();
const outRoot = process.env.WEFTEND_360_OUT_ROOT
  ? path.resolve(root, process.env.WEFTEND_360_OUT_ROOT)
  : path.join(root, "out", "verify_360");
const historyRoot = path.join(outRoot, "history");
const strictMode = process.env.WEFTEND_360_AUDIT_STRICT === "1";

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
const historyLinkDigest = (historyLink) =>
  sha256Text(
    canonicalJSON({
      priorReceiptFileDigest: String(historyLink?.priorReceiptFileDigest || "NONE"),
      priorRunId: String(historyLink?.priorRunId || "NONE"),
    })
  );
const stateHistoryDigest = (history) => sha256Text(canonicalJSON(Array.isArray(history) ? history : []));

const collectFiles = (dir) => {
  const out = [];
  const walk = (cur, base) => {
    const entries = fs.readdirSync(cur, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name));
    entries.forEach((e) => {
      const abs = path.join(cur, e.name);
      const rel = path.join(base, e.name).split(path.sep).join("/");
      if (e.isDirectory()) walk(abs, rel);
      else out.push({ abs, rel });
    });
  };
  walk(dir, "");
  return out;
};

const fail = (code, detail, errors) => {
  errors.push({ code, detail });
};
const warn = (code, detail, warnings) => {
  warnings.push({ code, detail });
};

const main = () => {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(historyRoot)) {
    fail("VERIFY360_AUDIT_HISTORY_MISSING", historyRoot, errors);
  }
  if (errors.length > 0) {
    errors.forEach((e) => console.error(`${e.code}: ${e.detail}`));
    process.exit(1);
  }

  const runs = fs
    .readdirSync(historyRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^run_[0-9]{6}$/.test(d.name))
    .map((d) => d.name)
    .sort(cmp);

  if (runs.length === 0) {
    fail("VERIFY360_AUDIT_NO_RUNS", historyRoot, errors);
  }

  runs.forEach((runName, idx) => {
    const runDir = path.join(historyRoot, runName);
    const receiptPath = path.join(runDir, "verify_360_receipt.json");
    const reportPath = path.join(runDir, "verify_360_report.txt");
    const manifestPath = path.join(runDir, "verify_360_output_manifest.json");
    if (!fs.existsSync(receiptPath)) fail("VERIFY360_AUDIT_RECEIPT_MISSING", runName, errors);
    if (!fs.existsSync(reportPath)) fail("VERIFY360_AUDIT_REPORT_MISSING", runName, errors);
    const hasManifest = fs.existsSync(manifestPath);
    if (!hasManifest) warn("VERIFY360_AUDIT_LEGACY_MANIFEST_MISSING", runName, warnings);
    if (errors.length > 0) return;

    let receipt;
    let manifest = { files: [] };
    try {
      receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      if (hasManifest) manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      fail("VERIFY360_AUDIT_JSON_PARSE_FAILED", runName, errors);
      return;
    }

    if (String(receipt.runId || "") !== runName) fail("VERIFY360_AUDIT_RUN_ID_MISMATCH", runName, errors);
    const hasHistoryLink = Boolean(receipt.historyLink && typeof receipt.historyLinkDigest === "string");

    const rc = Array.isArray(receipt.reasonCodes) ? receipt.reasonCodes : [];
    const rcSorted = stableSortUnique(rc);
    if (rc.length !== rcSorted.length || rc.some((v, i) => v !== rcSorted[i])) {
      fail("VERIFY360_AUDIT_REASON_CODES_ORDER", runName, errors);
    }

    const stateHistory = Array.isArray(receipt.stateHistory) ? receipt.stateHistory : [];
    const hasStateDigest = typeof receipt.stateHistoryDigest === "string";
    const interpretedStateDigest = receipt?.interpreted?.stateHistoryDigest;
    if (!hasStateDigest || typeof interpretedStateDigest !== "string") {
      warn("VERIFY360_AUDIT_LEGACY_STATE_DIGEST_MISSING", runName, warnings);
    } else {
      const expectedStateDigest = stateHistoryDigest(stateHistory);
      if (receipt.stateHistoryDigest !== expectedStateDigest) {
        if (hasHistoryLink) fail("VERIFY360_AUDIT_STATE_DIGEST_MISMATCH", runName, errors);
        else warn("VERIFY360_AUDIT_LEGACY_STATE_DIGEST_MISMATCH", runName, warnings);
      }
      if (interpretedStateDigest !== receipt.stateHistoryDigest) {
        if (hasHistoryLink) fail("VERIFY360_AUDIT_INTERPRETED_STATE_DIGEST_MISMATCH", runName, errors);
        else warn("VERIFY360_AUDIT_LEGACY_INTERPRETED_STATE_DIGEST_MISMATCH", runName, warnings);
      }
    }

    if (hasManifest) {
      const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
      manifestFiles.forEach((f) => {
        const rel = String(f.name || "");
        const digest = String(f.digest || "");
        const abs = path.join(runDir, rel);
        if (!fs.existsSync(abs)) {
          fail("VERIFY360_AUDIT_MANIFEST_FILE_MISSING", `${runName}:${rel}`, errors);
          return;
        }
        const actual = sha256File(abs);
        if (digest !== actual) fail("VERIFY360_AUDIT_MANIFEST_DIGEST_MISMATCH", `${runName}:${rel}`, errors);
      });
      const allowed = new Set(manifestFiles.map((f) => String(f.name || "")).concat("verify_360_output_manifest.json"));
      const orphans = collectFiles(runDir)
        .map((f) => f.rel)
        .filter((name) => !allowed.has(name));
      if (orphans.length > 0) fail("VERIFY360_AUDIT_ORPHAN_OUTPUT", `${runName}:${orphans.join(",")}`, errors);
    }

    const historyLink = receipt.historyLink;
    const historyLinkD = receipt.historyLinkDigest;
    if (!historyLink || typeof historyLinkD !== "string") {
      warn("VERIFY360_AUDIT_LEGACY_HISTORY_LINK_MISSING", runName, warnings);
    } else {
      const expectedDigest = historyLinkDigest(historyLink);
      if (historyLinkD !== expectedDigest) fail("VERIFY360_AUDIT_HISTORY_LINK_DIGEST_MISMATCH", runName, errors);
      const priorExpectedRun = idx > 0 ? runs[idx - 1] : "NONE";
      const priorExpectedDigest = idx > 0 ? sha256File(path.join(historyRoot, priorExpectedRun, "verify_360_receipt.json")) : "NONE";
      if (String(historyLink.priorRunId || "NONE") !== priorExpectedRun) {
        fail("VERIFY360_AUDIT_HISTORY_PRIOR_RUN_MISMATCH", runName, errors);
      }
      if (String(historyLink.priorReceiptFileDigest || "NONE") !== priorExpectedDigest) {
        fail("VERIFY360_AUDIT_HISTORY_PRIOR_DIGEST_MISMATCH", runName, errors);
      }
      const links = receipt?.evidenceChain?.links || {};
      if (String(links.priorVerifyRunId || "NONE") !== String(historyLink.priorRunId || "NONE")) {
        fail("VERIFY360_AUDIT_HISTORY_EVIDENCE_RUN_MISMATCH", runName, errors);
      }
      if (String(links.priorVerifyReceiptFileDigest || "NONE") !== String(historyLink.priorReceiptFileDigest || "NONE")) {
        fail("VERIFY360_AUDIT_HISTORY_EVIDENCE_DIGEST_MISMATCH", runName, errors);
      }
      if (String(links.priorVerifyHistoryLinkDigest || "") !== String(historyLinkD || "")) {
        fail("VERIFY360_AUDIT_HISTORY_EVIDENCE_LINK_DIGEST_MISMATCH", runName, errors);
      }
    }
  });

  const latestPath = path.join(outRoot, "latest.txt");
  if (fs.existsSync(latestPath)) {
    const latest = String(fs.readFileSync(latestPath, "utf8") || "").trim();
    if (latest.length > 0) {
      const latestAbs = path.resolve(root, latest);
      if (!fs.existsSync(latestAbs)) fail("VERIFY360_AUDIT_LATEST_POINTER_MISSING_TARGET", latest, errors);
    }
  }

  warnings.forEach((w) => console.error(`WARN ${w.code}: ${w.detail}`));
  if (errors.length > 0) {
    errors.forEach((e) => console.error(`${e.code}: ${e.detail}`));
    process.exit(1);
  }
  if (strictMode && warnings.length > 0) {
    console.error(`VERIFY360_AUDIT_STRICT_WARNINGS:${warnings.length}`);
    process.exit(1);
  }
  console.log(
    `verify:360:audit PASS outRoot=${outRoot} runs=${runs.length} warnings=${warnings.length} strict=${strictMode ? "1" : "0"}`
  );
};

main();
