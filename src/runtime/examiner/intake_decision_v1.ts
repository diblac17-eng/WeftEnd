// src/runtime/examiner/intake_decision_v1.ts
// Deterministic intake decision builder (v1).

import { canonicalJSON } from "../../core/canon";
import { makeTruncationMarker, truncateListWithMarker, truncateTextWithMarker } from "../../core/bounds";
import { sha256HexV0 } from "../../core/hash_v0";
import { cmpStrV0 } from "../../core/order";
import { stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import type {
  EvidenceProfileV1,
  IntakeActionV1,
  IntakeAppealBundleV1,
  IntakeDecisionV1,
  IntakeSeverityV1,
  WeftendMintPackageV1,
  WeftEndPolicyV1,
} from "../../core/types";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "../../core/intake_policy_v1";

declare const Buffer: any;

export interface IntakeDecisionOutputsV1 {
  decision: IntakeDecisionV1;
  disclosure: string;
  appeal: IntakeAppealBundleV1;
}

export interface IntakeDecisionOptionsV1 {
  scriptText?: string;
}

const sha256 = (input: string): string => sha256HexV0(input);

const computeDigest = (payload: string): string => `sha256:${sha256(payload)}`;

const utf8ByteLength = (value: string): number => {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").length;
  return value.length;
};

const severityRank: Record<IntakeSeverityV1, number> = {
  INFO: 0,
  WARN: 1,
  DENY: 2,
  QUARANTINE: 3,
};

const gradeFromSeverity = (severity: IntakeSeverityV1): IntakeDecisionV1["grade"] => {
  if (severity === "INFO") return "OK";
  return severity;
};

const defaultSeverityForReason = (code: string, profile: EvidenceProfileV1): IntakeSeverityV1 => {
  if (code === "APPEAL_OVERSIZE") return "DENY";
  if (code === "DISCLOSURE_REQUIRED") return "DENY";
  if (code === "EVIDENCE_DIGEST_MISMATCH") return "QUARANTINE";
  if (code === "RELEASE_SIGNATURE_BAD") return "QUARANTINE";
  if (code === "HISTORY_LINK_MISMATCH") return "QUARANTINE";
  if (code === "STRICT_COMPARTMENT_UNAVAILABLE") return "WARN";
  if (code.startsWith("CAPTURE_INPUT_")) return "DENY";
  if (code === "ZIP_EOCD_MISSING" || code === "ZIP_CD_CORRUPT") return "DENY";
  if (code === "CAP_DENY_STORAGE") return "WARN";
  if (code === "CAP_DENY_NET") {
    if (profile === "mod") return "DENY";
    return "WARN";
  }
  if (code.startsWith("CAP_DENY_")) return "WARN";
  return "INFO";
};

const computeSeverity = (
  reasons: string[],
  policy: WeftEndPolicyV1,
  profile: EvidenceProfileV1
): IntakeSeverityV1 => {
  let severity: IntakeSeverityV1 = "INFO";
  reasons.forEach((code) => {
    const override = policy.reasonSeverity[code];
    const next = override ?? defaultSeverityForReason(code, profile);
    if (severityRank[next] > severityRank[severity]) severity = next;
  });
  return severity;
};

const shouldRequireDisclosure = (severity: IntakeSeverityV1, policy: WeftEndPolicyV1): boolean => {
  if (severity === "WARN") return policy.disclosure.requireOnWARN;
  if (severity === "DENY" || severity === "QUARANTINE") return policy.disclosure.requireOnDENY;
  return false;
};

const canProduceDisclosure = (policy: WeftEndPolicyV1): boolean =>
  policy.disclosure.maxLines > 0 && policy.bounds.maxDisclosureChars > 0;

const mergeCaps = (source: Record<string, number> | undefined, target: Record<string, number>) => {
  if (!source) return;
  Object.entries(source).forEach(([key, value]) => {
    if (typeof value !== "number" || value < 0) return;
    target[key] = (target[key] ?? 0) + value;
  });
};

const extractDomain = (url: string): string | null => {
  const match = url.match(/^[a-z]+:\/\/([^/]+)/i);
  if (!match) return null;
  const host = match[1].toLowerCase();
  const trimmed = host.replace(/:\\d+$/, "");
  return trimmed.length > 0 ? trimmed : null;
};

const buildCapSummary = (mint: WeftendMintPackageV1, maxItems: number) => {
  const attemptedCaps: Record<string, number> = {};
  const deniedCaps: Record<string, number> = {};
  const probes = [mint.executionProbes.loadOnly, mint.executionProbes.interactionScript].filter(Boolean);
  probes.forEach((probe) => {
    if (!probe) return;
    mergeCaps(probe.attemptedCaps, attemptedCaps);
    mergeCaps(probe.deniedCaps, deniedCaps);
  });

  const totals = {
    attempted: Object.values(attemptedCaps).reduce((a, b) => a + (b ?? 0), 0),
    denied: Object.values(deniedCaps).reduce((a, b) => a + (b ?? 0), 0),
  };

  const byKindMap: Record<string, { attempted: number; denied: number }> = {};
  const allCaps = new Set([...Object.keys(attemptedCaps), ...Object.keys(deniedCaps)]);
  Array.from(allCaps)
    .sort((a, b) => cmpStrV0(a, b))
    .forEach((capId) => {
      const kind = capId.includes(".")
        ? capId.split(".")[0]
        : capId.includes(":")
          ? capId.split(":")[0]
          : capId;
      if (!byKindMap[kind]) byKindMap[kind] = { attempted: 0, denied: 0 };
      byKindMap[kind].attempted += attemptedCaps[capId] ?? 0;
      byKindMap[kind].denied += deniedCaps[capId] ?? 0;
    });

  const notableDomains = stableSortUniqueReasonsV0(
    mint.observations.externalRefs
      .map((ref) => extractDomain(ref))
      .filter((value): value is string => Boolean(value))
      .map((domain) => `net.domain=${domain}`)
  );
  const notable = truncateListWithMarker(notableDomains, maxItems).items;

  const byKind: Record<string, { attempted: number; denied: number }> = {};
  const sortedKinds = Object.keys(byKindMap).sort((a, b) => cmpStrV0(a, b));
  if (sortedKinds.length > maxItems) {
    const kept = sortedKinds.slice(0, Math.max(0, maxItems));
    const dropped = sortedKinds.slice(Math.max(0, maxItems));
    kept.forEach((key) => {
      byKind[key] = byKindMap[key];
    });
    const droppedTotals = dropped.reduce(
      (acc, key) => {
        acc.attempted += byKindMap[key]?.attempted ?? 0;
        acc.denied += byKindMap[key]?.denied ?? 0;
        return acc;
      },
      { attempted: 0, denied: 0 }
    );
    byKind[makeTruncationMarker(dropped.length)] = droppedTotals;
  } else {
    sortedKinds.forEach((key) => {
      byKind[key] = byKindMap[key];
    });
  }

  return {
    denied: totals.denied,
    attempted: totals.attempted,
    byKind,
    ...(notable.length > 0 ? { notable } : {}),
  };
};

const buildDisclosure = (
  decision: IntakeDecisionV1,
  reasons: string[],
  capSummary: IntakeDecisionV1["capSummary"],
  policy: WeftEndPolicyV1
): string => {
  const lines: string[] = [];
  lines.push(`Action: ${decision.action}`);
  lines.push(`Top reasons: ${reasons.join(", ") || "none"}`);
  lines.push(`Grade: ${decision.grade}`);
  lines.push(`Caps attempted: ${capSummary.attempted}, denied: ${capSummary.denied}`);
  const byKindEntries = Object.entries(capSummary.byKind).map(
    ([kind, counts]) => `${kind} a=${counts.attempted} d=${counts.denied}`
  );
  if (byKindEntries.length > 0) {
    lines.push(`Caps by kind: ${byKindEntries.join(", ")}`);
  }
  if (capSummary.notable && capSummary.notable.length > 0) {
    lines.push(`Notable: ${capSummary.notable.join(", ")}`);
  }

  const limitedLines = truncateListWithMarker(lines, policy.disclosure.maxLines).items;
  const raw = limitedLines.join("\n");
  const truncated = truncateTextWithMarker(raw, policy.bounds.maxDisclosureChars).value;
  return truncated.replace(/[^\x00-\x7F]/g, "?");
};

const computeDecisionDigest = (decision: IntakeDecisionV1): string => {
  const payload = { ...decision, decisionDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

const buildAppealPayload = (
  mint: WeftendMintPackageV1,
  policyId: string,
  topReasonCodes: string[],
  maxItems: number,
  scriptText?: string
): IntakeAppealBundleV1 => {
  const receiptDigests = mint.grade.receipts
    .map((r) => r.digest)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort((a, b) => cmpStrV0(a, b));
  const boundedReceipts = truncateListWithMarker(receiptDigests, maxItems).items;
  const probeScriptDigest =
    scriptText && scriptText.trim().length > 0 ? computeDigest(scriptText) : undefined;
  return {
    schema: "weftend.intake.appeal/1",
    policyId,
    artifactId: mint.input.rootDigest,
    mintId: mint.digests.mintDigest,
    topReasonCodes,
    receiptDigests: boundedReceipts,
    ...(probeScriptDigest ? { probeScriptDigest } : {}),
  };
};

export const buildIntakeDecisionV1 = (
  mint: WeftendMintPackageV1,
  policyInput: WeftEndPolicyV1,
  options: IntakeDecisionOptionsV1 = {}
): IntakeDecisionOutputsV1 => {
  const policy = canonicalizeWeftEndPolicyV1(policyInput);
  const policyId = computeWeftEndPolicyIdV1(policy);
  const profile = policy.profile;

  let reasons = stableSortUniqueReasonsV0(mint.grade.reasonCodes ?? []);
  const capSummary = buildCapSummary(mint, policy.bounds.maxCapsItems);

  const addReason = (code: string) => {
    if (reasons.includes(code)) return;
    reasons = stableSortUniqueReasonsV0([...reasons, code]);
  };

  let loop = true;
  while (loop) {
    loop = false;
    const topReasonCodes = truncateListWithMarker(reasons, policy.bounds.maxReasonCodes).items;
    const appealCandidate = buildAppealPayload(
      mint,
      policyId,
      topReasonCodes,
      policy.bounds.maxCapsItems,
      options.scriptText
    );
    const appealJson = canonicalJSON(appealCandidate);
    const appealBytes = utf8ByteLength(appealJson);
    if (policy.bounds.maxAppealBytes >= 0 && appealBytes > policy.bounds.maxAppealBytes) {
      if (!reasons.includes("APPEAL_OVERSIZE")) {
        addReason("APPEAL_OVERSIZE");
        loop = true;
        continue;
      }
    }

    const severity = computeSeverity(reasons, policy, profile);
    const disclosureRequired = shouldRequireDisclosure(severity, policy);
    if (disclosureRequired && !canProduceDisclosure(policy)) {
      if (!reasons.includes("DISCLOSURE_REQUIRED")) {
        addReason("DISCLOSURE_REQUIRED");
        loop = true;
      }
    }
  }

  const topReasonCodes = truncateListWithMarker(reasons, policy.bounds.maxReasonCodes).items;
  const severity = computeSeverity(reasons, policy, profile);
  const action = policy.severityAction[severity];
  const grade = gradeFromSeverity(severity);
  const disclosureRequired = shouldRequireDisclosure(severity, policy);
  let disclosure = "";
  if (disclosureRequired && canProduceDisclosure(policy)) {
    disclosure = buildDisclosure(
      {
        schema: "weftend.intake.decision/1",
        profile,
        policyId,
        artifactId: mint.input.rootDigest,
        mintId: mint.digests.mintDigest,
        grade,
        action,
        topReasonCodes,
        capSummary,
        disclosureDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        appealDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        decisionDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      topReasonCodes,
      capSummary,
      policy
    );
  } else if (disclosureRequired) {
    disclosure = truncateTextWithMarker(
      "DISCLOSURE_REQUIRED_UNAVAILABLE",
      Math.max(0, policy.bounds.maxDisclosureChars)
    ).value;
    if (!disclosure || disclosure.trim().length === 0) {
      disclosure = "DISCLOSURE_REQUIRED";
    }
  } else if (!disclosureRequired && canProduceDisclosure(policy)) {
    disclosure = truncateTextWithMarker("DISCLOSURE_NOT_REQUIRED", policy.bounds.maxDisclosureChars).value;
  }
  const disclosureDigest = computeDigest(disclosure);

  const appealCandidate = buildAppealPayload(
    mint,
    policyId,
    topReasonCodes,
    policy.bounds.maxCapsItems,
    options.scriptText
  );
  const appealJson = canonicalJSON(appealCandidate);
  const appealBytes = utf8ByteLength(appealJson);
  const appealOversize =
    policy.bounds.maxAppealBytes >= 0 && appealBytes > policy.bounds.maxAppealBytes;
  const appeal: IntakeAppealBundleV1 = appealOversize
    ? { schema: "weftend.intake.appeal/1", status: "OVERSIZE", bytes: appealBytes }
    : appealCandidate;
  const appealDigest = computeDigest(canonicalJSON(appeal));

  const decision: IntakeDecisionV1 = {
    schema: "weftend.intake.decision/1",
    profile,
    policyId,
    artifactId: mint.input.rootDigest,
    mintId: mint.digests.mintDigest,
    grade,
    action,
    topReasonCodes,
    capSummary,
    disclosureDigest,
    appealDigest,
    decisionDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  decision.decisionDigest = computeDecisionDigest(decision);

  return { decision, disclosure, appeal };
};
