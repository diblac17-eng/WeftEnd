// src/cli/ticket_pack.ts
// Build a deterministic ticket-pack bundle for attaching receipts to tickets.

import { canonicalJSON } from "../core/canon";
import { cmpStrV0 } from "../core/order";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

type TicketPackEntry = {
  relPath: string;
  sha256: string;
  bytes: number;
};

const normalizeRel = (root: string, filePath: string): string =>
  path.relative(path.resolve(root), path.resolve(filePath)).split(path.sep).join("/");

const isSafeRelativePath = (value: string): boolean => {
  const rel = String(value || "").replace(/\\/g, "/").trim();
  if (!rel) return false;
  if (rel.startsWith("/") || /^[A-Za-z]:\//.test(rel)) return false;
  if (rel.includes("..")) return false;
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(rel)) return false;
  if (/\$env:[A-Za-z_][A-Za-z0-9_]*/.test(rel)) return false;
  return true;
};

const resolveWithinRoot = (root: string, relPath: string): string | null => {
  const rootAbs = path.resolve(root);
  const candidate = path.resolve(rootAbs, relPath);
  const rel = path.relative(rootAbs, candidate);
  if (!rel || rel === ".") return candidate;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return candidate;
};

const sha256File = (filePath: string): string => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
};

const readFileDigest = (filePath: string): string => {
  try {
    if (!fs.existsSync(filePath)) return "-";
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return "-";
    return `sha256:${sha256File(filePath)}`;
  } catch {
    return "-";
  }
};

const readJson = (filePath: string): any => JSON.parse(fs.readFileSync(filePath, "utf8"));

const getObjProp = (obj: any, key: string): any => {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as any)[key];
};

const firstWordToken = (value: string): string => {
  const text = String(value || "").trim();
  if (!text) return "";
  const m = text.match(/^([A-Za-z0-9_]+)/);
  return m ? m[1] : "";
};

const collectOperatorEntries = (outRoot: string): { entries: string[]; issues: string[] } => {
  const operatorPath = path.join(outRoot, "operator_receipt.json");
  if (!fs.existsSync(operatorPath)) {
    return { entries: [], issues: ["TICKET_PACK_MISSING_OPERATOR_RECEIPT"] };
  }
  let operator: any;
  try {
    operator = readJson(operatorPath);
  } catch {
    return { entries: [], issues: ["TICKET_PACK_OPERATOR_RECEIPT_INVALID"] };
  }
  const receipts = Array.isArray(operator?.receipts) ? operator.receipts : [];
  const rels = receipts
    .map((entry: any) => String(entry?.relPath ?? ""))
    .filter((rel: string) => rel && rel.trim() !== "");
  return { entries: rels, issues: [] };
};

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const writeText = (filePath: string, text: string) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
};

