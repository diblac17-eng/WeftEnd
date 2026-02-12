// src/core/pulse_digest_core.ts
// Deterministic pulse + receipt summary canonicalization and hashing (JS-compatible).
// @ts-nocheck

import { canonicalJSON } from "./canon";
import { sha256HexV0 } from "./hash_v0";
import { stableSortUniqueReasonsV0 } from "./trust_algebra_v0_core";

const sha256 = (input) => sha256HexV0(String(input ?? ""));

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const normalizePulseDigests = (digests) => {
  if (!digests) return undefined;
  const out = {};
  if (isNonEmptyString(digests.releaseId)) out.releaseId = digests.releaseId;
  if (isNonEmptyString(digests.pathDigest)) out.pathDigest = digests.pathDigest;
  if (isNonEmptyString(digests.planHash)) out.planHash = digests.planHash;
  if (isNonEmptyString(digests.evidenceHead)) out.evidenceHead = digests.evidenceHead;
  return Object.keys(out).length > 0 ? out : undefined;
};

const normalizePulseCounts = (counts) => {
  if (!counts) return undefined;
  const out = {};
  if (Number.isFinite(counts.capsRequested ?? NaN)) out.capsRequested = Number(counts.capsRequested);
  if (Number.isFinite(counts.capsDenied ?? NaN)) out.capsDenied = Number(counts.capsDenied);
  if (Number.isFinite(counts.tartarusNew ?? NaN)) out.tartarusNew = Number(counts.tartarusNew);
  return Object.keys(out).length > 0 ? out : undefined;
};

const normalizePulseSubject = (subject) => ({ kind: subject.kind, id: subject.id });

export const normalizePulseBodyV0 = (pulse) => {
  const reasonCodes = stableSortUniqueReasonsV0(pulse.reasonCodes || []);
  const digests = normalizePulseDigests(pulse.digests);
  const counts = normalizePulseCounts(pulse.counts);
  const out = {
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

export const canonicalizePulseV0 = (pulse) => canonicalJSON(normalizePulseBodyV0(pulse));

export const computePulseDigestV0 = (pulse) => `sha256:${sha256(canonicalizePulseV0(pulse))}`;

export const sealPulseV0 = (pulse) => ({
  ...normalizePulseBodyV0(pulse),
  pulseDigest: computePulseDigestV0(pulse),
});

export const normalizeReceiptSummaryV0 = (summary) => {
  const bindTo = summary.bindTo || {};
  const out = {
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

export const canonicalizeReceiptSummaryV0 = (summary) => {
  const normalized = normalizeReceiptSummaryV0(summary);
  const { receiptDigest: _ignored, ...body } = normalized;
  return canonicalJSON(body);
};

export const computeReceiptSummaryDigestV0 = (summary) =>
  `sha256:${sha256(canonicalizeReceiptSummaryV0(summary))}`;
