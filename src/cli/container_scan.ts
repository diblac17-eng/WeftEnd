/* src/cli/container_scan.ts */
// Container adapter v0: local Docker inspect -> deterministic safe-run receipts.

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "../core/intake_policy_v1";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { computeSafeRunReceiptDigestV0, validateSafeRunReceiptV0, validateWeftEndPolicyV1 } from "../core/validate";
import type { SafeRunReceiptV0, WeftEndPolicyV1 } from "../core/types";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../runtime/operator_receipt";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { writeReceiptReadmeV0 } from "../runtime/receipt_readme";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import {
  buildContainerAdapterEvidenceV0,
  probeDockerImageLocalV0,
  type DockerProbeSuccessV0,
} from "../runtime/container/docker_probe_v0";
import { updateLibraryViewFromRunV0 } from "./library_state";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const POLICY_GENERIC = path.join(process.cwd(), "policies", "generic_default.json");
const MAX_TOP_DOMAINS = 10;
const MAX_REASON_CODES = 64;

type ContainerFlags = Record<string, string | boolean>;

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend container scan <imageRefOrId> --out <dir> [--policy <policy.json>]");
};

const parseArgs = (argv: string[]): { rest: string[]; flags: ContainerFlags } => {
  const args = [...argv];
  const flags: ContainerFlags = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      flags.help = true;
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
  return { rest, flags };
};