const buildManifest = (entries: TicketPackEntry[]): { schemaVersion: 0; entries: TicketPackEntry[]; manifestDigest: string } => {
  const sorted = entries
    .slice()
    .sort((a, b) => {
      const c0 = cmpStrV0(a.relPath, b.relPath);
      if (c0 !== 0) return c0;
      const c1 = cmpStrV0(a.sha256, b.sha256);
      if (c1 !== 0) return c1;
      return a.bytes - b.bytes;
    });
  const base: any = { schemaVersion: 0, entries: sorted, manifestDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  const digest = computeArtifactDigestV0(canonicalJSON(base));
  return { schemaVersion: 0 as const, entries: sorted, manifestDigest: digest };
};

const createZipWindows = (srcDir: string, zipPath: string): { ok: boolean; code?: string } => {
  const cmd =
    "$src=[string]$args[0];$dst=[string]$args[1];" +
    "Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dst -Force";
  const spawn = require("child_process").spawnSync;
  const res = spawn("powershell", ["-NoProfile", "-Command", cmd, srcDir, zipPath], { stdio: "pipe" });
  if (res.status !== 0) {
    return { ok: false, code: "TICKET_PACK_ZIP_FAILED" };
  }
  return { ok: true };
};

export const runTicketPackCli = (options: {
  outRoot: string;
  outDir: string;
  zipRequested: boolean;
}): number => {
  if (!options.outRoot) {
    console.error("[INPUT_INVALID] ticket-pack requires <outRoot>.");
    return 40;
  }
  if (!options.outDir) {
    console.error("[OUT_REQUIRED] ticket-pack requires --out <dir>.");
    return 40;
  }

  const outRoot = path.resolve(process.cwd(), options.outRoot);
  const outDir = path.resolve(process.cwd(), options.outDir);
  if (!fs.existsSync(outRoot)) {
    console.error("[TICKET_PACK_MISSING_OUTROOT] outRoot not found.");
    return 40;
  }
  ensureDir(outDir);

  const packDir = path.join(outDir, "ticket_pack");
  fs.rmSync(packDir, { recursive: true, force: true });
  ensureDir(packDir);

  const collected = collectOperatorEntries(outRoot);
  if (collected.issues.length > 0) {
    collected.issues.forEach((code) => console.error(`[${code}] operator_receipt.json missing or invalid.`));
    return 40;
  }

  const extras = [
    "operator_receipt.json",
    "report_card.txt",
    "report_card_v0.json",
    "compare_report.txt",
    "compare_receipt.json",
    "weftend/README.txt",
  ];
  const relPaths = Array.from(new Set([...collected.entries, ...extras])).sort((a, b) => cmpStrV0(a, b));
  const missing: string[] = [];
  const copied: Array<{ relPath: string; absPath: string }> = [];
  relPaths.forEach((rel) => {
    if (!isSafeRelativePath(rel)) {
      missing.push(`invalid:${rel}`);
      return;
    }
    const abs = resolveWithinRoot(outRoot, rel);
    if (!abs) {
      missing.push(`outside:${rel}`);
      return;
    }
    if (!fs.existsSync(abs)) return;
    if (!fs.statSync(abs).isFile()) return;
    copied.push({ relPath: rel, absPath: abs });
  });
  if (copied.length === 0) {
    console.error("[TICKET_PACK_NO_FILES] no receipts found to pack.");
    return 40;
  }
  missing.push(
    ...collected.entries.filter((rel) => !fs.existsSync(path.join(outRoot, rel))).map((rel) => `missing:${rel}`)
  );
  if (missing.length > 0) {
    if (missing.some((v) => v.startsWith("invalid:") || v.startsWith("outside:"))) {
      console.error("[TICKET_PACK_RECEIPT_PATH_INVALID] operator receipt contains unsafe relPath.");
      return 40;
    }
    console.error("[TICKET_PACK_MISSING_FILE] some receipt files are missing.");
    return 40;
  }

  copied.forEach((entry) => {
    const dest = path.join(packDir, entry.relPath);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(entry.absPath, dest);
  });

  const operatorPath = path.join(outRoot, "operator_receipt.json");
  let operator: any = null;
  try {
    operator = readJson(operatorPath);
  } catch {
    // best-effort summary
  }

  let adapterEvidence = "none";
  let adapterId = "-";
  let adapterMode = "-";
  let adapterClass = "-";
  let capRequested = 0;
  let capGranted = 0;
  let capDenied = 0;
  let artifactFingerprint = "-";
  let artifactDigest = "-";
  let reportRunId = "-";
  let reportLibraryKey = "-";
  let reportStatus = "-";
  let reportBaseline = "-";
  let reportLatest = "-";
  let reportBuckets = "-";
  const safePath = path.join(outRoot, "safe_run_receipt.json");
  const operatorFileDigest = readFileDigest(operatorPath);
  const safeFileDigest = readFileDigest(safePath);
  const reportCardJsonPath = path.join(outRoot, "report_card_v0.json");
  const reportCardTxtPath = path.join(outRoot, "report_card.txt");
  const reportCardFileDigest = fs.existsSync(reportCardJsonPath) ? readFileDigest(reportCardJsonPath) : readFileDigest(reportCardTxtPath);
  const compareReceiptPath = path.join(outRoot, "compare_receipt.json");
  const compareReportPath = path.join(outRoot, "compare_report.txt");
  const compareReceiptFileDigest = readFileDigest(compareReceiptPath);
  const compareReportFileDigest = readFileDigest(compareReportPath);
  const compareArtifacts = compareReceiptFileDigest !== "-" || compareReportFileDigest !== "-" ? "present" : "none";
  try {
    if (fs.existsSync(safePath)) {
      const safe = readJson(safePath);
      const adapter = getObjProp(safe, "adapter");
      if (adapter && typeof adapter === "object") {
        const id = String(getObjProp(adapter, "adapterId") ?? "").trim();
        const mode = String(getObjProp(adapter, "mode") ?? "").trim();
        if (id) adapterId = id;
        if (mode) adapterMode = mode;
      }
      const contentSummary = getObjProp(safe, "contentSummary");
      const adapterSignals = contentSummary && typeof contentSummary === "object" ? getObjProp(contentSummary, "adapterSignals") : null;
      if (adapterSignals && typeof adapterSignals === "object") {
        const klass = String(getObjProp(adapterSignals, "class") ?? "").trim();
        if (klass) adapterClass = klass;
      }
      if (adapterClass === "-" && /^([a-z0-9_]+)_adapter_v[0-9]+$/.test(adapterId)) {
        adapterClass = adapterId.replace(/^([a-z0-9_]+)_adapter_v[0-9]+$/, "$1");
      }
      if (adapterClass === "-" && String(getObjProp(safe, "artifactKind") ?? "") === "CONTAINER_IMAGE") {
        adapterClass = "container";
      }
      const fp = String(getObjProp(safe, "artifactFingerprint") ?? "").trim();
      const dg = String(getObjProp(safe, "artifactDigest") ?? "").trim();
      if (fp) artifactFingerprint = fp;
      if (dg) artifactDigest = dg;
      if (adapterId !== "-" || adapterClass !== "-") adapterEvidence = "present";
    }
  } catch {
    // best effort summary
  }
  try {
    if (fs.existsSync(reportCardJsonPath)) {
      const report = readJson(reportCardJsonPath);
      const runId = String(getObjProp(report, "runId") ?? "").trim();
      const libraryKey = String(getObjProp(report, "libraryKey") ?? "").trim();
      const status = String(getObjProp(report, "status") ?? "").trim();
      const baseline = String(getObjProp(report, "baseline") ?? "").trim();
      const latest = String(getObjProp(report, "latest") ?? "").trim();
      const buckets = String(getObjProp(report, "buckets") ?? "").trim();
      if (runId) reportRunId = runId;
      if (libraryKey) reportLibraryKey = libraryKey;
      if (status) reportStatus = status;
      if (baseline) reportBaseline = baseline;
      if (latest) reportLatest = latest;
      if (buckets) reportBuckets = buckets;
      if (artifactFingerprint === "-") {
        const fp = String(getObjProp(report, "artifactFingerprint") ?? "").trim();
        if (fp) artifactFingerprint = fp;
      }
      if (artifactDigest === "-") {
        const dg = String(getObjProp(report, "artifactDigest") ?? "").trim();
        if (dg) artifactDigest = dg;
      }
    }
  } catch {
    // best effort summary
  }
  try {
    if (
      (reportRunId === "-" || reportLibraryKey === "-" || reportStatus === "-" || reportBaseline === "-" || reportLatest === "-" || reportBuckets === "-") &&
      fs.existsSync(reportCardTxtPath)
    ) {
      const lines = String(fs.readFileSync(reportCardTxtPath, "utf8") || "")
        .replace(/\r/g, "")
        .split("\n");
      for (const lineRaw of lines) {
        const line = String(lineRaw || "").trim();
        if (!line) continue;
        if (reportRunId === "-" && line.startsWith("runId=")) {
          const value = line.slice("runId=".length).trim();
          if (value) reportRunId = value;
          continue;
        }
        if (reportLibraryKey === "-" && line.startsWith("libraryKey=")) {
          const value = line.slice("libraryKey=".length).trim();
          if (value) reportLibraryKey = value;
          continue;
        }
        if (reportStatus === "-" && line.startsWith("STATUS:")) {
          const value = firstWordToken(line.slice("STATUS:".length));
          if (value) reportStatus = value;
          continue;
        }
        if (reportBaseline === "-" && line.startsWith("BASELINE:")) {
          const value = line.slice("BASELINE:".length).trim();
          if (value) reportBaseline = value;
          continue;
        }
        if (reportLatest === "-" && line.startsWith("LATEST:")) {
          const value = line.slice("LATEST:".length).trim();
          if (value) reportLatest = value;
          continue;
        }
        if (reportBuckets === "-" && line.startsWith("BUCKETS:")) {
          const value = line.slice("BUCKETS:".length).trim();
          if (value) reportBuckets = value;
          continue;
        }
      }
    }
  } catch {
    // best effort summary
  }
  const capPath = path.join(outRoot, "analysis", "capability_ledger_v0.json");
  try {
    if (fs.existsSync(capPath)) {
      const cap = readJson(capPath);
      const req = getObjProp(cap, "requestedCaps");
      const gr = getObjProp(cap, "grantedCaps");
      const den = getObjProp(cap, "deniedCaps");
      capRequested = Array.isArray(req) ? req.length : 0;
      capGranted = Array.isArray(gr) ? gr.length : 0;
      capDenied = Array.isArray(den) ? den.length : 0;
      if (capRequested > 0 || capGranted > 0 || capDenied > 0) adapterEvidence = "present";
    }
  } catch {
    // best effort summary
  }

  const summaryLines = [
    "ticketPack=weftend",
    `command=${String(operator?.command ?? "UNKNOWN")}`,
    `result=${String(operator?.result ?? operator?.verdict ?? "UNKNOWN")}`,
    `receiptDigest=${String(operator?.receiptDigest ?? "UNKNOWN")}`,
    `operatorReceiptFileDigest=${operatorFileDigest}`,
    `safeReceiptFileDigest=${safeFileDigest}`,
    `reportCardFileDigest=${reportCardFileDigest}`,
    `compareArtifacts=${compareArtifacts}`,
    `compareReceiptFileDigest=${compareReceiptFileDigest}`,
    `compareReportFileDigest=${compareReportFileDigest}`,
    `reportRunId=${reportRunId}`,
    `reportLibraryKey=${reportLibraryKey}`,
    `reportStatus=${reportStatus}`,
    `reportBaseline=${reportBaseline}`,
    `reportLatest=${reportLatest}`,
    `reportBuckets=${reportBuckets}`,
    `artifactFingerprint=${artifactFingerprint}`,
    `artifactDigest=${artifactDigest}`,
    `adapterEvidence=${adapterEvidence}`,
    `adapterClass=${adapterClass}`,
    `adapterId=${adapterId}`,
    `adapterMode=${adapterMode}`,
    `capabilities=requested:${String(capRequested)} granted:${String(capGranted)} denied:${String(capDenied)}`,
  ];
  writeText(path.join(packDir, "ticket_summary.txt"), `${summaryLines.join("\n")}\n`);

  const baseEntries: TicketPackEntry[] = copied.map((entry) => ({
    relPath: entry.relPath,
    sha256: sha256File(entry.absPath),
    bytes: fs.statSync(entry.absPath).size,
  }));
  const summaryEntry: TicketPackEntry = {
    relPath: "ticket_summary.txt",
    sha256: sha256File(path.join(packDir, "ticket_summary.txt")),
    bytes: fs.statSync(path.join(packDir, "ticket_summary.txt")).size,
  };
  const manifest = buildManifest([...baseEntries, summaryEntry]);
  writeText(path.join(packDir, "ticket_pack_manifest.json"), `${canonicalJSON(manifest)}\n`);

  const checksumFiles = [...baseEntries, summaryEntry, { relPath: "ticket_pack_manifest.json", sha256: "", bytes: 0 }]
    .map((entry) => {
      const abs = path.join(packDir, entry.relPath);
      const sha = sha256File(abs);
      return { relPath: entry.relPath, sha256: sha, bytes: fs.statSync(abs).size };
    })
    .sort((a, b) => cmpStrV0(a.relPath, b.relPath));
  const checksumLines = checksumFiles.map((entry) => `sha256:${entry.sha256} ${entry.relPath}`);
  writeText(path.join(packDir, "checksums.txt"), `${checksumLines.join("\n")}\n`);

  const lint = runPrivacyLintV0({ root: packDir, writeReport: false });
  if (lint.report.verdict !== "PASS") {
    console.error("[TICKET_PACK_PRIVACY_FAIL] ticket pack failed privacy lint.");
    return 40;
  }

  if (options.zipRequested) {
    if (process.platform !== "win32") {
      console.error("[TICKET_PACK_ZIP_UNAVAILABLE] zip requires Windows powershell.");
      return 40;
    }
    const zipPath = path.join(outDir, "ticket_pack.zip");
    const zipped = createZipWindows(packDir, zipPath);
    if (!zipped.ok) {
      console.error("[TICKET_PACK_ZIP_FAILED] unable to create zip.");
      return 40;
    }
  }

  console.log("ticket_pack: OK");
  return 0;
};
