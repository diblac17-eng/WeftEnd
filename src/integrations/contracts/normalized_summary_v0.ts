/* src/integrations/contracts/normalized_summary_v0.ts */
// Deterministic normalized summary contract for external consumers.

import type { CompareSummaryV0 } from "../../cli/compare_normalize";
import type { WeftendBuildV0 } from "../../core/types";
import { canonicalJSON } from "../../core/canon";
import { computeArtifactDigestV0 } from "../../runtime/store/artifact_store";
import { stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";

export interface NormalizedSummaryV0 {
  schema: "weftend.normalizedSummary/0";
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  receiptKinds: string[];
  summary: CompareSummaryV0;
  summaryDigest: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasAbsPath = (value: string): boolean =>
  /\b[A-Za-z]:\\/.test(value) || /\/Users\//.test(value) || /\/home\//.test(value) || /^\/(var|etc|opt|private|Volumes)\//.test(value);

const hasEnvMarker = (value: string): boolean =>
  /%[A-Za-z_][A-Za-z0-9_]*%/.test(value) || /\$env:[A-Za-z_][A-Za-z0-9_]*/.test(value) || /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(value);

const hasSensitiveMarker = (value: string): boolean => hasAbsPath(value) || hasEnvMarker(value);

const hasBuild = (value: unknown): value is WeftendBuildV0 =>
  isRecord(value) &&
  value["algo"] === "fnv1a32" &&
  isNonEmptyString(value["digest"]) &&
  (value["source"] === "HOST_BINARY_PATH" || value["source"] === "NODE_MAIN_JS" || value["source"] === "UNKNOWN");

export const buildNormalizedSummaryV0 = (input: {
  weftendBuild: WeftendBuildV0;
  receiptKinds: string[];
  summary: CompareSummaryV0;
  summaryDigest: string;
}): NormalizedSummaryV0 => ({
  schema: "weftend.normalizedSummary/0",
  schemaVersion: 0,
  weftendBuild: input.weftendBuild,
  receiptKinds: stableSortUniqueStringsV0(input.receiptKinds ?? []),
  summary: input.summary,
  summaryDigest: input.summaryDigest,
});

export const computeNormalizedSummaryDigestV0 = (value: NormalizedSummaryV0): string =>
  computeArtifactDigestV0(canonicalJSON(value));

export const validateNormalizedSummaryV0 = (value: unknown, path: string = "normalizedSummary"): string[] => {
  const reasons: string[] = [];
  if (!isRecord(value)) return ["NORMALIZED_SUMMARY_INVALID"];
  if (value["schema"] !== "weftend.normalizedSummary/0") reasons.push("NORMALIZED_SUMMARY_INVALID");
  if (value["schemaVersion"] !== 0) reasons.push("NORMALIZED_SUMMARY_INVALID");
  if (!hasBuild(value["weftendBuild"])) reasons.push("NORMALIZED_SUMMARY_INVALID");
  const receiptKinds = value["receiptKinds"];
  if (!Array.isArray(receiptKinds) || !receiptKinds.every((item) => isNonEmptyString(item))) {
    reasons.push("NORMALIZED_SUMMARY_INVALID");
  } else if (stableSortUniqueStringsV0(receiptKinds as string[]).join("|") !== (receiptKinds as string[]).join("|")) {
    reasons.push("NORMALIZED_SUMMARY_INVALID");
  }
  if (!isRecord(value["summary"])) reasons.push("NORMALIZED_SUMMARY_INVALID");
  if (!isNonEmptyString(value["summaryDigest"])) reasons.push("NORMALIZED_SUMMARY_INVALID");

  // Privacy posture for integration output.
  const scan = (entry: unknown, keyPath: string): void => {
    if (typeof entry === "string") {
      if (hasSensitiveMarker(entry)) reasons.push("NORMALIZED_SUMMARY_PRIVACY_FAIL");
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => scan(item, `${keyPath}[${index}]`));
      return;
    }
    if (isRecord(entry)) {
      Object.keys(entry)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
          if (hasSensitiveMarker(key)) reasons.push("NORMALIZED_SUMMARY_PRIVACY_FAIL");
          scan(entry[key], `${keyPath}.${key}`);
        });
    }
  };
  scan(value, path);
  return stableSortUniqueStringsV0(reasons);
};

