// src/runtime/host/host_main.ts
// CLI entry for Node host run (deterministic, verify-first).

import { runHostStrictV0 } from "./host_runner";
import { getHostStatusV0, installHostUpdateV0 } from "./host_update";
import { emitHostStatusReceiptV0 } from "./host_status";
import { stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import { formatBuildDigestSummaryV0 } from "../weftend_build";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../operator_receipt";
import type { ContentSummaryV0 } from "../../core/types";
import { runPrivacyLintV0 } from "../privacy_lint";

declare const require: any;

const path = require("path");

declare const process: any;

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend host run <releaseDir> --out <dir> [--entry <block>]");
  console.log("  weftend host status --root <dir> --trust-root <file>");
  console.log("  weftend host install <releaseDir> --root <dir> --trust-root <file> [--out <dir>] [--signing-secret <secret>]");
  console.log("Note: --out or WEFTEND_HOST_OUT_ROOT is required for all host commands.");
  console.log("Note: host run executes only after verification gates pass.");
};

const toRelPath = (root: string, targetPath: string): string => {
  const rel = path.relative(path.resolve(root), path.resolve(targetPath));
  return rel.split(path.sep).join("/");
};

const parseArgs = (argv: string[]) => {
  const args = [...argv];
  const command = args.shift();
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      flags["help"] = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = args.shift();
      flags[key] = value ?? "";
      continue;
    }
    rest.push(token);
  }
  return { command, flags, rest };
};

