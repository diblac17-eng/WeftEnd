// src/cli/launchpad.ts
// Launchpad: sync WeftEnd-run shortcuts from a targets folder (Windows only).

import { resolveLibraryRootV0 } from "../runtime/library_root";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

type LaunchpadArgs = {
  allowLaunch: boolean;
  intervalMs: number;
  openLibrary: boolean;
  help?: boolean;
  invalid?: boolean;
};

const DEFAULT_INTERVAL_MS = 10000;

const parseLaunchpadArgs = (argv: string[]): LaunchpadArgs => {
  const args = [...argv];
  const out: LaunchpadArgs = { allowLaunch: false, openLibrary: true, intervalMs: DEFAULT_INTERVAL_MS };
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (token === "--allow-launch") {
      out.allowLaunch = true;
      continue;
    }
    if (token === "--open-library") {
      out.openLibrary = true;
      continue;
    }
    if (token === "--open-run") {
      out.openLibrary = false;
      continue;
    }
    if (token === "--interval") {
      const value = args.shift();
      if (!value) {
        out.invalid = true;
        continue;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1000) {
        out.invalid = true;
        continue;
      }
      out.intervalMs = Math.floor(parsed);
      continue;
    }
    out.invalid = true;
  }
  return out;
};

const printUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend launchpad sync [--allow-launch] [--open-library|--open-run]");
  console.log("  weftend launchpad watch [--interval <ms>] [--allow-launch] [--open-library|--open-run]");
};

const ignoreNames = new Set<string>(["desktop.ini", "thumbs.db"]);

const sanitizeName = (value: string): string => {
  const raw = String(value || "target").toLowerCase();
  let clean = raw.replace(/[^a-z0-9._-]/g, "_");
  clean = clean.replace(/__+/g, "_").replace(/^[_\.\-]+/, "").replace(/[_\.\-]+$/, "");
  if (!clean) clean = "target";
  if (clean.length > 48) clean = clean.slice(0, 48);
  return clean;
};

const uniqueName = (base: string, used: Set<string>): string => {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  // Keep fallback deterministic (no timestamps) if the normal numeric range is exhausted.
  const fallback = `${base}_overflow_${used.size}`;
  used.add(fallback);
  return fallback;
};

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const createShortcut = (
  scriptPath: string,
  targetPath: string,
  shortcutPath: string,
  allowLaunch: boolean,
  openLibrary: boolean
): { ok: boolean; code?: string } => {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-TargetPath",
    targetPath,
    "-ShortcutPath",
    shortcutPath,
    "-UseTargetIcon",
    "-ResolveShortcut",
  ];
  if (allowLaunch) args.push("-AllowLaunch");
  if (openLibrary) args.push("-OpenLibrary");
  const result = spawnSync("powershell.exe", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.status === 0) {
    return { ok: true };
  }
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  const bracket = combined.match(/\[([A-Z0-9_]+)\]/);
  if (bracket && bracket[1]) {
    return { ok: false, code: bracket[1] };
  }
  const line = (combined.split(/\r?\n/).find((v) => v && v.trim().length > 0) || "").trim();
  const code = line.match(/^([A-Z0-9_]{3,})/)?.[1];
  return { ok: false, code: code || "SHORTCUT_CREATE_FAILED" };
};

