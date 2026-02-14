/* src/cli/compare_normalize.ts */
// Normalize heterogeneous receipts into one deterministic compare summary.

import type { CompareLoadedSourceV0 } from "./compare_loader";
import { canonicalJSON } from "../core/canon";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";

declare const require: any;

const fs = require("fs");
const path = require("path");

export interface CompareSummaryV0 {
  result: string;
  exitCode?: number;
  reasonCodes: string[];
  artifactDigest?: string;
  policyDigest?: string;
  externalRefCount?: number;
  uniqueDomainCount?: number;
  topDomains?: string[];
  targetKind?: string;
  artifactKind?: string;
  totalFiles?: number;
  totalBytesBounded?: number;
  fileCountsByKind?: Record<string, number>;
  hasScripts?: boolean;
  hasNativeBinaries?: boolean;
  hasHtml?: boolean;
  entryHints?: string[];
  boundednessMarkers?: string[];
  archiveDepthMax?: number;
  nestedArchiveCount?: number;
  urlLikeCount?: number;
  signaturePresent?: string;
  timestampPresent?: string;
  capsRequested?: number;
  capsDenied?: number;
  deniedCapCodes?: string[];
  hostReleaseStatus?: string;
  strictVerify?: string;
  strictExecute?: string;
}

const parseMaybeJson = (filePath: string): unknown | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const mintCandidates = (root: string): string[] => [
  path.join(root, "weftend_mint_v1.json"),
  path.join(root, "analysis", "weftend_mint_v1.json"),
];

const parseExternalCounts = (root: string): { externalRefCount?: number; uniqueDomainCount?: number } => {
  for (const candidate of mintCandidates(root)) {
    const parsed = parseMaybeJson(candidate) as any;
    const refs = Array.isArray(parsed?.observations?.externalRefs) ? parsed.observations.externalRefs : null;
    if (!refs) continue;
    const normalized = refs
      .filter((v: unknown) => typeof v === "string")
      .map((v: string) => v.trim())
      .filter((v: string) => v.length > 0)
      .sort((a: string, b: string) => cmpStrV0(a, b));
    const domains = new Set<string>();
    normalized.forEach((ref: string) => {
      try {
        const host = new URL(ref).hostname.trim().toLowerCase();
        if (host) domains.add(host);
      } catch {
        // ignore non-URL refs
      }
    });
    return { externalRefCount: normalized.length, uniqueDomainCount: domains.size };
  }
  return {};
};

