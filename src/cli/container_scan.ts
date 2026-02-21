/* src/cli/container_scan.ts */
// Container adapter v0: local Docker inspect -> deterministic safe-run receipts.

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "../core/intake_policy_v1";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { computeSafeRunReceiptDigestV0, validateSafeRunReceiptV0, validateWeftEndPolicyV1 } from "../core/validate";
import type { SafeRunReceiptV0, WeftEndPolicyV1 } from "../core/types";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../runtime/operator_receipt";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { buildReceiptReadmeV0 } from "../runtime/receipt_readme";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import {
  buildContainerAdapterEvidenceV0,
  probeDockerImageLocalV0,
  type DockerProbeSuccessV0,
} from "../runtime/container/docker_probe_v0";
import { getAdapterMaintenanceStatusV1 } from "../runtime/adapters/artifact_adapter_v1";
import { updateLibraryViewFromRunV0 } from "./library_state";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const POLICY_GENERIC = path.join(process.cwd(), "policies", "generic_default.json");
const MAX_TOP_DOMAINS = 10;
const MAX_REASON_CODES = 64;

type ContainerFlags = Record<string, string | boolean>;
type CapabilityLedgerEntryV0 = { capId: string; reasonCodes: string[] };
type CapabilityLedgerV0 = {
  schema: "weftend.capabilityLedger/0";
  schemaVersion: 0;
  mode: "analysis_only";
  requestedCaps: CapabilityLedgerEntryV0[];
  grantedCaps: CapabilityLedgerEntryV0[];
  deniedCaps: CapabilityLedgerEntryV0[];
  reasonCodes: string[];
};

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend container scan <image@sha256:...|sha256:...> --out <dir> [--policy <policy.json>]");
};

