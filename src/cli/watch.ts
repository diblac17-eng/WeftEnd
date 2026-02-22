/* src/cli/watch.ts */
// Auto-scan watch daemon (Windows-only v0).

import { runSafeRun } from "./safe_run";
import { resolveLibraryRootV0 } from "../runtime/library_root";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { captureTreeV0 } from "../runtime/examiner/capture_tree_v0";
import { loadWeftendConfigV0 } from "../runtime/config_v0";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import { openExternalV0 } from "../runtime/open_external";
import { sanitizeLibraryTargetKeyV0 } from "../runtime/library_keys";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_CAPTURE_LIMITS = {
  maxFiles: 10000,
  maxTotalBytes: 256 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 256,
};

type WatchArgs = {
  target: string;
  policyPath?: string;
  outRoot?: string;
  debounceMs?: number;
  mode?: string;
  help?: boolean;
  invalid?: boolean;
};

const parseWatchArgs = (argv: string[]): WatchArgs => {
  const args = [...argv];
  const out: WatchArgs = { target: "" };
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (token === "--policy") {
      out.policyPath = args.shift() || "";
      continue;
    }
    if (token === "--out-root") {
      out.outRoot = args.shift() || "";
      continue;
    }
    if (token === "--debounce-ms") {
      const raw = args.shift();
      if (!raw) {
        out.invalid = true;
        continue;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        out.invalid = true;
        continue;
      }
      out.debounceMs = Math.floor(parsed);
      continue;
    }
    if (token === "--mode") {
      out.mode = args.shift() || "";
      continue;
    }
    if (!out.target) {
      out.target = token;
      continue;
    }
    out.invalid = true;
  }
  return out;
};

const printUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend watch <target> [--policy <path>] [--out-root <dir>] [--debounce-ms <n>] [--mode safe-run]");
};

const normalizeLibraryRoot = (base: string): string => {
  const trimmed = String(base || "").trim();
  if (!trimmed) return "";
  const leaf = path.basename(trimmed);
  if (leaf.toLowerCase() === "library") return trimmed;
  return path.join(trimmed, "Library");
};

const pathsOverlap = (aPath: string, bPath: string): boolean => {
  const a = path.resolve(process.cwd(), aPath || "");
  const b = path.resolve(process.cwd(), bPath || "");
  if (a === b) return true;
  const aPrefix = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  const bPrefix = b.endsWith(path.sep) ? b : `${b}${path.sep}`;
  return a.startsWith(bPrefix) || b.startsWith(aPrefix);
};