const syncLaunchpad = (
  allowLaunch: boolean,
  openLibrary: boolean
): { ok: boolean; added: number; removed: number; failed: number; scanned: number } => {
  if (process.platform !== "win32") {
    console.error("[LAUNCHPAD_WINDOWS_ONLY]");
    return { ok: false, added: 0, removed: 0, failed: 0, scanned: 0 };
  }
  const root = resolveLibraryRootV0().root;
  const launchpadRoot = path.join(root, "Launchpad");
  const targetsDir = path.join(launchpadRoot, "Targets");
  const shortcutsDir = launchpadRoot;
  ensureDir(targetsDir);
  ensureDir(shortcutsDir);

  const scriptPath = path.join(process.cwd(), "tools", "windows", "shell", "weftend_make_shortcut.ps1");
  if (!fs.existsSync(scriptPath)) {
    console.error("[LAUNCHPAD_TOOL_MISSING]");
    return { ok: false, added: 0, removed: 0, failed: 0, scanned: 0 };
  }

  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = fs.readdirSync(targetsDir, { withFileTypes: true }) as any;
  } catch {
    console.error("[LAUNCHPAD_TARGETS_MISSING]");
    return { ok: false, added: 0, removed: 0, failed: 0, scanned: 0 };
  }

  const usedNames = new Set<string>();
  const desiredShortcuts = new Set<string>();
  let added = 0;
  let removed = 0;
  let failed = 0;
  let scanned = 0;
  const failedCodes = new Map<string, number>();

  entries.forEach((entry) => {
    if (!entry || !entry.name) return;
    const name = String(entry.name);
    if (ignoreNames.has(name.toLowerCase())) return;
    const full = path.join(targetsDir, name);
    if (!(entry.isDirectory && entry.isDirectory()) && !(entry.isFile && entry.isFile())) return;
    scanned += 1;
    const base = sanitizeName(name);
    const unique = uniqueName(base, usedNames);
    const shortcutName = `${unique} (WeftEnd).lnk`;
    const shortcutPath = path.join(shortcutsDir, shortcutName);
    const existed = fs.existsSync(shortcutPath);
    const created = createShortcut(scriptPath, full, shortcutPath, allowLaunch, openLibrary);
    if (created.ok) {
      if (!existed) added += 1;
      desiredShortcuts.add(shortcutPath);
    } else {
      failed += 1;
      const code = created.code || "SHORTCUT_CREATE_FAILED";
      failedCodes.set(code, (failedCodes.get(code) || 0) + 1);
    }
  });

  let existing: string[] = [];
  try {
    existing = fs
      .readdirSync(shortcutsDir)
      .filter((n: string) => n.toLowerCase().endsWith(".lnk"))
      .map((n: string) => path.join(shortcutsDir, n));
  } catch {
    existing = [];
  }

  // Only prune stale generated shortcuts if sync produced at least one desired shortcut.
  // This prevents silent wipe when shortcut generation fails due local environment issues.
  if (desiredShortcuts.size > 0) {
    existing.forEach((full) => {
      if (!desiredShortcuts.has(full) && full.toLowerCase().includes("(weftend).lnk")) {
        try {
          fs.unlinkSync(full);
          removed += 1;
        } catch {
          // ignore
        }
      }
    });
  }

  if (scanned > 0 && desiredShortcuts.size === 0) {
    const reasonSummary = Array.from(failedCodes.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, count]) => `${code}:${count}`)
      .join(",");
    console.error(`[LAUNCHPAD_SYNC_NO_SHORTCUTS] reasons=${reasonSummary || "UNKNOWN"}`);
    return { ok: false, added, removed, failed, scanned };
  }

  if (failed > 0) {
    const reasonSummary = Array.from(failedCodes.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, count]) => `${code}:${count}`)
      .join(",");
    console.error(`[LAUNCHPAD_TARGET_SHORTCUT_FAILURES] failed=${failed} reasons=${reasonSummary || "UNKNOWN"}`);
  }

  return { ok: true, added, removed, failed, scanned };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const runLaunchpadCli = async (argv: string[]): Promise<number> => {
  if (argv.length === 0) {
    printUsage();
    return 1;
  }
  const command = argv[0];
  const parsed = parseLaunchpadArgs(argv.slice(1));
  if (parsed.help) {
    printUsage();
    return 0;
  }
  if (parsed.invalid) {
    console.error("[INPUT_INVALID] launchpad supports --allow-launch, --interval, --open-library, --open-run.");
    return 40;
  }

  const build = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;

  if (command === "sync") {
    const result = syncLaunchpad(parsed.allowLaunch, parsed.openLibrary);
    if (!result.ok) return 40;
    const mode = parsed.allowLaunch ? "ALLOW_LAUNCH" : "ANALYZE_ONLY";
    const openMode = parsed.openLibrary ? "OPEN_LIBRARY" : "OPEN_RUN";
    console.log(
      `LAUNCHPAD sync mode=${mode} open=${openMode} scanned=${result.scanned} added=${result.added} removed=${result.removed} failed=${result.failed} ${formatBuildDigestSummaryV0(build)}`
    );
    return 0;
  }

  if (command === "watch") {
    const mode = parsed.allowLaunch ? "ALLOW_LAUNCH" : "ANALYZE_ONLY";
    const openMode = parsed.openLibrary ? "OPEN_LIBRARY" : "OPEN_RUN";
    console.log(
      `LAUNCHPAD watch mode=${mode} open=${openMode} intervalMs=${parsed.intervalMs} ${formatBuildDigestSummaryV0(build)}`
    );
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = syncLaunchpad(parsed.allowLaunch, parsed.openLibrary);
      if (!result.ok) return 40;
      // eslint-disable-next-line no-await-in-loop
      await sleep(parsed.intervalMs);
    }
  }

  printUsage();
  return 1;
};
