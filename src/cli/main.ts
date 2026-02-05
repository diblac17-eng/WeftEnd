// src/cli/main.ts
// Minimal CLI entrypoint for WeftEnd v1 examine flow.

declare const process: any;
declare const require: any;
declare const module: any;

import { runExamine } from "./examine";
import { runWeftendRun } from "./run";
import { runSafeRun } from "./safe_run";
import { runCompareCliV0 } from "./compare";
import { runLibraryCli } from "./library";
import { runTicketPackCli } from "./ticket_pack";
import { runLicenseCli } from "./license";
import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftEndPolicyV1 } from "../core/intake_policy_v1";
import { validateMintPackageV1, validateWeftEndPolicyV1 } from "../core/validate";
import { examineArtifactV1 } from "../runtime/examiner/examine";
import { buildIntakeDecisionV1 } from "../runtime/examiner/intake_decision_v1";
import type { MintProfileV1 } from "../core/types";
import { inspectReleaseFolder } from "./inspect";
import { runHostMain } from "../runtime/host/host_main";
import { openExternalV0 } from "../runtime/open_external";

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend examine <input> --out <dir> [--profile web|mod|generic] [--script <file>] [--emit-capture]");
  console.log("  weftend intake <input> --policy <policy.json> --out <dir> [--profile web|mod|generic] [--script <file>]");
  console.log("  weftend run <input> --policy <policy.json> --out <dir> [--profile web|mod|generic] [--mode strict|compatible|legacy] [--script <file>]");
  console.log("  weftend safe-run <input> [--policy <policy.json>] --out <dir> [--profile web|mod|generic] [--script <file>] [--execute] [--withhold-exec|--no-exec]");
  console.log("  weftend compare <leftOutRoot> <rightOutRoot> --out <dir>");
  console.log("  weftend ticket-pack <outRoot> --out <dir> [--zip]");
  console.log("  weftend license issue --key <private.pem> --out <license.json> --customer <id> --tier community|enterprise --features a,b --issued YYYY-MM-DD --key-id <id> [--expires YYYY-MM-DD] [--license-id <id>]");
  console.log("  weftend license verify --license <license.json> --pub <public.pem>");
  console.log("  weftend library [--latest] [--target <key>]");
  console.log("  weftend library open <key> [--latest]");
  console.log("  weftend library accept-baseline <key>");
  console.log("  weftend library reject-baseline <key>");
  console.log("  weftend inspect <releaseDir> --portal");
  console.log("  weftend host run <releaseDir> --out <dir> [--entry <block>]");
  console.log("Note: host commands require --out or WEFTEND_HOST_OUT_ROOT.");
  console.log("Note: browser builds cannot execute. Use weftend host run for strict execution.");
};

const parseArgs = (argv: string[]) => {
  const args = [...argv];
  const command = args.shift();
  const out: Record<string, string | boolean> = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      out["help"] = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (key === "emit-capture" || key === "execute" || key === "withhold-exec" || key === "no-exec" || key === "zip") {
        out[key] = true;
        continue;
      }
      const value = args.shift();
      if (!value) {
        out[key] = "";
        continue;
      }
      out[key] = value;
      continue;
    }
    rest.push(token);
  }
  return { command, flags: out, rest };
};

const resolveIntakeProfile = (profileFlag: string, policyProfile: string) => {
  const requested = profileFlag || policyProfile;
  if (requested === "web" || requested === "mod" || requested === "generic") {
    return { ok: true as const, profile: requested as MintProfileV1 };
  }
  return { ok: false as const, profile: "" };
};

const getErrCode = (err: unknown): string | undefined => {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const parseInspectArgs = (argv: string[]) => {
  const args = [...argv];
  let portal = false;
  let help = false;
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--portal") {
      portal = true;
      continue;
    }
    return { ok: false as const, help };
  }
  return { ok: true as const, portal, help };
};

