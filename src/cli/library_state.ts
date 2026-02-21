/* src/cli/library_state.ts */
// Library view-state: baseline/blocked/latest + history keys (no receipt changes).

import { canonicalJSON } from "../core/canon";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { resolveLibraryRootV0 } from "../runtime/library_root";
import { loadCompareSourceV0 } from "./compare_loader";
import { normalizeCompareSourceV0 } from "./compare_normalize";
import { compareSummariesV0 } from "./compare";

declare const require: any;

const fs = require("fs");
const path = require("path");

const MAX_HISTORY = 8;
const MAX_BLOCKED_REASONS = 8;

export type LibraryViewKeyV0 = {
  verdictVsBaseline: "SAME" | "CHANGED";
  buckets: string[];
  artifactDigest: string;
  result: string;
};

export type LibraryViewStateV0 = {
  schemaVersion: 0;
  targetKey: string;
  baselineRunId: string;
  latestRunId: string;
  blocked: { runId: string; reasonCodes: string[] } | null;
  lastN: string[];
  keys: LibraryViewKeyV0[];
};

const isRunDirName = (name: string): boolean => name.startsWith("run_");

const listRunDirs = (dir: string): string[] => {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }) as any;
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory && entry.isDirectory())
    .map((entry) => String(entry.name))
    .filter((name) => isRunDirName(name))
    .sort((a, b) => cmpStrV0(a, b));
};

const readPointer = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
};

const writeTextAtomic = (filePath: string, value: string): boolean => {
  const stagePath = `${filePath}.stage`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(stagePath, value, "utf8");
    fs.renameSync(stagePath, filePath);
    return true;
  } catch {
    try {
      if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);
    } catch {
      // best-effort cleanup only
    }
    return false;
  }
};

const writePointer = (filePath: string, value: string): boolean => {
  return writeTextAtomic(filePath, `${value}\n`);
};

const parseBlockedLine = (line: string): { runId: string; reasonCodes: string[] } | null => {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = /^runId=([^ ]+)\s+reasons=(.*)$/.exec(trimmed);
  if (!match) return null;
  const runId = match[1].trim();
  const reasonsRaw = match[2].trim();
  const reasons = reasonsRaw
    ? reasonsRaw.split(",").map((r) => r.trim()).filter((r) => r.length > 0)
    : [];
  return { runId, reasonCodes: stableSortUniqueStringsV0(reasons).slice(0, MAX_BLOCKED_REASONS) };
};

const readBlocked = (filePath: string): { runId: string; reasonCodes: string[] } | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8").split(/\r?\n/)[0] || "";
    return parseBlockedLine(raw);
  } catch {
    return null;
  }
};

const writeBlocked = (filePath: string, runId: string, reasonCodes: string[]): boolean => {
  const codes = stableSortUniqueStringsV0(reasonCodes).slice(0, MAX_BLOCKED_REASONS);
  const line = `runId=${runId} reasons=${codes.join(",")}`;
  return writeTextAtomic(filePath, `${line}\n`);
};

const loadViewState = (filePath: string): LibraryViewStateV0 | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== 0) return null;
    return parsed as LibraryViewStateV0;
  } catch {
    return null;
  }
};

const normalizeResult = (value: string | undefined): string => {
  if (!value) return "UNKNOWN";
  const part = value.includes(":") ? value.split(":")[0] : value;
  if (part === "APPROVE") return "ALLOW";
  if (part === "REJECT" || part === "HOLD") return "DENY";
  return part;
};

const mapBuckets = (compareBuckets: string[], digestChanged: boolean): string[] => {
  const letters = new Set<string>();
  const hasAny = (targets: string[]) => compareBuckets.some((b) => targets.includes(b));
  if (digestChanged || compareBuckets.includes("DIGEST_CHANGED")) letters.add("D");
  if (
    hasAny([
      "CONTENT_CHANGED",
      "KIND_PROFILE_CHANGED",
      "SCRIPT_SURFACE_CHANGED",
      "NATIVE_BINARY_APPEARED",
      "URL_INDICATORS_CHANGED",
      "SIGNATURE_STATUS_CHANGED",
      "ARCHIVE_DEPTH_CHANGED",
    ])
  )
    letters.add("C");
  if (compareBuckets.includes("EXTERNALREFS_CHANGED")) letters.add("X");
  if (compareBuckets.includes("REASONS_CHANGED")) letters.add("R");
  if (compareBuckets.includes("POLICY_CHANGED")) letters.add("P");
  if (compareBuckets.includes("HOST_TRUTH_CHANGED")) letters.add("H");
  if (compareBuckets.includes("BOUNDS_CHANGED")) letters.add("B");
  return Array.from(letters).sort((a, b) => cmpStrV0(a, b));
};

