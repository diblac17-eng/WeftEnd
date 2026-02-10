/* src/runtime/config_v0.ts */
// Deterministic .weftend/config.json parsing (bounded, strict).

declare const require: any;

const fs = require("fs");
const path = require("path");

export type AutoScanConfigV0 = {
  enabled: boolean;
  debounceMs: number;
  pollIntervalMs: number;
};

export type GateModeConfigV0 = {
  hostRun: "off" | "enforced";
};

export type WeftendConfigV0 = {
  autoScan: AutoScanConfigV0;
  gateMode: GateModeConfigV0;
};

const DEFAULT_AUTO_SCAN: AutoScanConfigV0 = {
  enabled: true,
  debounceMs: 750,
  pollIntervalMs: 2000,
};

const DEFAULT_GATE_MODE: GateModeConfigV0 = {
  hostRun: "off",
};

const MAX_DEBOUNCE_MS = 10000;
const MIN_DEBOUNCE_MS = 100;
const MAX_POLL_MS = 30000;
const MIN_POLL_MS = 250;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeRoot = (root: string): string => path.resolve(root || ".");

const parseAutoScan = (raw: unknown, reasons: string[]): AutoScanConfigV0 => {
  if (raw === undefined) return { ...DEFAULT_AUTO_SCAN };
  if (!isPlainObject(raw)) {
    reasons.push("CONFIG_INVALID");
    return { ...DEFAULT_AUTO_SCAN };
  }
  const keys = Object.keys(raw).sort();
  const allowed = new Set<string>(["enabled", "debounceMs", "pollIntervalMs"]);
  if (keys.some((k) => !allowed.has(k))) reasons.push("CONFIG_INVALID");
  const enabled =
    typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_AUTO_SCAN.enabled;
  const debounceMs =
    typeof raw.debounceMs === "number" && Number.isFinite(raw.debounceMs)
      ? Math.floor(raw.debounceMs)
      : DEFAULT_AUTO_SCAN.debounceMs;
  const pollIntervalMs =
    typeof raw.pollIntervalMs === "number" && Number.isFinite(raw.pollIntervalMs)
      ? Math.floor(raw.pollIntervalMs)
      : DEFAULT_AUTO_SCAN.pollIntervalMs;
  if (debounceMs < MIN_DEBOUNCE_MS || debounceMs > MAX_DEBOUNCE_MS) reasons.push("CONFIG_INVALID");
  if (pollIntervalMs < MIN_POLL_MS || pollIntervalMs > MAX_POLL_MS) reasons.push("CONFIG_INVALID");
  return {
    enabled,
    debounceMs,
    pollIntervalMs,
  };
};

const parseGateMode = (raw: unknown, reasons: string[]): GateModeConfigV0 => {
  if (raw === undefined) return { ...DEFAULT_GATE_MODE };
  if (!isPlainObject(raw)) {
    reasons.push("CONFIG_INVALID");
    return { ...DEFAULT_GATE_MODE };
  }
  const keys = Object.keys(raw).sort();
  const allowed = new Set<string>(["hostRun"]);
  if (keys.some((k) => !allowed.has(k))) reasons.push("CONFIG_INVALID");
  const hostRun = raw.hostRun === "enforced" ? "enforced" : "off";
  if (raw.hostRun !== undefined && raw.hostRun !== "off" && raw.hostRun !== "enforced") {
    reasons.push("CONFIG_INVALID");
  }
  return { hostRun };
};

export const loadWeftendConfigV0 = (rootDir: string): {
  ok: boolean;
  config: WeftendConfigV0;
  exists: boolean;
  path: string;
  reasonCodes: string[];
} => {
  const root = normalizeRoot(rootDir);
  const filePath = path.join(root, ".weftend", "config.json");
  if (!fs.existsSync(filePath)) {
    return {
      ok: true,
      config: { autoScan: { ...DEFAULT_AUTO_SCAN }, gateMode: { ...DEFAULT_GATE_MODE } },
      exists: false,
      path: filePath,
      reasonCodes: [],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {
      ok: false,
      config: { autoScan: { ...DEFAULT_AUTO_SCAN }, gateMode: { ...DEFAULT_GATE_MODE } },
      exists: true,
      path: filePath,
      reasonCodes: ["CONFIG_INVALID"],
    };
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      config: { autoScan: { ...DEFAULT_AUTO_SCAN }, gateMode: { ...DEFAULT_GATE_MODE } },
      exists: true,
      path: filePath,
      reasonCodes: ["CONFIG_INVALID"],
    };
  }
  const keys = Object.keys(raw).sort();
  const allowed = new Set<string>(["autoScan", "gateMode"]);
  const reasons: string[] = [];
  if (keys.some((k) => !allowed.has(k))) reasons.push("CONFIG_INVALID");
  const autoScan = parseAutoScan((raw as any).autoScan, reasons);
  const gateMode = parseGateMode((raw as any).gateMode, reasons);
  const ok = reasons.length === 0;
  return {
    ok,
    config: { autoScan, gateMode },
    exists: true,
    path: filePath,
    reasonCodes: ok ? [] : ["CONFIG_INVALID"],
  };
};

