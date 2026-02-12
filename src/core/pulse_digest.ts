// src/core/pulse_digest.ts
// Deterministic pulse + receipt summary canonicalization and hashing (v0).

import { canonicalJSON } from "./canon";
import { stableSortUniqueReasonsV0 } from "./trust_algebra_v0";
import type {
  PulseBodyV0,
  PulseCountsV0,
  PulseDigestSetV0,
  PulseSubjectV0,
  PulseV0,
  ReceiptSummaryV0,
} from "./types";

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const normalizePulseDigests = (digests?: PulseDigestSetV0): PulseDigestSetV0 | undefined => {
  if (!digests) return undefined;
  const out: PulseDigestSetV0 = {};
  if (isNonEmptyString(digests.releaseId)) out.releaseId = digests.releaseId;
  if (isNonEmptyString(digests.pathDigest)) out.pathDigest = digests.pathDigest;
  if (isNonEmptyString(digests.planHash)) out.planHash = digests.planHash;
  if (isNonEmptyString(digests.evidenceHead)) out.evidenceHead = digests.evidenceHead;
  return Object.keys(out).length > 0 ? out : undefined;
};

const normalizePulseCounts = (counts?: PulseCountsV0): PulseCountsV0 | undefined => {
  if (!counts) return undefined;
  const out: PulseCountsV0 = {};
  if (Number.isFinite(counts.capsRequested ?? NaN)) out.capsRequested = Number(counts.capsRequested);
  if (Number.isFinite(counts.capsDenied ?? NaN)) out.capsDenied = Number(counts.capsDenied);
  if (Number.isFinite(counts.tartarusNew ?? NaN)) out.tartarusNew = Number(counts.tartarusNew);
  return Object.keys(out).length > 0 ? out : undefined;
};

const normalizePulseSubject = (subject: PulseSubjectV0): PulseSubjectV0 => ({
  kind: subject.kind,
  id: subject.id,
});

export const normalizePulseBodyV0 = (pulse: PulseBodyV0 | PulseV0): PulseBodyV0 => {
  const reasonCodes = stableSortUniqueReasonsV0(pulse.reasonCodes ?? []);
  const digests = normalizePulseDigests(pulse.digests);
  const counts = normalizePulseCounts(pulse.counts);
  const out: PulseBodyV0 = {
    schema: "weftend.pulse/0",
    v: 0,
    pulseSeq: pulse.pulseSeq,
    kind: pulse.kind,
    subject: normalizePulseSubject(pulse.subject),
  };
  if (isNonEmptyString(pulse.capId)) out.capId = pulse.capId;
  if (reasonCodes.length > 0) out.reasonCodes = reasonCodes;
  if (digests) out.digests = digests;
  if (counts) out.counts = counts;
  return out;
};

export const canonicalizePulseV0 = (pulse: PulseBodyV0 | PulseV0): string =>
  canonicalJSON(normalizePulseBodyV0(pulse));

export const computePulseDigestV0 = (pulse: PulseBodyV0 | PulseV0): string =>
  `fnv1a32:${fnv1a32(canonicalizePulseV0(pulse))}`;

export const sealPulseV0 = (pulse: PulseBodyV0 | PulseV0): PulseV0 => ({
  ...normalizePulseBodyV0(pulse),
  pulseDigest: computePulseDigestV0(pulse),
});

export const normalizeReceiptSummaryV0 = (summary: ReceiptSummaryV0): ReceiptSummaryV0 => {
  const bindTo = summary.bindTo || ({} as ReceiptSummaryV0["bindTo"]);
  const out: ReceiptSummaryV0 = {
    schema: "weftend.receiptSummary/0",
    v: 0,
    total: summary.total,
    denies: summary.denies,
    quarantines: summary.quarantines,
    bindTo: {
      releaseId: bindTo.releaseId,
      pathDigest: bindTo.pathDigest,
    },
    receiptDigest: summary.receiptDigest,
  };
  if (isNonEmptyString(summary.lastReceiptId)) out.lastReceiptId = summary.lastReceiptId;
  return out;
};

export const canonicalizeReceiptSummaryV0 = (summary: ReceiptSummaryV0): string => {
  const normalized = normalizeReceiptSummaryV0(summary);
  const { receiptDigest: _ignored, ...body } = normalized as ReceiptSummaryV0 & { receiptDigest?: string };
  return canonicalJSON(body);
};

export const computeReceiptSummaryDigestV0 = (summary: ReceiptSummaryV0): string =>
  `fnv1a32:${fnv1a32(canonicalizeReceiptSummaryV0(summary))}`;