const loadSummary = (runDir: string): ReturnType<typeof normalizeCompareSourceV0> | null => {
  const loaded = loadCompareSourceV0(runDir, "left");
  if (!loaded.ok) return null;
  return normalizeCompareSourceV0(loaded.value);
};

const ensureBaseline = (runIds: string[], currentRunId: string, baseline: string | null): string => {
  if (baseline && runIds.includes(baseline)) return baseline;
  if (runIds.length > 0) return runIds[0];
  return currentRunId;
};

const trimLastN = (values: string[], maxItems: number): string[] => {
  if (values.length <= maxItems) return values;
  return values.slice(values.length - maxItems);
};

const normalizeLastN = (values: string[], runIds: string[]): string[] => {
  const present = new Set(runIds);
  return values.filter((v) => present.has(v));
};

const resolveViewContext = (outDir: string): { ok: boolean; libraryRoot?: string; targetKey?: string; runId?: string; targetDir?: string; viewDir?: string } => {
  const root = resolveLibraryRootV0().root;
  const rel = path.relative(root, path.resolve(outDir));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false };
  const parts = rel.split(path.sep).filter((p: string) => p.length > 0);
  if (parts.length < 2) return { ok: false };
  const targetKey = parts[0];
  const runId = parts[1];
  if (!isRunDirName(runId)) return { ok: false };
  const targetDir = path.join(root, targetKey);
  const viewDir = path.join(targetDir, "view");
  return { ok: true, libraryRoot: root, targetKey, runId, targetDir, viewDir };
};

const buildViewState = (input: {
  targetKey: string;
  targetDir: string;
  baselineRunId: string;
  latestRunId: string;
  blocked: { runId: string; reasonCodes: string[] } | null;
  lastN: string[];
}): LibraryViewStateV0 => {
  const baselineDir = path.join(input.targetDir, input.baselineRunId);
  const baselineSummary = loadSummary(baselineDir);
  const baseline = baselineSummary ?? loadSummary(path.join(input.targetDir, input.latestRunId));
  const safeBaseline = baseline?.summary;

  const keys: LibraryViewKeyV0[] = [];
  input.lastN.forEach((runId) => {
    const runSummary = loadSummary(path.join(input.targetDir, runId));
    const summary = runSummary?.summary;
    const digestLeft = safeBaseline?.artifactDigest ?? "UNKNOWN";
    const digestRight = summary?.artifactDigest ?? "UNKNOWN";
    const digestChanged = digestLeft !== digestRight;
    const compared =
      safeBaseline && summary ? compareSummariesV0(safeBaseline, summary) : { verdict: "CHANGED" as const, changeBuckets: [], changes: [] };
    const buckets = mapBuckets(compared.changeBuckets, digestChanged);
    const changed = digestChanged || compared.verdict === "CHANGED";
    keys.push({
      verdictVsBaseline: changed ? "CHANGED" : "SAME",
      buckets,
      artifactDigest: summary?.artifactDigest ?? "UNKNOWN",
      result: normalizeResult(summary?.result),
    });
  });

  return {
    schemaVersion: 0,
    targetKey: input.targetKey,
    baselineRunId: input.baselineRunId,
    latestRunId: input.latestRunId,
    blocked: input.blocked,
    lastN: input.lastN.slice(),
    keys,
  };
};

const writeViewState = (viewDir: string, state: LibraryViewStateV0): boolean => {
  return writeTextAtomic(path.join(viewDir, "view_state.json"), `${canonicalJSON(state)}\n`);
};