const runExamineCli = (args: string[]) => {
  const { command, flags, rest } = parseArgs(args);
  if (flags["help"] || command !== "examine") {
    printUsage();
    return 1;
  }
  const inputPath = rest[0];
  if (!inputPath) {
    printUsage();
    return 1;
  }
  const outDir = (flags["out"] as string) || "";
  if (!outDir) {
    console.error("[INPUT_INVALID] --out <dir> is required.");
    return 1;
  }
  const profile = (flags["profile"] as string) || "generic";
  const scriptPath = (flags["script"] as string) || undefined;
  const emitCapture = Boolean(flags["emit-capture"]);
  const exitCode = runExamine(inputPath, {
    profile: profile === "web" || profile === "mod" ? profile : "generic",
    outDir,
    scriptPath,
    emitCapture,
  });
  return exitCode;
};

const readTextFile = (filePath: string): string => {
  const fs = require("fs");
  return fs.readFileSync(filePath, "utf8");
};

const runIntakeCli = (args: string[]): number => {
  const { command, flags, rest } = parseArgs(args);
  if (flags["help"] || command !== "intake") {
    printUsage();
    return 1;
  }
  const inputPath = rest[0];
  if (!inputPath) {
    printUsage();
    return 1;
  }
  const policyPath = (flags["policy"] as string) || "";
  const outDir = (flags["out"] as string) || "";
  if (!outDir) {
    console.error("[INPUT_INVALID] --out <dir> is required.");
    return 1;
  }
  const fs = require("fs");
  const path = require("path");
  let policyRaw: unknown;
  try {
    policyRaw = JSON.parse(readTextFile(policyPath));
  } catch {
    console.error("[POLICY_INVALID] policy must be valid JSON.");
    return 40;
  }
  const policyIssues = validateWeftEndPolicyV1(policyRaw, "policy");
  if (policyIssues.length > 0) {
    console.error("[POLICY_INVALID]");
    policyIssues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return 40;
  }
  const policy = canonicalizeWeftEndPolicyV1(policyRaw as any);
  const profileFlag = (flags["profile"] as string) || "";
  const resolvedProfile = resolveIntakeProfile(profileFlag, policy.profile);
  if (!resolvedProfile.ok) {
    console.error("[PROFILE_UNSUPPORTED] intake supports profile web|mod|generic.");
    return 40;
  }
  const profile = resolvedProfile.profile;
  const scriptPath = (flags["script"] as string) || undefined;
  let scriptText: string | undefined;
  if (scriptPath) {
    try {
      scriptText = readTextFile(scriptPath);
    } catch {
      console.error("[SCRIPT_INVALID] unable to read script file.");
      return 40;
    }
  }

  try {
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (err) {
    const code = getErrCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") {
      console.error("[INPUT_MISSING] input path not found.");
      return 40;
    }
    if (code === "EACCES" || code === "EPERM") {
      console.error("[INPUT_UNREADABLE] input path is not readable.");
      return 40;
    }
    console.error("[INTERNAL_ERROR] unexpected input access failure.");
    return 1;
  }

  let mint;
  try {
    mint = examineArtifactV1(inputPath, { profile, scriptText }).mint;
  } catch (err) {
    const code = getErrCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") {
      console.error("[INPUT_MISSING] input path not found.");
      return 40;
    }
    if (code === "EACCES" || code === "EPERM") {
      console.error("[INPUT_UNREADABLE] input path is not readable.");
      return 40;
    }
    console.error("[INTERNAL_ERROR] unexpected input read failure.");
    return 1;
  }
  const mintIssues = validateMintPackageV1(mint, "mint");
  if (mintIssues.length > 0) {
    console.error("[MINT_INVALID]");
    mintIssues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return 40;
  }

  const output = buildIntakeDecisionV1(mint, policy, { scriptText });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "intake_decision.json"), `${canonicalJSON(output.decision)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "disclosure.txt"), `${output.disclosure}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "appeal_bundle.json"), `${canonicalJSON(output.appeal)}\n`, "utf8");

  switch (output.decision.action) {
    case "APPROVE":
      return 0;
    case "QUEUE":
      return 10;
    case "REJECT":
      return 20;
    case "HOLD":
      return 30;
    default:
      return 40;
  }
};

