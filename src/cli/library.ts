/* src/cli/library.ts */
// CLI: open local WeftEnd library root.

import { cmpStrV0 } from "../core/order";
import { resolveLibraryRootV0 } from "../runtime/library_root";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { updateLibraryViewForTargetV0 } from "./library_state";
import type { CliPorts } from "./main";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type LibraryArgs = {
  latest: boolean;
  targetKey?: string;
  help?: boolean;
  invalid?: boolean;
};

const parseLibraryArgs = (argv: string[]): LibraryArgs => {
  const args = [...argv];
  const out: LibraryArgs = { latest: false };
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (token === "--latest") {
      out.latest = true;
      continue;
    }
    if (token === "--target") {
      const value = args.shift();
      if (!value) {
        out.invalid = true;
        continue;
      }
      out.targetKey = value;
      continue;
    }
    out.invalid = true;
  }
  return out;
};

const isValidTargetKey = (value: string): boolean => {
  if (!value) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  return value.trim().length > 0;
};

const listRunDirs = (dir: string): Array<{ path: string; name: string; mtimeMs: number }> => {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }) as any;
  } catch {
    return [];
  }
  const runs: Array<{ path: string; name: string; mtimeMs: number }> = [];
  entries
    .filter((entry) => entry.isDirectory && entry.isDirectory())
    .forEach((entry) => {
      const name = String(entry.name);
      if (!name.startsWith("run_")) return;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        runs.push({ path: full, name, mtimeMs: stat.mtimeMs || 0 });
      } catch {
        // ignore
      }
    });
  return runs;
};

const pickLatestRun = (runs: Array<{ path: string; name: string; mtimeMs: number }>): string | null => {
  if (runs.length === 0) return null;
  runs.sort((a, b) => {
    const t = b.mtimeMs - a.mtimeMs;
    if (t !== 0) return t;
    return cmpStrV0(a.name, b.name);
  });
  return runs[0].path;
};

const printUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend library [--latest] [--target <key>]");
  console.log("  weftend library open <key> [--latest]");
  console.log("  weftend library accept-baseline <key>");
  console.log("  weftend library reject-baseline <key>");
};

const runLibraryOpen = (argv: string[], ports: CliPorts): number => {
  const build = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  const resolved = resolveLibraryRootV0();
  const root = resolved.root;
  const parsed = parseLibraryArgs(argv);

  if (parsed.help) {
    printUsage();
    return 0;
  }
  if (parsed.invalid) {
    console.error("[INPUT_INVALID] library supports --latest and --target <key>.");
    return 40;
  }

  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    console.error("[LIBRARY_ROOT_INVALID] unable to create library root.");
    return 40;
  }

  let targetToOpen = root;
  if (parsed.latest) {
    if (parsed.targetKey && !isValidTargetKey(parsed.targetKey)) {
      console.error("[TARGET_KEY_INVALID] invalid target key.");
      return 40;
    }
    let runPath: string | null = null;
    if (parsed.targetKey) {
      const targetDir = path.join(root, parsed.targetKey);
      if (!fs.existsSync(targetDir)) {
        console.error("[LIBRARY_TARGET_MISSING] target key not found.");
        return 40;
      }
      runPath = pickLatestRun(listRunDirs(targetDir));
    } else {
      let targets: Array<{ name: string; path: string }> = [];
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true }) as any;
        targets = entries
          .filter((entry: any) => entry.isDirectory && entry.isDirectory())
          .map((entry: any) => ({ name: String(entry.name), path: path.join(root, String(entry.name)) }));
      } catch {
        targets = [];
      }
      let allRuns: Array<{ path: string; name: string; mtimeMs: number }> = [];
      targets.forEach((t) => {
        allRuns = allRuns.concat(listRunDirs(t.path));
      });
      runPath = pickLatestRun(allRuns);
    }
    if (!runPath) {
      console.error("[LIBRARY_RUNS_MISSING] no runs found.");
      return 40;
    }
    targetToOpen = runPath;
  }

  const openRes = ports.openExternal(targetToOpen);
  if (!openRes.ok) {
    console.error("[OPEN_EXTERNAL_FAILED] unable to open library root.");
    return 40;
  }

  const privacy = runPrivacyLintV0({ root, weftendBuild: build, writeReport: false });
  const mode = parsed.latest ? "LATEST" : "ROOT";
  console.log(`LIBRARY OPEN mode=${mode} privacyLint=${privacy.report.verdict} ${formatBuildDigestSummaryV0(build)}`);
  return 0;
};