const isImmutableImageRef = (value: string): boolean => {
  const v = String(value || "").trim();
  if (/^sha256:[A-Fa-f0-9]{64}$/.test(v)) return true;
  if (/@sha256:[A-Fa-f0-9]{64}$/.test(v)) return true;
  return false;
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

const readPolicy = (
  policyPath: string
): { ok: true; policy: WeftEndPolicyV1; policyId: string } | { ok: false; code: number; reasonCode: string; message: string } => {
  if (!fs.existsSync(policyPath)) {
    return { ok: false, code: 40, reasonCode: "POLICY_MISSING", message: "policy file not found." };
  }
  let policyRaw: unknown;
  try {
    policyRaw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch {
    return { ok: false, code: 40, reasonCode: "POLICY_INVALID", message: "policy must be valid JSON." };
  }
  const issues = validateWeftEndPolicyV1(policyRaw, "policy");
  if (issues.length > 0) {
    return { ok: false, code: 40, reasonCode: "POLICY_INVALID", message: "policy validation failed." };
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
const writeText = (filePath: string, text: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagePath = `${filePath}.stage`;
  fs.rmSync(stagePath, { recursive: true, force: true });
  fs.writeFileSync(stagePath, text, "utf8");
  fs.renameSync(stagePath, filePath);
};
const sortSubReceipts = (items: Array<{ name: string; digest: string }>): Array<{ name: string; digest: string }> =>
  items
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : cmpStrV0(a.digest, b.digest)));

const buildContainerCapabilityLedgerV0 = (reasonCodesInput: string[], ok: boolean): CapabilityLedgerV0 => {
  const reasonCodes = stableSortUniqueReasonsV0(reasonCodesInput).slice(0, MAX_REASON_CODES);
  const requestedCaps: CapabilityLedgerEntryV0[] = [
    { capId: "adapter.selection.container", reasonCodes: [] },
    { capId: "adapter.route.container", reasonCodes: [] },
    { capId: "docker.command.version", reasonCodes: [] },
    { capId: "docker.command.image.inspect", reasonCodes: [] },
  ];
  if (ok) {
    return {
      schema: "weftend.capabilityLedger/0",
      schemaVersion: 0,
      mode: "analysis_only",
      requestedCaps,
      grantedCaps: [
        { capId: "adapter.selection.container", reasonCodes: ["ADAPTER_SELECTION_GRANTED"] },
        { capId: "adapter.route.container", reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_SCAN_ADAPTER_V0", ...reasonCodes]) },
        { capId: "docker.command.version", reasonCodes: ["CONTAINER_SCAN_DOCKER_LOCAL_ONLY"] },
        { capId: "docker.command.image.inspect", reasonCodes: ["CONTAINER_SCAN_DOCKER_LOCAL_ONLY"] },
      ],
      deniedCaps: [],
      reasonCodes,
    };
  }
  const deniedReasons = stableSortUniqueReasonsV0(reasonCodes.length > 0 ? reasonCodes : ["CONTAINER_SCAN_FAILED"]).slice(0, MAX_REASON_CODES);
  return {
    schema: "weftend.capabilityLedger/0",
    schemaVersion: 0,
    mode: "analysis_only",
    requestedCaps,
    grantedCaps: [],
    deniedCaps: requestedCaps.map((entry) => ({ capId: entry.capId, reasonCodes: deniedReasons })),
    reasonCodes: deniedReasons,
  };
};

const listFilesRecursiveRel = (root: string, relStart: string): string[] => {
  const startPath = path.join(root, relStart);
  if (!fs.existsSync(startPath)) return [];
  const out: string[] = [];
  const stack: string[] = [relStart];
  while (stack.length > 0) {
    const rel = String(stack.pop() || "");
    const abs = path.join(root, rel);
    let stat: any = null;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat && stat.isDirectory && stat.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(abs).map((n: string) => String(n));
      } catch {
        entries = [];
      }
      entries.sort((a, b) => cmpStrV0(a, b));
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const nextRel = path.join(rel, entries[i]).replace(/\\/g, "/");
        stack.push(nextRel);
      }
      continue;
    }
    if (stat && stat.isFile && stat.isFile()) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  out.sort((a, b) => cmpStrV0(a, b));
  return out;
};

const prepareStagedOutRoot = (outDir: string): { ok: true; stageOutDir: string; hadPreexistingOutput: boolean } | { ok: false } => {
  const stageOutDir = `${outDir}.stage`;
  let hadPreexistingOutput = false;
  try {
    if (fs.existsSync(outDir)) hadPreexistingOutput = listFilesRecursiveRel(outDir, ".").length > 0;
    fs.rmSync(stageOutDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(stageOutDir), { recursive: true });
    fs.mkdirSync(stageOutDir, { recursive: true });
    return { ok: true, stageOutDir, hadPreexistingOutput };
  } catch {
    return { ok: false };
  }
};

const finalizeStagedOutRoot = (stageOutDir: string, outDir: string): boolean => {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(stageOutDir, outDir);
    return true;
  } catch {
    return false;
  }
};

const evaluateEvidenceWarnings = (input: {
  outDir: string;
  receipt: SafeRunReceiptV0;
  operatorReceiptDigest: string;
  readmeText: string;
}): string[] => {
  const isPresenceOnlyEvidencePath = (relPath: string): boolean => {
    const normalized = String(relPath || "").replace(/\\/g, "/").toLowerCase();
    return normalized.endsWith("_receipt.json");
  };
  const expected = new Map<string, string>();
  expected.set("safe_run_receipt.json", input.receipt.receiptDigest);
  expected.set("operator_receipt.json", input.operatorReceiptDigest);
  expected.set("weftend/README.txt", digestText(input.readmeText));
  (input.receipt.subReceipts ?? []).forEach((entry) => {
    const relPath = String(entry.name || "").replace(/\\/g, "/");
    if (!relPath) return;
    expected.set(relPath, String(entry.digest || ""));
  });

  const actualSet = new Set<string>();
  listFilesRecursiveRel(input.outDir, ".").forEach((rel) => actualSet.add(rel));

  const warnings: string[] = [];
  expected.forEach((digest, relPath) => {
    const abs = path.join(input.outDir, relPath);
    if (!fs.existsSync(abs)) {
      warnings.push("SAFE_RUN_EVIDENCE_MISSING");
      return;
    }
    if (isPresenceOnlyEvidencePath(relPath)) return;
    let raw = "";
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      warnings.push("SAFE_RUN_EVIDENCE_MISSING");
      return;
    }
    if (digestText(raw) !== digest) warnings.push("SAFE_RUN_EVIDENCE_DIGEST_MISMATCH");
  });

  actualSet.forEach((relPath) => {
    if (!expected.has(relPath)) warnings.push("SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT");
  });

  return stableSortUniqueReasonsV0(warnings);
};

