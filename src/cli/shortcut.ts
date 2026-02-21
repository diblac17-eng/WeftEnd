// src/cli/shortcut.ts
// Windows-only shortcut creation for WeftEnd-run (analysis-first, optional launch).

import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";

declare const require: any;
declare const process: any;

const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");

type ShortcutArgs = {
  target?: string;
  out?: string;
  allowLaunch: boolean;
  help?: boolean;
  invalid?: boolean;
};

const parseShortcutArgs = (argv: string[]): ShortcutArgs => {
  const args = [...argv];
  const out: ShortcutArgs = { allowLaunch: false };
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
    if (token === "--target") {
      const value = args.shift();
      if (!value) {
        out.invalid = true;
        continue;
      }
      out.target = value;
      continue;
    }
    if (token === "--out") {
      const value = args.shift();
      if (!value) {
        out.invalid = true;
        continue;
      }
      out.out = value;
      continue;
    }
    out.invalid = true;
  }
  return out;
};

const printUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend shortcut create --target <path> [--out <shortcut.lnk>] [--allow-launch]");
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

const resolveDesktopShortcutPath = (targetPath: string): string => {
  const desktop = path.join(os.homedir(), "Desktop");
  const base = path.basename(targetPath || "WeftEnd Run");
  return path.join(desktop, `${base} (WeftEnd).lnk`);
};

export const runShortcutCli = (argv: string[]): number => {
  if (argv.length === 0 || argv[0] !== "create") {
    printUsage();
    return 1;
  }
  const parsed = parseShortcutArgs(argv.slice(1));
  if (parsed.help) {
    printUsage();
    return 0;
  }
  if (parsed.invalid) {
    console.error("[INPUT_INVALID] shortcut supports --target and --out.");
    return 40;
  }
  if (!parsed.target) {
    console.error("[TARGET_MISSING] --target <path> is required.");
    return 40;
  }
  if (process.platform !== "win32") {
    console.error("[SHORTCUT_WINDOWS_ONLY] shortcut creation is Windows-only.");
    return 40;
  }
  const scriptPath = path.join(process.cwd(), "tools", "windows", "shell", "weftend_make_shortcut.ps1");
  if (!fs.existsSync(scriptPath)) {
    console.error("[SHORTCUT_TOOL_MISSING] tools/windows/shell/weftend_make_shortcut.ps1 not found.");
    return 40;
  }

  const outPath = parsed.out && parsed.out.trim().length > 0 ? parsed.out : resolveDesktopShortcutPath(parsed.target);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-TargetPath",
    parsed.target,
    "-ShortcutPath",
    outPath,
  ];
  if (parsed.allowLaunch) args.push("-AllowLaunch");

  const result = spawnSync(resolvePowerShellExe(), args, { stdio: ["ignore", "pipe", "pipe"] });
  if (result.error && (result.error.code === "EPERM" || result.error.code === "EACCES")) {
    console.error("[SHORTCUT_POWERSHELL_BLOCKED]");
    return 40;
  }
  if (result.status !== 0) {
    console.error("[SHORTCUT_CREATE_FAILED]");
    return 40;
  }

  const build = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  const mode = parsed.allowLaunch ? "ALLOW_LAUNCH" : "ANALYZE_ONLY";
  console.log(`SHORTCUT CREATED mode=${mode} ${formatBuildDigestSummaryV0(build)}`);
  return 0;
};