export const normalizeCompareSourceV0 = (
  source: CompareLoadedSourceV0
): { summary: CompareSummaryV0; summaryDigest: string } => {
  const reasons: string[] = [];
  let result = "UNKNOWN";
  let artifactDigest: string | undefined;
  let policyDigest: string | undefined;
  let hostReleaseStatus: string | undefined;
  let strictVerify: string | undefined;
  let strictExecute: string | undefined;
  let capsRequested: number | undefined;
  let capsDenied: number | undefined;
  let deniedCapCodes: string[] | undefined;
  let exitCode = source.wrapperExitCode;
  let summaryContent: any | undefined;

  if (source.safeRunReceipt) {
    const safe = source.safeRunReceipt;
    result = `${safe.analysisVerdict}:${safe.executionVerdict}`;
    reasons.push(...(safe.execution.reasonCodes ?? []));
    if (safe.topReasonCode) reasons.push(safe.topReasonCode);
    reasons.push(...(safe.hostSelfReasonCodes ?? []));
    artifactDigest = safe.inputDigest || safe.releaseDirDigest;
    policyDigest = safe.policyId;
    summaryContent = safe.contentSummary;
    if (exitCode === undefined) exitCode = 0;
  }

  if (source.runReceipt) {
    const run = source.runReceipt;
    result = `${run.intakeAction}:${run.execution.status}`;
    reasons.push(...(run.execution.reasonCodes ?? []));
    reasons.push(...(run.strictVerify.reasonCodes ?? []));
    reasons.push(...(run.strictExecute.reasonCodes ?? []));
    artifactDigest = run.inputDigest;
    policyDigest = run.policyId;
    summaryContent = run.contentSummary ?? summaryContent;
    hostReleaseStatus = run.strictVerify.releaseStatus;
    strictVerify = run.strictVerify.verdict;
    strictExecute = run.strictExecute.result;
    if (exitCode === undefined) exitCode = 0;
  }

  if (source.hostRunReceipt) {
    const host = source.hostRunReceipt;
    result = `${host.releaseStatus}:${host.execute.result}`;
    reasons.push(...(host.verify.reasonCodes ?? []));
    reasons.push(...(host.execute.reasonCodes ?? []));
    reasons.push(...(host.releaseReasonCodes ?? []));
    reasons.push(...(host.hostSelfReasonCodes ?? []));
    artifactDigest = host.releaseDirDigest;
    hostReleaseStatus = host.releaseStatus;
    strictVerify = host.verify.verdict;
    strictExecute = host.execute.result;
    capsRequested = Array.isArray(host.caps?.requested) ? host.caps.requested.length : undefined;
    capsDenied = Array.isArray(host.caps?.denied) ? host.caps.denied.length : undefined;
    deniedCapCodes = Array.isArray(host.caps?.denied)
      ? host.caps.denied.slice().map(String).sort((a, b) => cmpStrV0(a, b))
      : undefined;
    summaryContent = host.contentSummary ?? summaryContent;
    if (exitCode === undefined) {
      exitCode = host.execute.result === "ALLOW" && host.execute.executionOk === true ? 0 : 40;
    }
  }

  if (source.operatorReceipt) {
    reasons.push(...(source.operatorReceipt.warnings ?? []));
    if (result === "UNKNOWN") result = `command:${source.operatorReceipt.command}`;
    if (!summaryContent && source.operatorReceipt.contentSummary) {
      summaryContent = source.operatorReceipt.contentSummary;
    }
    if (exitCode === undefined) exitCode = 0;
  }

  const external = summaryContent
    ? {
        externalRefCount: summaryContent.externalRefs?.count,
        uniqueDomainCount: Array.isArray(summaryContent.externalRefs?.topDomains)
          ? summaryContent.externalRefs.topDomains.length
          : undefined,
      }
    : parseExternalCounts(source.root);
  const topDomains =
    summaryContent && Array.isArray(summaryContent.externalRefs?.topDomains)
      ? summaryContent.externalRefs.topDomains.slice().map(String).sort((a: string, b: string) => cmpStrV0(a, b))
      : undefined;
  const summary: CompareSummaryV0 = {
    result,
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    reasonCodes: stableSortUniqueStringsV0(reasons),
    ...(artifactDigest ? { artifactDigest } : {}),
    ...(policyDigest ? { policyDigest } : {}),
    ...(external.externalRefCount !== undefined ? { externalRefCount: external.externalRefCount } : {}),
    ...(external.uniqueDomainCount !== undefined ? { uniqueDomainCount: external.uniqueDomainCount } : {}),
    ...(topDomains ? { topDomains } : {}),
    ...(summaryContent?.targetKind ? { targetKind: summaryContent.targetKind } : {}),
    ...(summaryContent?.artifactKind ? { artifactKind: summaryContent.artifactKind } : {}),
    ...(typeof summaryContent?.totalFiles === "number" ? { totalFiles: summaryContent.totalFiles } : {}),
    ...(typeof summaryContent?.totalBytesBounded === "number"
      ? { totalBytesBounded: summaryContent.totalBytesBounded }
      : {}),
    ...(summaryContent?.fileCountsByKind ? { fileCountsByKind: summaryContent.fileCountsByKind } : {}),
    ...(typeof summaryContent?.hasScripts === "boolean" ? { hasScripts: summaryContent.hasScripts } : {}),
    ...(typeof summaryContent?.hasNativeBinaries === "boolean"
      ? { hasNativeBinaries: summaryContent.hasNativeBinaries }
      : {}),
    ...(typeof summaryContent?.hasHtml === "boolean" ? { hasHtml: summaryContent.hasHtml } : {}),
    ...(Array.isArray(summaryContent?.entryHints) ? { entryHints: summaryContent.entryHints } : {}),
    ...(Array.isArray(summaryContent?.boundednessMarkers) ? { boundednessMarkers: summaryContent.boundednessMarkers } : {}),
    ...(typeof summaryContent?.archiveDepthMax === "number" ? { archiveDepthMax: summaryContent.archiveDepthMax } : {}),
    ...(typeof summaryContent?.nestedArchiveCount === "number"
      ? { nestedArchiveCount: summaryContent.nestedArchiveCount }
      : {}),
    ...(typeof summaryContent?.stringsIndicators?.urlLikeCount === "number"
      ? { urlLikeCount: summaryContent.stringsIndicators.urlLikeCount }
      : {}),
    ...(typeof summaryContent?.signingSummary?.signaturePresent === "string"
      ? { signaturePresent: summaryContent.signingSummary.signaturePresent }
      : {}),
    ...(typeof summaryContent?.signingSummary?.timestampPresent === "string"
      ? { timestampPresent: summaryContent.signingSummary.timestampPresent }
      : {}),
    ...(capsRequested !== undefined ? { capsRequested } : {}),
    ...(capsDenied !== undefined ? { capsDenied } : {}),
    ...(deniedCapCodes && deniedCapCodes.length > 0 ? { deniedCapCodes: stableSortUniqueStringsV0(deniedCapCodes) } : {}),
    ...(hostReleaseStatus ? { hostReleaseStatus } : {}),
    ...(strictVerify ? { strictVerify } : {}),
    ...(strictExecute ? { strictExecute } : {}),
  };

  const summaryDigest = computeArtifactDigestV0(canonicalJSON(summary));
  return { summary, summaryDigest };
};