const runRunCli = async (args: string[]): Promise<number> => {
  const { command, flags, rest } = parseArgs(args);
  if (flags["help"] || command !== "run") {
    printUsage();
    return 1;
  }
  const inputPath = rest[0];
  if (!inputPath) {
    printUsage();
    return 1;
  }
  const policyPath = (flags["policy"] as string) || "";
  const outDir = (flags["out"] as string) || "";
  if (!outDir) {
    console.error("[INPUT_INVALID] --out <dir> is required.");
    return 1;
  }
  const mode = ((flags["mode"] as string) || "strict") as string;
  if (mode !== "strict" && mode !== "compatible" && mode !== "legacy") {
    console.error("[MODE_UNSUPPORTED] run supports mode strict|compatible|legacy.");
    return 40;
  }
  const profileFlag = (flags["profile"] as string) || "";
  let policyProfile = "generic";
  try {
    const policyRaw = JSON.parse(readTextFile(policyPath));
    policyProfile = String((policyRaw as any)?.profile ?? "generic");
  } catch {
    // runWeftendRun will report policy invalid.
  }
  const resolvedProfile = resolveIntakeProfile(profileFlag, policyProfile);
  if (!resolvedProfile.ok) {
    console.error("[PROFILE_UNSUPPORTED] run supports profile web|mod|generic.");
    return 40;
  }

  const fs = require("fs");
  try {
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (err) {
    const code = getErrCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") {
      console.error("[INPUT_MISSING] input path not found.");
      return 40;
    }
    if (code === "EACCES" || code === "EPERM") {
      console.error("[INPUT_UNREADABLE] input path is not readable.");
      return 40;
    }
    console.error("[INTERNAL_ERROR] unexpected input access failure.");
    return 1;
  }

  return runWeftendRun({
    inputPath,
    outDir,
    policyPath,
    profile: resolvedProfile.profile,
    mode: mode as any,
    scriptPath: (flags["script"] as string) || undefined,
  });
};

const runSafeRunCli = async (args: string[]): Promise<number> => {
  const { command, flags, rest } = parseArgs(args);
  if (flags["help"] || command !== "safe-run") {
    printUsage();
    return 1;
  }
  const inputPath = rest[0];
  if (!inputPath) {
    printUsage();
    return 1;
  }
  const policyPath = (flags["policy"] as string) || "";
  const outDir = (flags["out"] as string) || "";
  if (!outDir) {
    console.error("[INPUT_INVALID] --out <dir> is required.");
    return 1;
  }
  const profileFlag = (flags["profile"] as string) || "";
  let policyProfile = "generic";
  try {
    const policyRaw = JSON.parse(readTextFile(policyPath));
    policyProfile = String((policyRaw as any)?.profile ?? "generic");
  } catch {
    // runSafeRun will report policy invalid.
  }
  const resolvedProfile = resolveIntakeProfile(profileFlag, policyProfile);
  if (!resolvedProfile.ok) {
    console.error("[PROFILE_UNSUPPORTED] safe-run supports profile web|mod|generic.");
    return 40;
  }

  return runSafeRun({
    inputPath,
    outDir,
    policyPath: policyPath || undefined,
    profile: resolvedProfile.profile,
    mode: "strict",
    scriptPath: (flags["script"] as string) || undefined,
    executeRequested: Boolean(flags["execute"]),
    withholdExec: Boolean(flags["withhold-exec"] || flags["no-exec"]),
  });
};

const runCompareCli = (args: string[]): number => {
  const { command, flags, rest } = parseArgs(args);
  if (flags["help"] || command !== "compare") {
    printUsage();
    return 1;
  }
  const leftRoot = rest[0];
  const rightRoot = rest[1];
  const outRoot = (flags["out"] as string) || "";
  if (!leftRoot || !rightRoot) {
    printUsage();
    return 1;
  }
  if (!outRoot) {
    console.error("[OUT_REQUIRED] compare requires --out <dir>.");
    return 40;
  }
  return runCompareCliV0({ leftRoot, rightRoot, outRoot });
};