const readPolicy = (policyPath: string): { ok: true; policy: WeftEndPolicyV1; policyId: string } | { ok: false; code: number } => {
  if (!fs.existsSync(policyPath)) {
    console.error("[POLICY_MISSING] policy file not found.");
    return { ok: false, code: 40 };
  }
  let policyRaw: unknown;
  try {
    policyRaw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch {
    console.error("[POLICY_INVALID] policy must be valid JSON.");
    return { ok: false, code: 40 };
  }
  const issues = validateWeftEndPolicyV1(policyRaw, "policy");
  if (issues.length > 0) {
    console.error("[POLICY_INVALID]");
    issues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return { ok: false, code: 40 };
  }
  const policy = canonicalizeWeftEndPolicyV1(policyRaw as any);
  const policyId = computeWeftEndPolicyIdV1(policy);
  return { ok: true, policy, policyId };
};

const buildSafeRunReceipt = (input: Omit<SafeRunReceiptV0, "receiptDigest">): SafeRunReceiptV0 => {
  const receipt: SafeRunReceiptV0 = {
    ...input,
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeSafeRunReceiptDigestV0(receipt);
  return receipt;
};

const digestText = (value: string): string => computeArtifactDigestV0(value ?? "");

const summarizeContainerScan = (receipt: SafeRunReceiptV0, privacyVerdict: "PASS" | "FAIL", inputRef: string): string => {
  const reason = receipt.topReasonCode && receipt.topReasonCode.length > 0 ? receipt.topReasonCode : "-";
  return `CONTAINER_SCAN ${receipt.analysisVerdict} inputRef=${inputRef} kind=${receipt.artifactKind} exec=${receipt.executionVerdict} reason=${reason} ${formatBuildDigestSummaryV0(receipt.weftendBuild)} privacyLint=${privacyVerdict}`;
};

const finalizeSuccess = (options: {
  outDir: string;
  inputRef: string;
  policyPath: string;
  policyId: string;
  probe: DockerProbeSuccessV0;
}): number => {
  const weftendBuild = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  fs.mkdirSync(options.outDir, { recursive: true });

  const selectedPolicy = path.basename(options.policyPath);
  const registryDomains = options.probe.registryDomain ? [options.probe.registryDomain] : [];
  const externalDomains = stableSortUniqueStringsV0(registryDomains).slice(0, MAX_TOP_DOMAINS);
  const entryHints = stableSortUniqueStringsV0(
    [
      "ENTRY_CONTAINER_IMAGE",
      options.probe.entrypointPresent ? "ENTRY_DOCKER_ENTRYPOINT_PRESENT" : "",
      options.probe.cmdPresent ? "ENTRY_DOCKER_CMD_PRESENT" : "",
    ].filter((v) => v.length > 0)
  );
  const boundednessMarkers = stableSortUniqueStringsV0(["BOUND_DOCKER_LOCAL_ONLY", "BOUND_DOCKER_INSPECT_ONLY", "BOUND_NO_NETWORK"]);

  const adapterEvidence = buildContainerAdapterEvidenceV0(options.probe);
  const topExtensions = options.probe.layerCount > 0 ? [{ ext: "layer", count: options.probe.layerCount }] : [];
  const totalFiles = options.probe.layerCount + 1;

  const contentSummary = {
    targetKind: "file" as const,
    artifactKind: "dataOnly" as const,
    fileCountsByKind: {
      html: 0,
      js: 0,
      css: 0,
      json: 1,
      wasm: 0,
      media: 0,
      binary: options.probe.layerCount,
      other: 0,
    },
    totalFiles,
    totalBytesBounded: options.probe.totalBytesBounded,
    sizeSummary: {
      totalBytesBounded: options.probe.totalBytesBounded,
      truncated: false,
    },
    topExtensions,
    hasNativeBinaries: false,
    hasScripts: false,
    hasHtml: false,
    externalRefs: {
      count: externalDomains.length,
      topDomains: externalDomains,
    },
    entryHints,
    boundednessMarkers,
    archiveDepthMax: 0,
    nestedArchiveCount: 0,
    manifestCount: 1,
    stringsIndicators: {
      urlLikeCount: 0,
      ipLikeCount: 0,
      powershellLikeCount: 0,
      cmdExecLikeCount: 0,
    },
    adapterSignals: adapterEvidence.adapterSignals,
    policyMatch: {
      selectedPolicy,
      reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_POLICY_APPLIED", "POLICY_AUTO_GENERIC"]).slice(0, MAX_REASON_CODES),
    },
    hashFamily: {
      sha256: options.probe.resolvedDigest,
    },
  };

  const reasonCodes = options.probe.reasonCodes;
  const adapterSummaryJson = `${canonicalJSON(adapterEvidence.summary)}\n`;
  const adapterFindingsJson = `${canonicalJSON(adapterEvidence.findings)}\n`;
  const subReceipts = [
    { name: "analysis/adapter_summary_v0.json", digest: digestText(adapterSummaryJson) },
    { name: "analysis/adapter_findings_v0.json", digest: digestText(adapterFindingsJson) },
  ];

  const receipt = buildSafeRunReceipt({
    schema: "weftend.safeRunReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild,
    inputKind: "raw",
    artifactKind: "CONTAINER_IMAGE",
    entryHint: entryHints.length > 0 ? entryHints[0] : null,
    contentSummary,
    analysisVerdict: "WITHHELD",
    executionVerdict: "NOT_ATTEMPTED",
    topReasonCode: reasonCodes.length > 0 ? reasonCodes[0] : "EXECUTION_WITHHELD_CONTAINER",
    inputDigest: options.probe.resolvedDigest,
    policyId: options.policyId,
    adapter: adapterEvidence.adapter,
    execution: {
      result: "WITHHELD",
      reasonCodes,
    },
    subReceipts,
  });

  const issues = validateSafeRunReceiptV0(receipt, "safeRunReceipt");
  if (issues.length > 0) {
    console.error("[SAFE_RUN_RECEIPT_INVALID]");
    return 1;
  }

  const analysisDir = path.join(options.outDir, "analysis");
  fs.mkdirSync(analysisDir, { recursive: true });
  fs.writeFileSync(path.join(analysisDir, "adapter_summary_v0.json"), adapterSummaryJson, "utf8");
  fs.writeFileSync(path.join(analysisDir, "adapter_findings_v0.json"), adapterFindingsJson, "utf8");
  fs.writeFileSync(path.join(options.outDir, "safe_run_receipt.json"), `${canonicalJSON(receipt)}\n`, "utf8");
  writeReceiptReadmeV0(options.outDir, receipt.weftendBuild, receipt.schemaVersion);

  const operatorReceipt = buildOperatorReceiptV0({
    command: "container scan",
    weftendBuild: receipt.weftendBuild,
    schemaVersion: receipt.schemaVersion,
    entries: [
      { kind: "safe_run_receipt", relPath: "safe_run_receipt.json", digest: receipt.receiptDigest },
      { kind: "adapter_summary", relPath: "analysis/adapter_summary_v0.json", digest: digestText(adapterSummaryJson) },
      { kind: "adapter_findings", relPath: "analysis/adapter_findings_v0.json", digest: digestText(adapterFindingsJson) },
    ],
    warnings: stableSortUniqueReasonsV0([...(receipt.weftendBuild.reasonCodes ?? []), ...reasonCodes]),
    contentSummary: receipt.contentSummary,
  });
  writeOperatorReceiptV0(options.outDir, operatorReceipt);

  const privacy = runPrivacyLintV0({ root: options.outDir, weftendBuild: receipt.weftendBuild });
  try {
    updateLibraryViewFromRunV0({
      outDir: options.outDir,
      privacyVerdict: privacy.report.verdict,
      hostSelfStatus: receipt.hostSelfStatus,
      hostSelfReasonCodes: receipt.hostSelfReasonCodes ?? [],
    });
  } catch {
    // best-effort library update only
  }

  console.log(summarizeContainerScan(receipt, privacy.report.verdict, options.inputRef));
  return 0;
};

export const runContainerCli = async (argv: string[]): Promise<number> => {
  const { rest, flags } = parseArgs(argv);
  const command = rest[0];
  if (flags.help || command !== "scan") {
    printUsage();
    return 1;
  }

  const inputRef = rest[1];
  const outDir = String(flags["out"] || "");
  if (!inputRef) {
    printUsage();
    return 1;
  }
  if (!outDir) {
    console.error("[OUT_REQUIRED] container scan requires --out <dir>.");
    return 40;
  }

  const policyPath = String(flags["policy"] || POLICY_GENERIC);
  const policyRead = readPolicy(policyPath);
  if (!policyRead.ok) return policyRead.code;

  const probe = probeDockerImageLocalV0(inputRef);
  if (!probe.ok) {
    console.error(`[${probe.code}] ${probe.message}`);
    return 40;
  }

  return finalizeSuccess({
    outDir,
    inputRef: probe.normalizedInputRef,
    policyPath,
    policyId: policyRead.policyId,
    probe,
  });
};