const runLibraryOpenTarget = (argv: string[], ports: CliPorts): number => {
  const build = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  const resolved = resolveLibraryRootV0();
  const root = resolved.root;
  const targetKey = argv[0];
  if (!targetKey || !isValidTargetKey(targetKey)) {
    console.error("[TARGET_KEY_INVALID] invalid target key.");
    return 40;
  }
  const parsed = parseLibraryArgs(argv.slice(1));
  if (parsed.invalid) {
    console.error("[INPUT_INVALID] library open supports --latest only.");
    return 40;
  }
  const targetDir = path.join(root, targetKey);
  if (!fs.existsSync(targetDir)) {
    console.error("[LIBRARY_TARGET_MISSING] target key not found.");
    return 40;
  }
  let targetToOpen = targetDir;
  if (parsed.latest) {
    const latest = pickLatestRun(listRunDirs(targetDir));
    if (!latest) {
      console.error("[LIBRARY_RUNS_MISSING] no runs found.");
      return 40;
    }
    targetToOpen = latest;
  }
  const openRes = ports.openExternal(targetToOpen);
  if (!openRes.ok) {
    console.error("[OPEN_EXTERNAL_FAILED] unable to open library target.");
    return 40;
  }
  const privacy = runPrivacyLintV0({ root, weftendBuild: build, writeReport: false });
  const mode = parsed.latest ? "LATEST" : "TARGET";
  console.log(`LIBRARY OPEN mode=${mode} privacyLint=${privacy.report.verdict} ${formatBuildDigestSummaryV0(build)}`);
  return 0;
};

const runLibraryAcceptBaseline = (targetKey: string): number => {
  if (!targetKey || !isValidTargetKey(targetKey)) {
    console.error("[TARGET_KEY_INVALID] invalid target key.");
    return 40;
  }
  const res = updateLibraryViewForTargetV0({ targetKey, setBaselineToLatest: true });
  if (!res.ok) {
    console.error(`[${res.code ?? "LIBRARY_UPDATE_FAILED"}] unable to accept baseline.`);
    return 40;
  }
  console.log("LIBRARY BASELINE_ACCEPTED");
  return 0;
};

const runLibraryRejectBaseline = (targetKey: string): number => {
  if (!targetKey || !isValidTargetKey(targetKey)) {
    console.error("[TARGET_KEY_INVALID] invalid target key.");
    return 40;
  }
  const res = updateLibraryViewForTargetV0({
    targetKey,
    setBlockedFromLatest: true,
    blockedReasonCodes: ["OPERATOR_REJECT_BASELINE"],
  });
  if (!res.ok) {
    console.error(`[${res.code ?? "LIBRARY_UPDATE_FAILED"}] unable to reject baseline.`);
    return 40;
  }
  console.log("LIBRARY BASELINE_REJECTED");
  return 0;
};

export const runLibraryCli = (argv: string[], ports: CliPorts): number => {
  if (argv.length > 0 && (argv[0] === "accept-baseline" || argv[0] === "reject-baseline" || argv[0] === "open")) {
    const cmd = argv[0];
    if (cmd === "open") return runLibraryOpenTarget(argv.slice(1), ports);
    if (cmd === "accept-baseline") return runLibraryAcceptBaseline(argv[1]);
    return runLibraryRejectBaseline(argv[1]);
  }
  return runLibraryOpen(argv, ports);
};