export const updateLibraryViewFromRunV0 = (options: {
  outDir: string;
  privacyVerdict: "PASS" | "FAIL";
  hostSelfStatus?: "OK" | "UNVERIFIED" | "MISSING";
  hostSelfReasonCodes?: string[];
}): { ok: boolean; code?: string; skipped?: boolean; viewState?: LibraryViewStateV0 } => {
  const ctx = resolveViewContext(options.outDir);
  if (!ctx.ok || !ctx.targetDir || !ctx.viewDir || !ctx.runId || !ctx.targetKey) return { ok: false, skipped: true };

  const runIds = listRunDirs(ctx.targetDir);
  const baselinePath = path.join(ctx.viewDir, "baseline.txt");
  const latestPath = path.join(ctx.viewDir, "latest.txt");
  const blockedPath = path.join(ctx.viewDir, "blocked.txt");
  const viewStatePath = path.join(ctx.viewDir, "view_state.json");

  let baseline = ensureBaseline(runIds, ctx.runId, readPointer(baselinePath));
  if (!runIds.includes(baseline)) {
    baseline = ctx.runId;
  }
  if (!writePointer(baselinePath, baseline)) return { ok: false, code: "LIBRARY_BASELINE_WRITE_FAILED" };
  if (!writePointer(latestPath, ctx.runId)) return { ok: false, code: "LIBRARY_LATEST_WRITE_FAILED" };

  const existingBlocked = readBlocked(blockedPath);
  let blocked = existingBlocked;
  if (!blocked) {
    const reasons: string[] = [];
    if (options.privacyVerdict === "FAIL") reasons.push("PRIVACY_LINT_FAIL");
    if (options.hostSelfStatus && options.hostSelfStatus !== "OK") reasons.push("HOST_STARTUP_UNVERIFIED");
    if (options.hostSelfReasonCodes && options.hostSelfReasonCodes.length > 0) {
      reasons.push(...options.hostSelfReasonCodes);
    }
    const normalized = stableSortUniqueStringsV0(reasons).slice(0, MAX_BLOCKED_REASONS);
    if (normalized.length > 0) {
      if (!writeBlocked(blockedPath, ctx.runId, normalized)) return { ok: false, code: "LIBRARY_BLOCKED_WRITE_FAILED" };
      blocked = { runId: ctx.runId, reasonCodes: normalized };
    }
  }

  const prior = loadViewState(viewStatePath);
  let lastN = normalizeLastN(prior?.lastN ?? [], runIds);
  if (!lastN.includes(ctx.runId)) lastN.push(ctx.runId);
  if (lastN.length === 0) lastN = [ctx.runId];
  lastN = trimLastN(lastN, MAX_HISTORY);

  const state = buildViewState({
    targetKey: ctx.targetKey,
    targetDir: ctx.targetDir,
    baselineRunId: baseline,
    latestRunId: ctx.runId,
    blocked,
    lastN,
  });
  if (!writeViewState(ctx.viewDir, state)) return { ok: false, code: "LIBRARY_VIEWSTATE_WRITE_FAILED" };
  return { ok: true, viewState: state };
};

export const updateLibraryViewForTargetV0 = (options: {
  targetKey: string;
  setBaselineToLatest?: boolean;
  setBlockedFromLatest?: boolean;
  blockedReasonCodes?: string[];
}): { ok: boolean; code?: string; viewState?: LibraryViewStateV0 } => {
  const root = resolveLibraryRootV0().root;
  const targetDir = path.join(root, options.targetKey);
  const viewDir = path.join(targetDir, "view");
  if (!fs.existsSync(targetDir)) return { ok: false, code: "LIBRARY_TARGET_MISSING" };

  const runIds = listRunDirs(targetDir);
  if (runIds.length === 0) return { ok: false, code: "LIBRARY_RUNS_MISSING" };

  const baselinePath = path.join(viewDir, "baseline.txt");
  const latestPath = path.join(viewDir, "latest.txt");
  const blockedPath = path.join(viewDir, "blocked.txt");
  const viewStatePath = path.join(viewDir, "view_state.json");

  const latest = readPointer(latestPath) ?? runIds[runIds.length - 1];
  if (options.setBaselineToLatest) {
    if (!writePointer(baselinePath, latest)) return { ok: false, code: "LIBRARY_BASELINE_WRITE_FAILED" };
    try {
      if (fs.existsSync(blockedPath)) fs.unlinkSync(blockedPath);
    } catch {
      return { ok: false, code: "LIBRARY_BLOCKED_CLEAR_FAILED" };
    }
  }

  if (options.setBlockedFromLatest) {
    const reasonCodes = stableSortUniqueStringsV0(options.blockedReasonCodes ?? ["OPERATOR_REJECT_BASELINE"]).slice(
      0,
      MAX_BLOCKED_REASONS
    );
    if (!writeBlocked(blockedPath, latest, reasonCodes)) return { ok: false, code: "LIBRARY_BLOCKED_WRITE_FAILED" };
  }

  const baseline = ensureBaseline(runIds, latest, readPointer(baselinePath));
  if (!writePointer(baselinePath, baseline)) return { ok: false, code: "LIBRARY_BASELINE_WRITE_FAILED" };
  if (!writePointer(latestPath, latest)) return { ok: false, code: "LIBRARY_LATEST_WRITE_FAILED" };

  const blocked = readBlocked(blockedPath);
  const prior = loadViewState(viewStatePath);
  let lastN = normalizeLastN(prior?.lastN ?? [], runIds);
  if (lastN.length === 0) lastN = runIds.slice();
  lastN = trimLastN(lastN, MAX_HISTORY);

  const state = buildViewState({
    targetKey: options.targetKey,
    targetDir,
    baselineRunId: baseline,
    latestRunId: latest,
    blocked,
    lastN,
  });
  if (!writeViewState(viewDir, state)) return { ok: false, code: "LIBRARY_VIEWSTATE_WRITE_FAILED" };
  return { ok: true, viewState: state };
};