const summarizeContainerScan = (receipt: SafeRunReceiptV0, privacyVerdict: "PASS" | "FAIL", inputRef: string): string => {
  const reason = receipt.topReasonCode && receipt.topReasonCode.length > 0 ? receipt.topReasonCode : "-";
  return `CONTAINER_SCAN ${receipt.analysisVerdict} inputRef=${inputRef} kind=${receipt.artifactKind} exec=${receipt.executionVerdict} reason=${reason} ${formatBuildDigestSummaryV0(receipt.weftendBuild)} privacyLint=${privacyVerdict}`;
};

const finalizeFailure = (options: {
  outDir: string;
  stageOutDir: string;
  hadPreexistingOutput: boolean;
  inputRef: string;
  policyPath: string;
  policyId?: string;
  reasonCodes: string[];
}): number => {
  const reasonCodes = stableSortUniqueReasonsV0(options.reasonCodes).slice(0, MAX_REASON_CODES);
  const weftendBuild = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  const analysisDir = path.join(options.stageOutDir, "analysis");
  fs.mkdirSync(analysisDir, { recursive: true });

  const selectedPolicy = path.basename(options.policyPath || POLICY_GENERIC);
  const contentSummary = {
    targetKind: "file" as const,
    artifactKind: "dataOnly" as const,
    fileCountsByKind: {
      html: 0,
      js: 0,
      css: 0,
      json: 0,
      wasm: 0,
      media: 0,
      binary: 0,
      other: 0,
    },
    totalFiles: 0,
    totalBytesBounded: 0,
    sizeSummary: {
      totalBytesBounded: 0,
      truncated: false,
    },
    topExtensions: [],
    hasNativeBinaries: false,
    hasScripts: false,
    hasHtml: false,
    externalRefs: {
      count: 0,
      topDomains: [],
    },
    entryHints: ["ENTRY_CONTAINER_IMAGE"],
    boundednessMarkers: ["BOUND_NO_NETWORK"],
    archiveDepthMax: 0,
    nestedArchiveCount: 0,
    manifestCount: 0,
    stringsIndicators: {
      urlLikeCount: 0,
      ipLikeCount: 0,
      powershellLikeCount: 0,
      cmdExecLikeCount: 0,
    },
    policyMatch: {
      selectedPolicy,
      reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_POLICY_APPLIED", "POLICY_AUTO_GENERIC"]).slice(0, MAX_REASON_CODES),
    },
    hashFamily: {
      sha256: computeArtifactDigestV0(String(options.inputRef || "")),
    },
  };

  const capabilityLedger = buildContainerCapabilityLedgerV0(reasonCodes, false);
  const capabilityLedgerJson = `${canonicalJSON(capabilityLedger)}\n`;
  writeText(path.join(analysisDir, "capability_ledger_v0.json"), capabilityLedgerJson);
  const subReceipts = sortSubReceipts([{ name: "analysis/capability_ledger_v0.json", digest: digestText(capabilityLedgerJson) }]);

  const receipt = buildSafeRunReceipt({
    schema: "weftend.safeRunReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild,
    inputKind: "raw",
    artifactKind: "CONTAINER_IMAGE",
    entryHint: "ENTRY_CONTAINER_IMAGE",
    contentSummary,
    analysisVerdict: "DENY",
    executionVerdict: "NOT_ATTEMPTED",
    topReasonCode: reasonCodes.length > 0 ? reasonCodes[0] : "CONTAINER_SCAN_FAILED",
    inputDigest: computeArtifactDigestV0(String(options.inputRef || "")),
    policyId: options.policyId || computeArtifactDigestV0("POLICY_UNRESOLVED"),
    execution: {
      result: "WITHHELD",
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["CONTAINER_SCAN_FAILED"],
    },
    subReceipts,
  });

  const issues = validateSafeRunReceiptV0(receipt, "safeRunReceipt");
  if (issues.length > 0) {
    console.error("[SAFE_RUN_RECEIPT_INVALID]");
    return 1;
  }

  writeText(path.join(options.stageOutDir, "safe_run_receipt.json"), `${canonicalJSON(receipt)}\n`);
  const readmeText = buildReceiptReadmeV0(receipt.weftendBuild, receipt.schemaVersion);
  const readmePath = path.join(options.stageOutDir, "weftend", "README.txt");
  writeText(readmePath, readmeText);

  const baseWarnings = stableSortUniqueReasonsV0([
    ...(receipt.weftendBuild.reasonCodes ?? []),
    ...reasonCodes,
    ...(options.hadPreexistingOutput ? ["SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"] : []),
  ]);
  const entries = [
    { kind: "safe_run_receipt", relPath: "safe_run_receipt.json", digest: receipt.receiptDigest },
    { kind: "receipt_readme", relPath: "weftend/README.txt", digest: digestText(readmeText) },
    { kind: "capability_ledger", relPath: "analysis/capability_ledger_v0.json", digest: digestText(capabilityLedgerJson) },
  ];
  const buildAndWriteOperator = (warnings: string[]) => {
    const operatorReceipt = buildOperatorReceiptV0({
      command: "container scan",
      weftendBuild: receipt.weftendBuild,
      schemaVersion: receipt.schemaVersion,
      entries,
      warnings,
      contentSummary: receipt.contentSummary,
    });
    writeOperatorReceiptV0(options.stageOutDir, operatorReceipt);
    return operatorReceipt;
  };
  let operatorReceipt = buildAndWriteOperator(baseWarnings);
  const evidenceWarnings = evaluateEvidenceWarnings({
    outDir: options.stageOutDir,
    receipt,
    operatorReceiptDigest: operatorReceipt.receiptDigest,
    readmeText,
  });
  if (evidenceWarnings.length > 0) {
    operatorReceipt = buildAndWriteOperator(stableSortUniqueReasonsV0([...baseWarnings, ...evidenceWarnings]));
  }

  const privacy = runPrivacyLintV0({ root: options.stageOutDir, weftendBuild: receipt.weftendBuild });
  if (!finalizeStagedOutRoot(options.stageOutDir, options.outDir)) {
    console.error("[CONTAINER_SCAN_FINALIZE_FAILED] unable to finalize staged output.");
    return 1;
  }
  const libraryUpdate = (() => {
    try {
      return updateLibraryViewFromRunV0({
        outDir: options.outDir,
        privacyVerdict: privacy.report.verdict,
        hostSelfStatus: receipt.hostSelfStatus,
        hostSelfReasonCodes: receipt.hostSelfReasonCodes ?? [],
      });
    } catch {
      return { ok: false, code: "LIBRARY_VIEW_UPDATE_FAILED", skipped: false };
    }
  })();
  if (!libraryUpdate.ok && !libraryUpdate.skipped) {
    console.error(`[${libraryUpdate.code ?? "LIBRARY_VIEW_UPDATE_FAILED"}] library view update failed.`);
  }

  console.log(summarizeContainerScan(receipt, privacy.report.verdict, options.inputRef));
  return 40;
};