export const runHostMain = async (argv: string[]): Promise<number> => {
  const hostRootEnv = process?.env?.WEFTEND_HOST_ROOT || "";
  const trustRootEnv = process?.env?.WEFTEND_HOST_TRUST_ROOT || "";
  const hostOutRootEnv = process?.env?.WEFTEND_HOST_OUT_ROOT || "";
  const scanFlag = (args: string[], flag: string): string => {
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === flag && typeof args[i + 1] === "string") return String(args[i + 1]);
    }
    return "";
  };
  const outArg = scanFlag(argv, "--out");
  const outRoot = outArg || hostOutRootEnv || "";
  const outRootSource = outArg ? "ARG_OUT" : hostOutRootEnv ? "ENV_OUT_ROOT" : "";
  if (!outRoot) {
    console.error("[HOST_OUT_MISSING] --out or WEFTEND_HOST_OUT_ROOT is required.");
    return 40;
  }
  const hostRootPre = scanFlag(argv, "--root") || hostRootEnv;
  const trustRootPre = scanFlag(argv, "--trust-root") || trustRootEnv;
  const statusReceipt = emitHostStatusReceiptV0({
    hostRoot: hostRootPre,
    trustRootPath: trustRootPre,
    hostOutRoot: outRoot,
    outRootSource: outRootSource as "ARG_OUT" | "ENV_OUT_ROOT",
    outRootEffective: outRoot,
  });
  const startupBuildSummary = formatBuildDigestSummaryV0(statusReceipt.receipt.weftendBuild);

  const { command, flags, rest } = parseArgs(argv);
  const requiresVerified = command === "run" || command === "install" || command === "update";
  const writeOperator = (
    cmd: "host status" | "host run" | "host update",
    extra: Array<{ kind: string; relPath: string; digest: string }>,
    warnings: string[],
    contentSummary?: ContentSummaryV0
  ) => {
    const entries = [
      {
        kind: "host_status",
        relPath: toRelPath(outRoot, statusReceipt.receiptPath),
        digest: statusReceipt.receipt.receiptDigest,
      },
      ...extra,
    ];
    const operatorReceipt = buildOperatorReceiptV0({
      command: cmd,
      weftendBuild: statusReceipt.receipt.weftendBuild,
      schemaVersion: statusReceipt.receipt.schemaVersion,
      entries,
      warnings,
      ...(contentSummary ? { contentSummary } : {}),
    });
    writeOperatorReceiptV0(outRoot, operatorReceipt);
  };
  if (requiresVerified && !statusReceipt.ok) {
    const reasons = stableSortUniqueReasonsV0([
      "HOST_STARTUP_UNVERIFIED",
      ...(statusReceipt.receipt.reasonCodes ?? []),
    ]);
    console.error(`[HOST_STATUS_UNVERIFIED] host status is not OK; refusing update/run. ${reasons.join(",")}`);
    if (command === "run" || command === "install" || command === "update") {
      const cmd = command === "run" ? "host run" : "host update";
      writeOperator(cmd, [], [...(statusReceipt.receipt.weftendBuild.reasonCodes ?? []), ...reasons]);
    }
    return 40;
  }
  if (flags["help"]) {
    printUsage();
    return 1;
  }

  if (command === "status") {
    const hostRoot = (flags["root"] as string) || process?.env?.WEFTEND_HOST_ROOT || "";
    const trustRoot = (flags["trust-root"] as string) || process?.env?.WEFTEND_HOST_TRUST_ROOT || "";
    if (!hostRoot || !trustRoot) {
      console.error("[INPUT_INVALID] --root and --trust-root are required.");
      return 40;
    }
    const status = getHostStatusV0(hostRoot, trustRoot);
    writeOperator("host status", [], [...(statusReceipt.receipt.weftendBuild.reasonCodes ?? []), ...(status.reasonCodes ?? [])]);
    const privacy = runPrivacyLintV0({ root: outRoot, weftendBuild: statusReceipt.receipt.weftendBuild });
    const privacySummary = `privacyLint=${privacy.report.verdict}`;
    console.error(`HOST_STATUS ${status.status} ${startupBuildSummary} ${privacySummary}`);
    console.log(JSON.stringify(status));
    return status.status === "OK" ? 0 : 40;
  }

  if (command === "install" || command === "update") {
    const releaseDir = rest[0];
    if (!releaseDir) {
      printUsage();
      return 1;
    }
    const hostRoot = (flags["root"] as string) || process?.env?.WEFTEND_HOST_ROOT || "";
    const trustRoot = (flags["trust-root"] as string) || process?.env?.WEFTEND_HOST_TRUST_ROOT || "";
    const outDir = (flags["out"] as string) || outRoot;
    const signingSecret = (flags["signing-secret"] as string) || process?.env?.WEFTEND_HOST_SIGNING_SECRET || "";
    if (!hostRoot || !trustRoot) {
      console.error("[INPUT_INVALID] --root and --trust-root are required.");
      return 40;
    }
    try {
      const result = installHostUpdateV0({
        releaseDir,
        hostRoot,
        trustRootPath: trustRoot,
        signingSecret: signingSecret || undefined,
        outDir: outDir || undefined,
      });
      writeOperator(
        "host update",
        [
          {
            kind: "host_update_receipt",
            relPath: toRelPath(outRoot, path.join(outDir, "host_update_receipt.json")),
            digest: result.receipt.receiptDigest,
          },
        ],
        [
          ...(statusReceipt.receipt.weftendBuild.reasonCodes ?? []),
          ...(result.receipt.reasonCodes ?? []),
          ...(result.receipt.verify.reasonCodes ?? []),
        ]
      );
      const buildSummary = formatBuildDigestSummaryV0(result.receipt.weftendBuild);
      const privacy = runPrivacyLintV0({ root: outRoot, weftendBuild: result.receipt.weftendBuild });
      const privacySummary = `privacyLint=${privacy.report.verdict}`;
      const summary = `HOST_UPDATE ${result.receipt.decision} apply=${result.receipt.apply.result} ${buildSummary} ${privacySummary}`;
      console.log(summary);
      return result.exitCode;
    } catch {
      console.error("[HOST_UPDATE_FAILED] unexpected host update failure.");
      return 1;
    }
  }

  if (command !== "run") {
    printUsage();
    return 1;
  }

  const releaseDir = rest[0];
  if (!releaseDir) {
    printUsage();
    return 1;
  }
  const outDir = (flags["out"] as string) || "";
  if (!outDir) {
    console.error("[INPUT_INVALID] --out <dir> is required.");
    return 1;
  }
  const entry = (flags["entry"] as string) || undefined;
  const hostRoot = (flags["root"] as string) || process?.env?.WEFTEND_HOST_ROOT || undefined;
  const trustRoot = (flags["trust-root"] as string) || process?.env?.WEFTEND_HOST_TRUST_ROOT || undefined;

  try {
    const result = await runHostStrictV0({ releaseDir, outDir, entry, hostRoot, trustRootPath: trustRoot });
    writeOperator(
      "host run",
      [
        {
          kind: "host_run_receipt",
          relPath: toRelPath(outRoot, path.join(outDir, "host_run_receipt.json")),
          digest: result.receipt.receiptDigest,
        },
      ],
      [
        ...(statusReceipt.receipt.weftendBuild.reasonCodes ?? []),
        ...(result.receipt.execute.reasonCodes ?? []),
        ...(result.receipt.verify.reasonCodes ?? []),
      ],
      result.receipt.contentSummary
    );
    const buildSummary = formatBuildDigestSummaryV0(result.receipt.weftendBuild);
    const privacy = runPrivacyLintV0({ root: outRoot, weftendBuild: result.receipt.weftendBuild });
    const privacySummary = `privacyLint=${privacy.report.verdict}`;
    const summary = `HOST_RUN ${result.receipt.execute.result} releaseStatus=${result.receipt.releaseStatus} entry=${result.receipt.entryUsed || "none"} ${buildSummary} ${privacySummary}`;
    console.log(summary);
    return result.exitCode;
  } catch {
    console.error("[HOST_RUN_FAILED] unexpected host failure.");
    return 1;
  }
};