const resolvePowerShellExe = (): string => {
  if (process.platform !== "win32") return "powershell.exe";
  const windir = String(process.env?.WINDIR || "").trim();
  if (windir.length > 0) {
    const candidate = path.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
};


const isOpaqueNativeArtifact = (value: string): boolean => {
  const ext = path.extname(value || "").toLowerCase();
  return ext === ".exe" || ext === ".dll" || ext === ".msi" || ext === ".sys" || ext === ".drv";
};

const isShortcut = (value: string): boolean => path.extname(value || "").toLowerCase() === ".lnk";

const detectTargetKind = (value: string): string => {
  if (!value) return "missing";
  if (!fs.existsSync(value)) return "missing";
  const stat = fs.statSync(value);
  if (stat.isDirectory()) return "directory";
  if (isOpaqueNativeArtifact(value)) return "nativeBinary";
  if (isShortcut(value)) return "shortcut";
  return "file";
};

const buildRunId = (targetKind: string, targetNameOnly: string, repoRoot: string, policyPath?: string): string => {
  const repoRootDigest = computeArtifactDigestV0(String(repoRoot || "").trim().toLowerCase());
  const policyName = policyPath ? path.basename(policyPath) : "AUTO";
  const material = `${targetKind}|${targetNameOnly}|${repoRootDigest}|${policyName}|v0`;
  return `run_${computeArtifactDigestV0(material).replace("sha256:", "")}`;
};

const ensureUniqueRunDir = (base: string): string => {
  if (!fs.existsSync(base)) return base;
  for (let i = 1; i <= 999; i += 1) {
    const suffix = `_${String(i).padStart(3, "0")}`;
    const candidate = `${base}${suffix}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${base}_overflow`;
};

const computeFingerprint = (targetPath: string): string => {
  const capture = captureTreeV0(targetPath, DEFAULT_CAPTURE_LIMITS);
  return capture.rootDigest || "sha256:0000000000000000000000000000000000000000000000000000000000000000";
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

const writeWatchTrigger = (outDir: string, options: { debounceMs: number; watchMode: string; eventCount: number }): boolean => {
  const lines = [
    "trigger=WATCH",
    `debounceMs=${options.debounceMs}`,
    `watchMode=${options.watchMode}`,
    `eventCount=${Math.max(0, Math.min(options.eventCount, 9999))}`,
  ];
  return writeTextAtomic(path.join(outDir, "watch_trigger.txt"), `${lines.join("\n")}\n`);
};

const loadLatestVerdict = (
  outDir: string,
  libraryRoot: string
): { verdict: "SAME" | "CHANGED" | "UNKNOWN"; targetKey?: string } => {
  const root = path.resolve(libraryRoot);
  const rel = path.relative(root, path.resolve(outDir));
  const parts = rel.split(path.sep).filter((p: string) => p.length > 0);
  if (parts.length < 2) return { verdict: "UNKNOWN" };
  const targetKey = parts[0];
  const viewPath = path.join(root, targetKey, "view", "view_state.json");
  if (!fs.existsSync(viewPath)) return { verdict: "UNKNOWN", targetKey };
  try {
    const parsed = JSON.parse(fs.readFileSync(viewPath, "utf8"));
    const latest = parsed?.latestRunId;
    const lastN: string[] = Array.isArray(parsed?.lastN) ? parsed.lastN : [];
    const keys: any[] = Array.isArray(parsed?.keys) ? parsed.keys : [];
    const idx = lastN.indexOf(latest);
    if (idx >= 0 && keys[idx] && keys[idx].verdictVsBaseline) {
      const verdict = keys[idx].verdictVsBaseline === "CHANGED" ? "CHANGED" : "SAME";
      return { verdict, targetKey };
    }
  } catch {
    return { verdict: "UNKNOWN", targetKey };
  }
  return { verdict: "UNKNOWN", targetKey };
};

const showChangePopup = (targetKey: string, libraryRoot: string): void => {
  if (process.platform !== "win32") return;
  if (process.env.WEFTEND_WATCH_DISABLE_POPUP === "1") return;
  const msg = `WeftEnd detected changes vs baseline.` + "\n" + `Target: ${targetKey}`;
  const script = [
    "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null",
    `$res=[System.Windows.Forms.MessageBox]::Show('${msg.replace(/'/g, "''")}','WeftEnd',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning)`,
    "if ($res -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 }",
    "exit 1",
  ].join(";");
  const result = spawnSync(resolvePowerShellExe(), ["-NoProfile", "-Command", script], { stdio: "ignore" });
  if (result.status === 0) {
    openExternalV0(libraryRoot);
  }
};

export const runWatchCli = async (argv: string[]): Promise<number> => {
  const args = parseWatchArgs(argv);
  if (args.help || !argv.length) {
    printUsage();
    return 1;
  }
  if (args.invalid || !args.target) {
    console.error("[INPUT_INVALID] watch expects <target> and optional flags.");
    return 40;
  }
  if (args.mode && args.mode !== "safe-run") {
    console.error("[MODE_INVALID] watch only supports --mode safe-run.");
    return 40;
  }
  const inputPath = path.resolve(process.cwd(), args.target);
  if (!fs.existsSync(inputPath)) {
    console.error("[INPUT_MISSING] target does not exist.");
    return 40;
  }

  const config = loadWeftendConfigV0(process.cwd());
  if (!config.ok) {
    console.error("[CONFIG_INVALID] .weftend/config.json is invalid.");
    return 40;
  }

  if (!config.config.autoScan.enabled) {
    console.error("[CONFIG_AUTO_SCAN_DISABLED] autoScan.enabled=false.");
    return 40;
  }

  const debounceMs = args.debounceMs ?? config.config.autoScan.debounceMs;
  const pollIntervalOverride = process.env.WEFTEND_WATCH_POLL_INTERVAL_MS;
  const pollIntervalMs =
    pollIntervalOverride && Number.isFinite(Number(pollIntervalOverride))
      ? Math.floor(Number(pollIntervalOverride))
      : config.config.autoScan.pollIntervalMs;

  const outRoot =
    args.outRoot && args.outRoot.trim() ? normalizeLibraryRoot(args.outRoot) : resolveLibraryRootV0().root;
  if (pathsOverlap(inputPath, outRoot)) {
    console.error("[WATCH_OUT_ROOT_CONFLICTS_TARGET] --out-root must not equal or overlap the watch target.");
    return 40;
  }
  const targetKind = detectTargetKind(inputPath);
  const targetNameOnly = path.basename(inputPath);
  const targetKey = sanitizeLibraryTargetKeyV0(targetNameOnly);
  const targetDir = path.join(outRoot, targetKey);
  fs.mkdirSync(targetDir, { recursive: true });

  const build = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  console.log(`WATCH start targetKey=${targetKey} debounceMs=${debounceMs} ${formatBuildDigestSummaryV0(build)}`);

  const runOnce = process.env.WEFTEND_WATCH_EXIT_AFTER_ONE === "1";
  const disablePopup = process.env.WEFTEND_WATCH_DISABLE_POPUP === "1";
  const runSafe = async (eventCount: number, watchMode: string) => {
    const runId = buildRunId(targetKind, targetNameOnly, process.cwd(), args.policyPath);
    const outDir = ensureUniqueRunDir(path.join(targetDir, runId));
    const policyPath = args.policyPath && args.policyPath.trim() ? args.policyPath : undefined;
    let profile: "generic" | "web" | "mod" = "generic";
    if (policyPath && fs.existsSync(policyPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
        const parsed = String(raw?.profile ?? "generic");
        if (parsed === "web" || parsed === "mod" || parsed === "generic") profile = parsed;
      } catch {
        // ignore policy parse here; safe-run will report invalid policy.
      }
    }
    const status = await runSafeRun({
      inputPath,
      outDir,
      policyPath,
      profile,
      mode: "strict",
      executeRequested: false,
      withholdExec: true,
    });
    if (!writeWatchTrigger(outDir, { debounceMs, watchMode, eventCount })) {
      console.error("[WATCH_TRIGGER_WRITE_FAILED] unable to finalize watch trigger output.");
    }
    const verdict = loadLatestVerdict(outDir, outRoot);
    if (!disablePopup && verdict.verdict === "CHANGED") {
      showChangePopup(targetKey, outRoot);
    }
    if (runOnce) return { done: true, status };
    return { done: false, status };
  };

  let timer: any;
  let eventCount = 0;
  let inFlight = false;

  const scheduleRun = (watchMode: string) => {
    eventCount += 1;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (inFlight) return;
      inFlight = true;
      const count = eventCount;
      eventCount = 0;
      const res = await runSafe(count, watchMode);
      inFlight = false;
      if (res.done) process.exit(res.status);
    }, debounceMs);
  };

  const tryFsWatch = (): boolean => {
    try {
      const isDir = fs.statSync(inputPath).isDirectory();
      const watcher = fs.watch(inputPath, { recursive: isDir }, () => scheduleRun("FSWATCH"));
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          // ignore
        }
      });
      return true;
    } catch {
      return false;
    }
  };

  const forcePoll = process.env.WEFTEND_WATCH_FORCE_POLL === "1";
  if (!forcePoll && tryFsWatch()) {
    if (runOnce && process.env.WEFTEND_WATCH_TEST_TRIGGER === "1") {
      scheduleRun("FSWATCH");
    }
    // keep alive until process exit
    setInterval(() => undefined, 1 << 30);
    return new Promise<number>(() => undefined);
  }

  let lastFingerprint = computeFingerprint(inputPath);
  setInterval(async () => {
    const next = computeFingerprint(inputPath);
    if (next !== lastFingerprint) {
      lastFingerprint = next;
      if (!inFlight) {
        inFlight = true;
        const res = await runSafe(1, "POLL");
        inFlight = false;
        if (res.done) process.exit(res.status);
      }
    }
  }, pollIntervalMs);
  return new Promise<number>(() => undefined);
};