const runTicketPack = (args: string[]): number => {
  const { command, flags, rest } = parseArgs(args);
  if (flags["help"] || command !== "ticket-pack") {
    printUsage();
    return 1;
  }
  const outRoot = rest[0];
  const outDir = (flags["out"] as string) || "";
  if (!outRoot) {
    printUsage();
    return 1;
  }
  if (!outDir) {
    console.error("[OUT_REQUIRED] ticket-pack requires --out <dir>.");
    return 40;
  }
  return runTicketPackCli({ outRoot, outDir, zipRequested: Boolean(flags["zip"]) });
};

const runInspectPortal = (releaseDir: string): number => {
  const releasePortal = require("../runtime/release/release_portal");
  const buildPortalModelFromReleaseFolder = releasePortal?.buildPortalModelFromReleaseFolder;
  if (typeof buildPortalModelFromReleaseFolder !== "function") {
    console.error("[INSPECT_UNAVAILABLE] release_portal module missing.");
    return 1;
  }
  const result = buildPortalModelFromReleaseFolder(releaseDir);
  if (!result || !result.ok) {
    const issues = result?.error;
    if (Array.isArray(issues)) {
      issues.forEach((issue: { code?: string; message?: string }) => {
        const code = issue?.code ? String(issue.code) : "INSPECT_FAILED";
        const msg = issue?.message ? String(issue.message) : "inspect failed";
        console.error(`[${code}] ${msg}`);
      });
    } else {
      console.error("[INSPECT_FAILED] release portal build failed.");
    }
    return 1;
  }
  console.log(canonicalJSON(result.value));
  return 0;
};

const runInspectCli = (args: string[]): number => {
  const releaseDir = args[0];
  if (!releaseDir) {
    printUsage();
    return 1;
  }
  const parse = parseInspectArgs(args.slice(1));
  if (!parse.ok || parse.help) {
    printUsage();
    return 1;
  }
  if (parse.portal) {
    return runInspectPortal(releaseDir);
  }

  const res = inspectReleaseFolder(releaseDir);
  if (!res.ok) {
    res.error.forEach((issue) => {
      const msg = issue?.message ? String(issue.message) : "inspect failed";
      const code = issue?.code ? String(issue.code) : "INSPECT_FAILED";
      console.error(`[${code}] ${msg}`);
    });
    return 1;
  }
  console.log(canonicalJSON(res.value));
  return res.value.ok ? 0 : 2;
};

export interface CliPorts {
  openExternal: (target: string) => { ok: true } | { ok: false; error: Array<{ code: string; message: string }> };
}

export const runCli = async (args: string[], _ports: CliPorts): Promise<number> => {
  if (args.length === 0) {
    printUsage();
    return 1;
  }
  if (args[0] === "host") {
    return await runHostMain(args.slice(1));
  }
  if (args[0] === "inspect") {
    return runInspectCli(args.slice(1));
  }
  if (args[0] === "safe-run") {
    return await runSafeRunCli(args);
  }
  if (args[0] === "compare") {
    return runCompareCli(args);
  }
  if (args[0] === "ticket-pack") {
    return runTicketPack(args);
  }
  if (args[0] === "license") {
    return runLicenseCli(args.slice(1));
  }
  if (args[0] === "library") {
    return runLibraryCli(args.slice(1), _ports);
  }
  if (args[0] === "run") {
    return await runRunCli(args);
  }
  if (args[0] === "intake") {
    return runIntakeCli(args);
  }
  return runExamineCli(args);
};

export const main = async (argv: string[]) => runCli(argv.slice(2), { openExternal: openExternalV0 });

if (require.main === module) {
  main(process.argv)
    .then((exitCode) => process.exit(exitCode))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