const finalizeSuccess = (options: {
  outDir: string;
  stageOutDir: string;
  hadPreexistingOutput: boolean;
  inputRef: string;
  policyPath: string;
  policyId: string;
  probe: DockerProbeSuccessV0;
}): number => {
  const weftendBuild = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  fs.mkdirSync(options.stageOutDir, { recursive: true });

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
  const capabilityLedger = buildContainerCapabilityLedgerV0(reasonCodes, true);
  const capabilityLedgerJson = `${canonicalJSON(capabilityLedger)}\n`;
  const subReceipts = sortSubReceipts([
    { name: "analysis/capability_ledger_v0.json", digest: digestText(capabilityLedgerJson) },
    { name: "analysis/adapter_summary_v0.json", digest: digestText(adapterSummaryJson) },
    { name: "analysis/adapter_findings_v0.json", digest: digestText(adapterFindingsJson) },
  ]);

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

  const analysisDir = path.join(options.stageOutDir, "analysis");
  fs.mkdirSync(analysisDir, { recursive: true });
  writeText(path.join(analysisDir, "capability_ledger_v0.json"), capabilityLedgerJson);
  writeText(path.join(analysisDir, "adapter_summary_v0.json"), adapterSummaryJson);
  writeText(path.join(analysisDir, "adapter_findings_v0.json"), adapterFindingsJson);
  writeText(path.join(options.stageOutDir, "safe_run_receipt.json"), `${canonicalJSON(receipt)}\n`);
  const readmeText = buildReceiptReadmeV0(receipt.weftendBuild, receipt.schemaVersion);
  const readmePath = path.join(options.stageOutDir, "weftend", "README.txt");
  writeText(readmePath, readmeText);

  const baseWarnings = stableSortUniqueReasonsV0([
    ...(receipt.weftendBuild.reasonCodes ?? []),
    ...reasonCodes,
    ...(options.hadPreexistingOutput ? ["SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"] : []),
  ]);
  const entries = [
    { kind: "safe_run_receipt", relPath: "safe_run_receipt.json", digest: receipt.receiptDigest },
    { kind: "receipt_readme", relPath: "weftend/README.txt", digest: digestText(readmeText) },
    { kind: "capability_ledger", relPath: "analysis/capability_ledger_v0.json", digest: digestText(capabilityLedgerJson) },
    { kind: "adapter_summary", relPath: "analysis/adapter_summary_v0.json", digest: digestText(adapterSummaryJson) },
    { kind: "adapter_findings", relPath: "analysis/adapter_findings_v0.json", digest: digestText(adapterFindingsJson) },
  ];
  const buildAndWriteOperator = (warnings: string[]) => {
    const operatorReceipt = buildOperatorReceiptV0({
      command: "container scan",
      weftendBuild: receipt.weftendBuild,
      schemaVersion: receipt.schemaVersion,
      entries,
      warnings,
      contentSummary: receipt.contentSummary,
    });
    writeOperatorReceiptV0(options.stageOutDir, operatorReceipt);
    return operatorReceipt;
  };
  let operatorReceipt = buildAndWriteOperator(baseWarnings);
  const evidenceWarnings = evaluateEvidenceWarnings({
    outDir: options.stageOutDir,
    receipt,
    operatorReceiptDigest: operatorReceipt.receiptDigest,
    readmeText,
  });
  if (evidenceWarnings.length > 0) {
    operatorReceipt = buildAndWriteOperator(stableSortUniqueReasonsV0([...baseWarnings, ...evidenceWarnings]));
  }

  const privacy = runPrivacyLintV0({ root: options.stageOutDir, weftendBuild: receipt.weftendBuild });
  if (!finalizeStagedOutRoot(options.stageOutDir, options.outDir)) {
    console.error("[CONTAINER_SCAN_FINALIZE_FAILED] unable to finalize staged output.");
    return 1;
  }
  const libraryUpdate = (() => {
    try {
      return updateLibraryViewFromRunV0({
        outDir: options.outDir,
        privacyVerdict: privacy.report.verdict,
        hostSelfStatus: receipt.hostSelfStatus,
        hostSelfReasonCodes: receipt.hostSelfReasonCodes ?? [],
      });
    } catch {
      return { ok: false, code: "LIBRARY_VIEW_UPDATE_FAILED", skipped: false };
    }
  })();
  if (!libraryUpdate.ok && !libraryUpdate.skipped) {
    console.error(`[${libraryUpdate.code ?? "LIBRARY_VIEW_UPDATE_FAILED"}] library view update failed.`);
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
  const stage = prepareStagedOutRoot(outDir);
  if (!stage.ok) {
    console.error("[CONTAINER_SCAN_STAGE_INIT_FAILED] unable to initialize staged output path.");
    return 1;
  }

  const policyPath = String(flags["policy"] || POLICY_GENERIC);
  const policyRead = readPolicy(policyPath);
  if (!policyRead.ok) {
    console.error(`[${policyRead.reasonCode}] ${policyRead.message}`);
    return finalizeFailure({
      outDir,
      stageOutDir: stage.stageOutDir,
      hadPreexistingOutput: stage.hadPreexistingOutput,
      inputRef: String(inputRef || ""),
      policyPath,
      reasonCodes: [policyRead.reasonCode],
    });
  }

  const maintenance = getAdapterMaintenanceStatusV1("container");
  if (maintenance.reasonCodes.length > 0) {
    const topReason = maintenance.reasonCodes.includes("ADAPTER_TEMPORARILY_UNAVAILABLE")
      ? "ADAPTER_TEMPORARILY_UNAVAILABLE"
      : maintenance.reasonCodes.includes("ADAPTER_POLICY_INVALID")
        ? "ADAPTER_POLICY_INVALID"
        : maintenance.reasonCodes[0] || "ADAPTER_POLICY_INVALID";
    console.error(`[${topReason}] container adapter maintenance policy denied this run.`);
    if (maintenance.invalidReasonCode && maintenance.invalidReasonCode !== topReason) {
      console.error(`[${maintenance.invalidReasonCode}] adapter maintenance policy detail.`);
    }
    return finalizeFailure({
      outDir,
      stageOutDir: stage.stageOutDir,
      hadPreexistingOutput: stage.hadPreexistingOutput,
      inputRef: String(inputRef || ""),
      policyPath,
      policyId: policyRead.policyId,
      reasonCodes: maintenance.reasonCodes,
    });
  }

  if (!isImmutableImageRef(inputRef)) {
    const reasonCode = "DOCKER_IMAGE_REF_NOT_IMMUTABLE";
    console.error(`[${reasonCode}] container scan requires an immutable digest reference (name@sha256:... or sha256:...).`);
    return finalizeFailure({
      outDir,
      stageOutDir: stage.stageOutDir,
      hadPreexistingOutput: stage.hadPreexistingOutput,
      inputRef: String(inputRef || ""),
      policyPath,
      policyId: policyRead.policyId,
      reasonCodes: [reasonCode],
    });
  }

  const probe = probeDockerImageLocalV0(inputRef);
  if (!probe.ok) {
    console.error(`[${probe.code}] ${probe.message}`);
    return finalizeFailure({
      outDir,
      stageOutDir: stage.stageOutDir,
      hadPreexistingOutput: stage.hadPreexistingOutput,
      inputRef: String(inputRef || ""),
      policyPath,
      policyId: policyRead.policyId,
      reasonCodes: [probe.code],
    });
  }

  return finalizeSuccess({
    outDir,
    stageOutDir: stage.stageOutDir,
    hadPreexistingOutput: stage.hadPreexistingOutput,
    inputRef: probe.normalizedInputRef,
    policyPath,
    policyId: policyRead.policyId,
    probe,
  });
};
