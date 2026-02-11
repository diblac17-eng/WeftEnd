// src/cli/ticket_pack.ts
// Build a deterministic ticket-pack bundle for attaching receipts to tickets.

import { canonicalJSON } from "../core/canon";
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

const readJson = (filePath: string): any => JSON.parse(fs.readFileSync(filePath, "utf8"));

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
      const c0 = a.relPath.localeCompare(b.relPath);
      if (c0 !== 0) return c0;
      const c1 = a.sha256.localeCompare(b.sha256);
      if (c1 !== 0) return c1;
      return a.bytes - b.bytes;
    });
  const base: any = { schemaVersion: 0, entries: sorted, manifestDigest: "fnv1a32:00000000" };
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
    "compare_report.txt",
    "compare_receipt.json",
    "weftend/README.txt",
  ];
  const relPaths = Array.from(new Set([...collected.entries, ...extras])).sort((a, b) => a.localeCompare(b));
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

  const summaryLines = [
    "ticketPack=weftend",
    `command=${String(operator?.command ?? "UNKNOWN")}`,
    `result=${String(operator?.result ?? operator?.verdict ?? "UNKNOWN")}`,
    `receiptDigest=${String(operator?.receiptDigest ?? "UNKNOWN")}`,
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
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
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
