// src/engine/portal_model_core.ts
// PortalModel core (JS-compatible, deterministic, proof-only).
// @ts-nocheck

import {
  canonicalJSONV0,
  stableSortUniqueReasonsV0,
  stableSortUniqueStringsV0,
  truncateReasonDetailV0,
} from "../core/trust_algebra_v0_core";
import { computeReceiptSummaryDigestV0 } from "../core/pulse_digest_core";

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

export const MAX_PORTAL_BLOCKS = 512;
export const MAX_TARTARUS_PER_BLOCK = 16;
export const MAX_TARTARUS_TOTAL = 1024;
export const MAX_STAMPS_PER_BLOCK = 16;
export const MAX_CAPS_PER_BLOCK = 64;
export const MAX_STR_BYTES = 512;
export const MAX_PROJECTION_TRUNCATIONS = MAX_PORTAL_BLOCKS * 6 + 4;
export const MAX_PULSES_PER_BLOCK = 8;
export const MAX_PULSES_RELEASE = 32;
export const MAX_PULSE_REASON_CODES = 32;

const stableSortBy = (items, key) =>
  items
    .map((v, i) => ({ v, i, k: key(v) }))
    .sort((a, b) => {
      const c = a.k.localeCompare(b.k);
      if (c !== 0) return c;
      return a.i - b.i;
    })
    .map((x) => x.v);

const truncatePortalString = (value) => {
  if (!isNonEmptyString(value)) return "";
  const truncated = truncateReasonDetailV0(String(value), MAX_STR_BYTES);
  return truncated || "";
};

const normalizePortalString = (value) => {
  const truncated = truncatePortalString(value);
  return isNonEmptyString(truncated) ? truncated : undefined;
};

const normalizeProjectionTruncation = (entry) => {
  if (!entry || entry.code !== "PORTAL_PROJECTION_TRUNCATED") return null;
  const section = normalizePortalString(entry.section);
  if (!section) return null;
  const kept = Number.isFinite(entry.kept) ? Math.max(0, Math.floor(entry.kept)) : 0;
  const dropped = Number.isFinite(entry.dropped) ? Math.max(0, Math.floor(entry.dropped)) : 0;
  if (dropped <= 0) return null;
  return {
    code: "PORTAL_PROJECTION_TRUNCATED",
    section,
    kept,
    dropped,
  };
};

const addProjectionTruncation = (truncations, section, kept, dropped) => {
  if (dropped <= 0) return;
  const normalizedSection = normalizePortalString(section) ?? "";
  truncations.push({
    code: "PORTAL_PROJECTION_TRUNCATED",
    section: normalizedSection,
    kept: Math.max(0, Math.floor(kept)),
    dropped: Math.max(0, Math.floor(dropped)),
  });
};

const normalizeStringList = (items, limit, section, truncations) => {
  const values = Array.isArray(items) ? items : [];
  const normalized = stableSortUniqueStringsV0(
    values.filter(isNonEmptyString).map((v) => truncatePortalString(v)).filter(isNonEmptyString)
  );
  if (normalized.length > limit) {
    addProjectionTruncation(truncations, section, limit, normalized.length - limit);
    return normalized.slice(0, limit);
  }
  return normalized;
};

const truncateSortedList = (items, limit, section, truncations) => {
  const list = Array.isArray(items) ? items : [];
  if (list.length > limit) {
    addProjectionTruncation(truncations, section, limit, list.length - limit);
    return list.slice(0, limit);
  }
  return list;
};

const safeCanonicalJSON = (v) => {
  try {
    return canonicalJSONV0(v);
  } catch {
    return null;
  }
};

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const digestEvidence = (env) => {
  const canon = safeCanonicalJSON(env.payload);
  const basis = canon ?? "CANONICAL_INVALID";
  return `fnv1a32:${fnv1a32(`${env.kind}\u0000${basis}`)}`;
};

const normalizeRenderState = (verify) => {
  if (!verify) return { state: "UNVERIFIED", reasonCodes: ["VERIFICATION_MISSING"] };

  const reasons = stableSortUniqueReasonsV0(verify.reasonCodes || []);
  if (verify.status !== "VERIFIED" || reasons.length > 0) {
    return { state: "UNVERIFIED", reasonCodes: reasons.length ? reasons : ["UNVERIFIED"] };
  }
  return { state: "VERIFIED" };
};

const normalizeDeniedCaps = (deniedCaps, requestedCaps, eligibleCaps, sectionPrefix, truncations) => {
  const eligible = new Set(eligibleCaps);
  const base = deniedCaps && deniedCaps.length > 0
    ? deniedCaps
    : requestedCaps
        .filter((capId) => !eligible.has(capId))
        .map((capId) => ({ capId, reasonCodes: ["CAP_NOT_ELIGIBLE"] }));

  const normalized = stableSortBy(
    base.filter((d) => isNonEmptyString(d.capId)),
    (d) => String(d.capId)
  ).map((d) => ({
    capId: truncatePortalString(d.capId),
    reasonCodes: stableSortUniqueReasonsV0(
      d.reasonCodes && d.reasonCodes.length ? d.reasonCodes : ["CAP_DENIED"]
    ),
  })).filter((d) => isNonEmptyString(d.capId));

  return truncateSortedList(
    normalized,
    MAX_CAPS_PER_BLOCK,
    `${sectionPrefix}:deniedCaps`,
    truncations
  );
};

const normalizeDeniedCapsList = (deniedCaps, sectionPrefix, truncations) => {
  const base = Array.isArray(deniedCaps) ? deniedCaps : [];
  const normalized = stableSortBy(
    base.filter((d) => isNonEmptyString(d.capId)),
    (d) => String(d.capId)
  ).map((d) => ({
    capId: truncatePortalString(d.capId),
    reasonCodes: stableSortUniqueReasonsV0(d.reasonCodes || []),
  })).filter((d) => isNonEmptyString(d.capId));

  return truncateSortedList(
    normalized,
    MAX_CAPS_PER_BLOCK,
    `${sectionPrefix}:deniedCaps`,
    truncations
  );
};

const collectEvidenceKinds = (expr, out) => {
  if (!expr || typeof expr !== "object") return;
  if (expr.kind === "evidence") {
    if (isNonEmptyString(expr.evidenceKind)) out.push(expr.evidenceKind);
    return;
  }
  if (expr.kind === "allOf" || expr.kind === "anyOf") {
    const items = Array.isArray(expr.items) ? expr.items : [];
    items.forEach((item) => collectEvidenceKinds(item, out));
  }
};

const extractUnsupportedKinds = (deniedCaps) => {
  const out = new Set();
  (deniedCaps || []).forEach((deny) => {
    const codes = deny.reasonCodes || [];
    codes.forEach((code) => {
      if (typeof code === "string" && code.startsWith("VERIFIER_UNAVAILABLE:")) {
        out.add(code.slice("VERIFIER_UNAVAILABLE:".length));
      }
    });
  });
  return out;
};

const buildCapEvidence = (block, deniedCaps) => {
  const requirements = block.capEvidenceRequirements || [];
  if (!requirements || requirements.length === 0) return undefined;

  const records = block.evidenceRecords || [];
  const results = block.evidenceResults || [];
  const recordKinds = new Set(records.map((record) => record.kind).filter(isNonEmptyString));
  const resultsByKind = new Map();
  results.forEach((res) => {
    if (!isNonEmptyString(res.kind)) return;
    const entry = resultsByKind.get(res.kind) || [];
    entry.push(res);
    resultsByKind.set(res.kind, entry);
  });

  const unsupported = extractUnsupportedKinds(deniedCaps);

  const sortedReqs = stableSortBy(requirements, (r) => r.capId || "");
  return sortedReqs.map((req) => {
    const kinds = [];
    collectEvidenceKinds(req.requires, kinds);
    const uniqueKinds = stableSortUniqueStringsV0(kinds);

    const evidence = uniqueKinds.map((kind) => {
      if (unsupported.has(kind)) {
        return {
          evidenceKind: kind,
          status: "UNSUPPORTED",
          reasonCodes: [`VERIFIER_UNAVAILABLE:${kind}`],
        };
      }

      const resList = resultsByKind.get(kind) || [];
      const verified = resList.some((r) => r.status === "VERIFIED");
      if (verified) return { evidenceKind: kind, status: "VERIFIED" };

      if (resList.length > 0) {
        const reasons = stableSortUniqueReasonsV0(resList.flatMap((r) => r.reasonCodes || []));
        return {
          evidenceKind: kind,
          status: "UNVERIFIED",
          reasonCodes: reasons.length ? reasons : [`EVIDENCE_UNVERIFIED:${kind}`],
        };
      }

      if (recordKinds.has(kind)) {
        return {
          evidenceKind: kind,
          status: "UNVERIFIED",
          reasonCodes: ["VERIFICATION_MISSING"],
        };
      }

      return {
        evidenceKind: kind,
        status: "MISSING",
        reasonCodes: [`EVIDENCE_MISSING:${kind}`],
      };
    });

    return {
      capId: req.capId,
      evidence: stableSortBy(evidence, (e) => e.evidenceKind),
    };
  });
};

const normalizeCapEvidenceList = (capEvidence, sectionPrefix, truncations) => {
  if (!capEvidence || capEvidence.length === 0) return undefined;
  const normalized = capEvidence
    .map((entry) => {
      const capId = isNonEmptyString(entry.capId) ? truncatePortalString(entry.capId) : "";
      if (!isNonEmptyString(capId)) return null;
      const evidence = stableSortBy(entry.evidence || [], (e) => String(e.evidenceKind || "")).map((e) => ({
        evidenceKind: truncatePortalString(e.evidenceKind),
        status: e.status,
        reasonCodes: stableSortUniqueReasonsV0(e.reasonCodes || []),
      }));
      return { capId, evidence };
    })
    .filter(Boolean);

  const sorted = stableSortBy(normalized, (entry) => entry.capId);
  const capped = truncateSortedList(sorted, MAX_CAPS_PER_BLOCK, `${sectionPrefix}:capEvidence`, truncations);
  return capped.length > 0 ? capped : undefined;
};

const normalizeExecutionMode = (value) => {
  if (value === "strict" || value === "compatible" || value === "legacy") return value;
  return "legacy";
};

const normalizeRenderStateValue = (value) => (value === "VERIFIED" ? "VERIFIED" : "UNVERIFIED");

const normalizeEvidenceSummaries = (items, sectionPrefix, truncations) => {
  const list = Array.isArray(items) ? items : [];
  const normalized = list.map((entry) => {
    const evidenceKind = truncatePortalString(entry.evidenceKind);
    if (!isNonEmptyString(evidenceKind)) return null;
    const evidenceDigest = truncatePortalString(entry.evidenceDigest);
    const status = entry.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
    const issuerId = normalizePortalString(entry.issuerId);
    const reasonCodes = stableSortUniqueReasonsV0(entry.reasonCodes || []);
    const out = { evidenceKind, evidenceDigest, status };
    if (issuerId) out.issuerId = issuerId;
    if (reasonCodes.length > 0) out.reasonCodes = reasonCodes;
    return out;
  }).filter(Boolean);

  const sorted = stableSortBy(
    normalized,
    (e) => `${String(e.evidenceKind || "")}\u0000${String(e.evidenceDigest || "")}`
  );
  return truncateSortedList(sorted, MAX_STAMPS_PER_BLOCK, `${sectionPrefix}:evidence`, truncations);
};

const capProjectionTruncations = (entries) => {
  const merged = new Map();
  (entries || []).forEach((entry) => {
    const normalized = normalizeProjectionTruncation(entry);
    if (!normalized) return;
    const existing = merged.get(normalized.section);
    if (!existing) {
      merged.set(normalized.section, normalized);
      return;
    }
    merged.set(normalized.section, {
      code: "PORTAL_PROJECTION_TRUNCATED",
      section: normalized.section,
      kept: Math.max(existing.kept, normalized.kept),
      dropped: Math.max(existing.dropped, normalized.dropped),
    });
  });

  let list = stableSortBy(
    Array.from(merged.values()),
    (t) => `${t.section}\u0000${String(t.kept).padStart(8, "0")}\u0000${String(t.dropped).padStart(8, "0")}`
  );

  if (list.length > MAX_PROJECTION_TRUNCATIONS) {
    const withoutMeta = list.filter((entry) => entry.section !== "projectionTruncations");
    const kept = Math.max(0, Math.min(withoutMeta.length, MAX_PROJECTION_TRUNCATIONS - 1));
    const dropped = Math.max(0, withoutMeta.length - kept);
    const trimmed = withoutMeta.slice(0, kept);
    if (dropped > 0) {
      trimmed.push({
        code: "PORTAL_PROJECTION_TRUNCATED",
        section: "projectionTruncations",
        kept,
        dropped,
      });
    }
    list = stableSortBy(
      trimmed,
      (t) => `${t.section}\u0000${String(t.kept).padStart(8, "0")}\u0000${String(t.dropped).padStart(8, "0")}`
    );
  }

  return list;
};

const mergeProjectionTruncations = (existing, added) =>
  capProjectionTruncations([...(existing || []), ...(added || [])]);

const normalizeStampStatus = (value) => {
  if (value === "STAMP_VERIFIED" || value === "STAMP_INVALID" || value === "UNSTAMPED") return value;
  return "UNSTAMPED";
};

const normalizeStampSigStatus = (value) => {
  if (value === "OK" || value === "BAD" || value === "UNVERIFIED") return value;
  return "UNVERIFIED";
};

const normalizeRuntimeObservedStamp = (value) => {
  if (!value) return undefined;
  const status = normalizeStampStatus(value.status);
  const sigStatus = value.sigStatus ? normalizeStampSigStatus(value.sigStatus) : undefined;
  const reasonCodes = stableSortUniqueReasonsV0(value.reasonCodes || []);
  const out = { status };
  if (sigStatus) out.sigStatus = sigStatus;
  if (reasonCodes.length > 0) out.reasonCodes = reasonCodes;
  return out;
};

const normalizePulseKind = (value) => {
  if (value === "PUBLISH" || value === "LOAD" || value === "CAP_REQUEST" || value === "CAP_DENY" || value === "CAP_ALLOW" || value === "EXIT") {
    return value;
  }
  return null;
};

const normalizePulseSubject = (value) => {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind === "release" || value.kind === "block" ? value.kind : null;
  const id = normalizePortalString(value.id);
  if (!kind || !id) return null;
  return { kind, id };
};

const normalizePulse = (pulse, sectionPrefix, truncations) => {
  if (!pulse || typeof pulse !== "object") return null;
  const kind = normalizePulseKind(pulse.kind);
  const subject = normalizePulseSubject(pulse.subject);
  const pulseSeq = Number.isFinite(pulse.pulseSeq) ? Math.max(0, Math.floor(pulse.pulseSeq)) : null;
  const pulseDigest = normalizePortalString(pulse.pulseDigest);
  if (!kind || !subject || pulseSeq === null || !pulseDigest) return null;

  const out = {
    schema: "weftend.pulse/0",
    v: 0,
    pulseSeq,
    kind,
    subject,
    pulseDigest,
  };

  const capId = normalizePortalString(pulse.capId);
  if (capId) out.capId = capId;

  const reasonCodes = normalizeStringList(
    pulse.reasonCodes || [],
    MAX_PULSE_REASON_CODES,
    `${sectionPrefix}:reasonCodes`,
    truncations
  );
  if (reasonCodes.length > 0) out.reasonCodes = reasonCodes;

  if (pulse.digests && typeof pulse.digests === "object") {
    const digests = {};
    const releaseId = normalizePortalString(pulse.digests.releaseId);
    const pathDigest = normalizePortalString(pulse.digests.pathDigest);
    const planHash = normalizePortalString(pulse.digests.planHash);
    const evidenceHead = normalizePortalString(pulse.digests.evidenceHead);
    if (releaseId) digests.releaseId = releaseId;
    if (pathDigest) digests.pathDigest = pathDigest;
    if (planHash) digests.planHash = planHash;
    if (evidenceHead) digests.evidenceHead = evidenceHead;
    if (Object.keys(digests).length > 0) out.digests = digests;
  }

  if (pulse.counts && typeof pulse.counts === "object") {
    const counts = {};
    const capsRequested = Number(pulse.counts.capsRequested ?? NaN);
    const capsDenied = Number(pulse.counts.capsDenied ?? NaN);
    const tartarusNew = Number(pulse.counts.tartarusNew ?? NaN);
    if (Number.isFinite(capsRequested)) counts.capsRequested = Math.max(0, Math.floor(capsRequested));
    if (Number.isFinite(capsDenied)) counts.capsDenied = Math.max(0, Math.floor(capsDenied));
    if (Number.isFinite(tartarusNew)) counts.tartarusNew = Math.max(0, Math.floor(tartarusNew));
    if (Object.keys(counts).length > 0) out.counts = counts;
  }

  return out;
};

const normalizePulseList = (pulses, limit, sectionPrefix, truncations) => {
  const list = Array.isArray(pulses) ? pulses : [];
  const normalized = list
    .map((pulse) => normalizePulse(pulse, sectionPrefix, truncations))
    .filter(Boolean);
  const sorted = stableSortBy(
    normalized,
    (p) => `${String(p.pulseSeq).padStart(12, "0")}\u0000${String(p.pulseDigest || "")}`
  );
  return truncateSortedList(sorted, limit, sectionPrefix, truncations);
};

const normalizePulseSummary = (value, truncations) => {
  if (!value || typeof value !== "object") return undefined;
  const releasePulses = normalizePulseList(value.release, MAX_PULSES_RELEASE, "pulses:release", truncations);
  const blockEntries = Array.isArray(value.blocks) ? value.blocks : [];
  const normalizedBlocks = blockEntries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const blockHash = normalizePortalString(entry.blockHash);
      if (!blockHash) return null;
      const pulses = normalizePulseList(entry.pulses, MAX_PULSES_PER_BLOCK, `pulses:block:${blockHash}`, truncations);
      return { blockHash, pulses };
    })
    .filter((entry) => entry && entry.pulses && entry.pulses.length > 0);
  const sortedBlocks = stableSortBy(
    normalizedBlocks,
    (entry) => String(entry.blockHash || "")
  );
  const cappedBlocks = truncateSortedList(sortedBlocks, MAX_PORTAL_BLOCKS, "pulses:blocks", truncations);
  const out = {};
  if (releasePulses.length > 0) out.release = releasePulses;
  if (cappedBlocks.length > 0) out.blocks = cappedBlocks;
  return Object.keys(out).length > 0 ? out : undefined;
};

const normalizeReleaseStatus = (value) => {
  if (value === "OK" || value === "UNVERIFIED" || value === "MAYBE") return value;
  return undefined;
};

const normalizeHistoryStatus = (value) => {
  if (value === "OK" || value === "UNVERIFIED") return value;
  return undefined;
};

const normalizeBuildAttestation = (value, truncations) => {
  if (!value || typeof value !== "object") return undefined;
  const status =
    value.status === "VERIFIED" || value.status === "UNVERIFIED" || value.status === "MISSING"
      ? value.status
      : "UNVERIFIED";
  const required = typeof value.required === "boolean" ? value.required : undefined;
  const evidenceDigest = normalizePortalString(value.evidenceDigest);
  const reasonCodes = normalizeStringList(
    value.reasonCodes || [],
    MAX_CAPS_PER_BLOCK,
    "buildAttestation:reasonCodes",
    truncations
  );
  let summary;
  if (value.summary && typeof value.summary === "object") {
    const pipelineId = normalizePortalString(value.summary.pipelineId);
    const weftendVersion = normalizePortalString(value.summary.weftendVersion);
    const bundleHash = normalizePortalString(value.summary.bundleHash);
    const pathDigest = normalizePortalString(value.summary.pathDigest);
    const manifestHash = normalizePortalString(value.summary.manifestHash);
    if (pipelineId && weftendVersion && bundleHash && pathDigest && manifestHash) {
      summary = { pipelineId, weftendVersion, bundleHash, pathDigest, manifestHash };
    }
  }
  const out = { status };
  if (required !== undefined) out.required = required;
  if (evidenceDigest) out.evidenceDigest = evidenceDigest;
  if (reasonCodes && reasonCodes.length > 0) out.reasonCodes = reasonCodes;
  if (summary) out.summary = summary;
  return out;
};

const normalizeReceiptSummary = (value, releaseId, releasePathDigest) => {
  if (!value || typeof value !== "object") return { summary: undefined, verified: undefined };
  if (value.schema !== "weftend.receiptSummary/0" || value.v !== 0) {
    return { summary: undefined, verified: undefined };
  }
  const bindTo = value.bindTo && typeof value.bindTo === "object" ? value.bindTo : null;
  const bindReleaseId = bindTo ? normalizePortalString(bindTo.releaseId) : undefined;
  const bindPathDigest = bindTo ? normalizePortalString(bindTo.pathDigest) : undefined;
  const receiptDigest = normalizePortalString(value.receiptDigest);
  if (!bindReleaseId || !bindPathDigest || !receiptDigest) {
    return { summary: undefined, verified: undefined };
  }

  const totalRaw = Number(value.total ?? 0);
  const deniesRaw = Number(value.denies ?? 0);
  const quarantinesRaw = Number(value.quarantines ?? 0);
  const summary = {
    schema: "weftend.receiptSummary/0",
    v: 0,
    total: Number.isFinite(totalRaw) ? Math.max(0, Math.floor(totalRaw)) : 0,
    denies: Number.isFinite(deniesRaw) ? Math.max(0, Math.floor(deniesRaw)) : 0,
    quarantines: Number.isFinite(quarantinesRaw) ? Math.max(0, Math.floor(quarantinesRaw)) : 0,
    bindTo: {
      releaseId: bindReleaseId,
      pathDigest: bindPathDigest,
    },
    receiptDigest,
  };
  const lastReceiptId = normalizePortalString(value.lastReceiptId);
  if (lastReceiptId) summary.lastReceiptId = lastReceiptId;

  const expected = computeReceiptSummaryDigestV0(summary);
  const normalizedReleaseId = normalizePortalString(releaseId);
  const normalizedPathDigest = normalizePortalString(releasePathDigest);
  const verified =
    expected === receiptDigest &&
    normalizedReleaseId === bindReleaseId &&
    normalizedPathDigest === bindPathDigest
      ? true
      : undefined;

  return { summary, verified };
};

const normalizeTartarusRecord = (record) => {
  if (!record) return null;
  const reasonCodes = stableSortUniqueReasonsV0(record.reasonCodes || []);
  const evidenceDigests = stableSortUniqueStringsV0(
    (record.evidenceDigests || []).map((d) => truncatePortalString(d)).filter(isNonEmptyString)
  );
  const out = {
    schema: truncatePortalString(record.schema),
    recordId: truncatePortalString(record.recordId),
    planDigest: truncatePortalString(record.planDigest),
    blockHash: truncatePortalString(record.blockHash),
    kind: truncatePortalString(record.kind),
    severity: truncatePortalString(record.severity),
    remedy: truncatePortalString(record.remedy),
    reasonCodes,
  };
  if (record.stampDigest) out.stampDigest = truncatePortalString(record.stampDigest);
  if (evidenceDigests.length > 0) out.evidenceDigests = evidenceDigests;
  if (typeof record.seq === "number") out.seq = record.seq;
  return out;
};

const stableSortTartarusRecords = (records) =>
  (records || [])
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const sa = typeof a.v.seq === "number" ? a.v.seq : -1;
      const sb = typeof b.v.seq === "number" ? b.v.seq : -1;
      if (sa !== sb) return sb - sa;
      const ra = String(a.v.recordId || "");
      const rb = String(b.v.recordId || "");
      const c = ra.localeCompare(rb);
      if (c !== 0) return c;
      return a.i - b.i;
    })
    .map((x) => x.v);

const pickLatestTartarus = (records) => {
  if (!records || records.length === 0) return undefined;
  const withSeq = records.filter((r) => typeof r.seq === "number");
  if (withSeq.length > 0) {
    return withSeq
      .map((v, i) => ({ v, i }))
      .sort((a, b) => {
        const sa = a.v.seq;
        const sb = b.v.seq;
        if (sa !== sb) return sb - sa;
        const c = String(a.v.recordId || "").localeCompare(String(b.v.recordId || ""));
        if (c !== 0) return c;
        return a.i - b.i;
      })[0].v;
  }
  const sorted = stableSortBy(records, (r) => String(r.recordId || ""));
  return sorted[sorted.length - 1];
};

const buildTartarusSummary = (records) => {
  if (!records || records.length === 0) return null;
  const severities = ["INFO", "WARN", "DENY", "QUARANTINE"];
  const kinds = [
    "stamp.missing",
    "stamp.invalid",
    "tier.violation",
    "membrane.selftest.failed",
    "cap.replay",
    "secretzone.unavailable",
    "secret.leak.attempt",
    "artifact.mismatch",
    "pkg.locator.mismatch",
    "evidence.digest.mismatch",
    "release.manifest.invalid",
    "release.manifest.mismatch",
    "release.signature.bad",
    "history.invalid",
    "history.signature.bad",
    "history.link.mismatch",
    "market.takedown.active",
    "market.ban.active",
    "market.allowlist.missing",
    "market.evidence.missing",
  ];

  const bySeverity = {};
  const byKind = {};
  severities.forEach((s) => { bySeverity[s] = 0; });
  kinds.forEach((k) => { byKind[k] = 0; });

  records.forEach((rec) => {
    if (rec && bySeverity[rec.severity] !== undefined) bySeverity[rec.severity] += 1;
    if (rec && byKind[rec.kind] !== undefined) byKind[rec.kind] += 1;
  });

  return {
    total: records.length,
    bySeverity,
    byKind,
  };
};

const formatMismatchWarning = (kind, blockHash, proof, observed, reasonCodes) => {
  const reasonText = reasonCodes && reasonCodes.length > 0 ? reasonCodes.join("|") : "NO_REASON";
  return `RUNTIME_PROOF_MISMATCH:${kind}:${blockHash}:${proof}->${observed}:${reasonText}`;
};

const normalizeCountMap = (value) => {
  const out = {};
  if (!value || typeof value !== "object") return out;
  const keys = stableSortUniqueStringsV0(Object.keys(value));
  keys.forEach((key) => {
    const raw = Number(value[key] ?? 0);
    const normalized = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    out[key] = Math.min(normalized, MAX_TARTARUS_TOTAL);
  });
  return out;
};

export const applyPortalProjectionCapsV0 = (input) => {
  const truncations = [];
  const blocksSorted = stableSortBy(input && input.blocks ? input.blocks : [], (b) => String(b.blockHash || ""));
  const blocks = truncateSortedList(blocksSorted, MAX_PORTAL_BLOCKS, "blocks", truncations);

  const outBlocks = [];
  for (const block of blocks) {
    const blockHash = truncatePortalString(block.blockHash);
    const sectionPrefix = `block:${blockHash}`;
    const executionMode = normalizeExecutionMode(block.executionMode);
    const renderState = normalizeRenderStateValue(block.renderState);
    const requestedCaps = normalizeStringList(
      block.requestedCaps || [],
      MAX_CAPS_PER_BLOCK,
      `${sectionPrefix}:requestedCaps`,
      truncations
    );
    const eligibleCaps = normalizeStringList(
      block.eligibleCaps || [],
      MAX_CAPS_PER_BLOCK,
      `${sectionPrefix}:eligibleCaps`,
      truncations
    );
    const deniedCaps = normalizeDeniedCapsList(block.deniedCaps || [], sectionPrefix, truncations);
    const evidence = normalizeEvidenceSummaries(block.evidence || [], sectionPrefix, truncations);
    const capEvidence = normalizeCapEvidenceList(block.capEvidence || [], sectionPrefix, truncations);
    const receiptDecision =
      block.receiptDecision === "ALLOW" || block.receiptDecision === "DENY" ? block.receiptDecision : undefined;
    const receiptReasonCodes = stableSortUniqueReasonsV0(block.receiptReasonCodes || []);
    const stampStatus = normalizeStampStatus(block.stampStatus);
    const stampSigStatus = normalizeStampSigStatus(block.stampSigStatus);
    const runtimeObservedStamp = normalizeRuntimeObservedStamp(block.runtimeObservedStamp);
    const tartarusLatest = normalizeTartarusRecord(block.tartarusLatest);
    const marketId = normalizePortalString(block.marketId);
    const marketPolicyDigest = normalizePortalString(block.marketPolicyDigest);
    const receiptId = normalizePortalString(block.receiptId);
    const reasonCodes = stableSortUniqueReasonsV0(block.reasonCodes || []);

    const row = {
      blockHash,
      executionMode,
      renderState,
      requestedCaps,
      eligibleCaps,
      deniedCaps,
      evidence,
      capEvidence,
      tartarusLatest,
      marketId,
      marketPolicyDigest,
      receiptDecision,
      receiptId,
      receiptReasonCodes: receiptReasonCodes.length > 0 ? receiptReasonCodes : undefined,
      stampStatus,
      stampSigStatus,
      runtimeObservedStamp,
    };
    if (renderState === "UNVERIFIED" && reasonCodes.length > 0) row.reasonCodes = reasonCodes;

    outBlocks.push(row);
  }

  const summary = {
    totalBlocks: outBlocks.length,
    verifiedBlocks: outBlocks.filter((b) => b.renderState === "VERIFIED").length,
    unverifiedBlocks: outBlocks.filter((b) => b.renderState === "UNVERIFIED").length,
    modes: {
      strict: outBlocks.filter((b) => b.executionMode === "strict").length,
      compatible: outBlocks.filter((b) => b.executionMode === "compatible").length,
      legacy: outBlocks.filter((b) => b.executionMode === "legacy").length,
    },
  };

  const model = {
    schema: "retni.portalmodel/1",
    planDigest: truncatePortalString(input ? input.planDigest : ""),
    summary,
    blocks: outBlocks,
  };

  const releaseStatus = normalizeReleaseStatus(input && input.releaseStatus);
  const releaseReasonCodes = stableSortUniqueReasonsV0(input && input.releaseReasonCodes ? input.releaseReasonCodes : []);
  if (releaseStatus) model.releaseStatus = releaseStatus;
  if (releaseReasonCodes.length > 0) model.releaseReasonCodes = releaseReasonCodes;
  if (isNonEmptyString(input && input.releaseId)) model.releaseId = truncatePortalString(input.releaseId);
  if (isNonEmptyString(input && input.releasePathDigest)) {
    model.releasePathDigest = truncatePortalString(input.releasePathDigest);
  }

  const historyStatus = normalizeHistoryStatus(input && input.historyStatus);
  const historyReasonCodes = stableSortUniqueReasonsV0(input && input.historyReasonCodes ? input.historyReasonCodes : []);
  if (isNonEmptyString(input && input.historyHeadDigest)) {
    model.historyHeadDigest = truncatePortalString(input.historyHeadDigest);
  }
  if (historyStatus) model.historyStatus = historyStatus;
  if (historyReasonCodes.length > 0) model.historyReasonCodes = historyReasonCodes;

  if (isNonEmptyString(input && input.marketId)) model.marketId = truncatePortalString(input.marketId);
  if (isNonEmptyString(input && input.marketPolicyDigest)) {
    model.marketPolicyDigest = truncatePortalString(input.marketPolicyDigest);
  }

  const receiptInfo = normalizeReceiptSummary(
    input && input.receiptSummary,
    input && input.releaseId,
    input && input.releasePathDigest
  );
  if (receiptInfo.summary) model.receiptSummary = receiptInfo.summary;
  if (receiptInfo.verified) model.receiptVerified = true;

  const pulses = normalizePulseSummary(input && input.pulses, truncations);
  if (pulses) model.pulses = pulses;

  const buildAttestation = normalizeBuildAttestation(input && input.buildAttestation, truncations);
  if (buildAttestation) model.buildAttestation = buildAttestation;

  if (input && input.tartarus && typeof input.tartarus === "object") {
    const totalRaw = Number(input.tartarus.total ?? 0);
    const total = Number.isFinite(totalRaw) ? Math.max(0, Math.floor(totalRaw)) : 0;
    const cappedTotal = Math.min(total, MAX_TARTARUS_TOTAL);
    if (total > cappedTotal) {
      addProjectionTruncation(truncations, "tartarus.total", cappedTotal, total - cappedTotal);
    }
    model.tartarus = {
      total: cappedTotal,
      bySeverity: normalizeCountMap(input.tartarus.bySeverity),
      byKind: normalizeCountMap(input.tartarus.byKind),
    };
  }

  const warningsOut = stableSortUniqueStringsV0(
    (input && input.warnings ? input.warnings : [])
      .map((w) => truncatePortalString(String(w)))
      .filter(isNonEmptyString)
  );
  if (warningsOut.length > 0) model.warnings = warningsOut;

  const projectionTruncations = mergeProjectionTruncations(
    input && input.projectionTruncations ? input.projectionTruncations : [],
    truncations
  );
  if (projectionTruncations.length > 0) model.projectionTruncations = projectionTruncations;

  return model;
};

export const buildPortalModel = (input) => {
  const truncations = [];
  const warnings = [...(input.globalWarnings || [])];

  let seenCompatible = false;
  let seenLegacy = false;
  let invalidMode = false;
  let mismatchDetected = false;
  let recoveryScar = false;
  const blocksSorted = stableSortBy(input.blocks || [], (b) => String(b.blockHash || ""));
  const blocks = truncateSortedList(blocksSorted, MAX_PORTAL_BLOCKS, "blocks", truncations);

  const outBlocks = [];
  let tartarusRemaining = MAX_TARTARUS_TOTAL;
  let tartarusTotalOriginal = 0;
  let tartarusTotalKept = 0;
  const tartarusSummaryRecords = [];

  for (const block of blocks) {
    const blockHashRaw = isNonEmptyString(block.blockHash) ? String(block.blockHash) : "";
    const blockHash = truncatePortalString(blockHashRaw);
    const sectionPrefix = `block:${blockHash}`;
    let mode = block.executionMode;
    if (mode !== "strict" && mode !== "compatible" && mode !== "legacy") {
      mode = "legacy";
      invalidMode = true;
    }

    if (mode === "compatible") seenCompatible = true;
    if (mode === "legacy") seenLegacy = true;

    const requestedCaps = normalizeStringList(
      block.requestedCaps || [],
      MAX_CAPS_PER_BLOCK,
      `${sectionPrefix}:requestedCaps`,
      truncations
    );
    const eligibleFromGrants = (block.grantedCaps || []).map((g) => g.capId);
    const eligibleCaps = normalizeStringList(
      [...(block.eligibleCaps || []), ...eligibleFromGrants],
      MAX_CAPS_PER_BLOCK,
      `${sectionPrefix}:eligibleCaps`,
      truncations
    );

    const { state, reasonCodes } = normalizeRenderState(block.verifyResult);

    const evidenceSummaries = stableSortBy(
      block.evidenceRecords || [],
      (e) => `${String(e.kind || "")}\u0000${digestEvidence(e)}`
    ).map((e) => {
      const digest = digestEvidence(e);
      const issuerId = isNonEmptyString(e.meta && e.meta.issuedBy) ? e.meta.issuedBy : undefined;
      const issuer = normalizePortalString(issuerId);
      const summary = {
        evidenceKind: truncatePortalString(e.kind),
        evidenceDigest: truncatePortalString(digest),
        status: state,
      };
      if (issuer) summary.issuerId = issuer;
      if (state === "UNVERIFIED" && reasonCodes && reasonCodes.length > 0) {
        summary.reasonCodes = reasonCodes;
      }
      return summary;
    });

    const evidence = truncateSortedList(
      evidenceSummaries,
      MAX_STAMPS_PER_BLOCK,
      `${sectionPrefix}:evidence`,
      truncations
    );

    const deniedCaps = normalizeDeniedCaps(block.deniedCaps, requestedCaps, eligibleCaps, sectionPrefix, truncations);
    const capEvidence = normalizeCapEvidenceList(buildCapEvidence(block, deniedCaps), sectionPrefix, truncations);

    const receiptDecision =
      block.receiptDecision === "ALLOW" || block.receiptDecision === "DENY" ? block.receiptDecision : undefined;
    const receiptReasonCodes = stableSortUniqueReasonsV0(block.receiptReasonCodes || []);

    const stampStatus = normalizeStampStatus(block.stampStatus);
    const stampSigStatus = normalizeStampSigStatus(block.stampSigStatus);
    const runtimeObservedStamp = normalizeRuntimeObservedStamp(block.runtimeObservedStamp);
    const tartarusRecords = stableSortTartarusRecords(
      (block.tartarusRecords || []).map(normalizeTartarusRecord).filter(Boolean)
    );
    if (!recoveryScar) {
      recoveryScar = tartarusRecords.some((record) =>
        Array.isArray(record.reasonCodes) && record.reasonCodes.includes("ARTIFACT_RECOVERED")
      );
    }
    const perBlockOriginal = tartarusRecords.length;
    const perBlockLimited = tartarusRecords.slice(0, MAX_TARTARUS_PER_BLOCK);
    tartarusTotalOriginal += perBlockLimited.length;

    let perBlockKept = perBlockLimited;
    if (tartarusRemaining <= 0) {
      perBlockKept = [];
    } else if (perBlockLimited.length > tartarusRemaining) {
      perBlockKept = perBlockLimited.slice(0, tartarusRemaining);
    }
    tartarusRemaining = Math.max(0, tartarusRemaining - perBlockKept.length);
    tartarusTotalKept += perBlockKept.length;
    if (perBlockOriginal > perBlockKept.length) {
      addProjectionTruncation(
        truncations,
        `${sectionPrefix}:tartarus`,
        perBlockKept.length,
        perBlockOriginal - perBlockKept.length
      );
    }
    if (perBlockKept.length > 0) tartarusSummaryRecords.push(...perBlockKept);
    const tartarusLatest = pickLatestTartarus(perBlockKept);
    if (runtimeObservedStamp) {
      if (runtimeObservedStamp.status !== stampStatus) {
        mismatchDetected = true;
        warnings.push(
          formatMismatchWarning(
            "STAMP_STATUS",
            blockHash,
            stampStatus,
            runtimeObservedStamp.status,
            runtimeObservedStamp.reasonCodes
          )
        );
      }
      if (runtimeObservedStamp.sigStatus && runtimeObservedStamp.sigStatus !== stampSigStatus) {
        mismatchDetected = true;
        warnings.push(
          formatMismatchWarning(
            "STAMP_SIG_STATUS",
            blockHash,
            stampSigStatus,
            runtimeObservedStamp.sigStatus,
            runtimeObservedStamp.reasonCodes
          )
        );
      }
    }

    const row = {
      blockHash,
      executionMode: mode,
      renderState: state,
      requestedCaps,
      eligibleCaps,
      deniedCaps,
      evidence,
      capEvidence,
      tartarusLatest,
      marketId: normalizePortalString(block.marketId),
      marketPolicyDigest: normalizePortalString(block.marketPolicyDigest),
      receiptDecision,
      receiptId: normalizePortalString(block.receiptId),
      receiptReasonCodes: receiptReasonCodes.length > 0 ? receiptReasonCodes : undefined,
      stampStatus,
      stampSigStatus,
      runtimeObservedStamp,
    };

    if (state === "UNVERIFIED" && reasonCodes && reasonCodes.length > 0) {
      row.reasonCodes = reasonCodes;
    }

    outBlocks.push(row);
  }

  if (seenCompatible) warnings.push("UNGOVERNED_COMPATIBLE_MODE");
  if (seenLegacy) warnings.push("UNGOVERNED_LEGACY");
  if (invalidMode) warnings.push("EXECUTION_MODE_INVALID");
  if (mismatchDetected) warnings.push("RUNTIME_PROOF_MISMATCH");
  if (recoveryScar) warnings.push("ARTIFACT_RECOVERED");
  if (tartarusTotalOriginal > tartarusTotalKept) {
    addProjectionTruncation(
      truncations,
      "tartarus.total",
      tartarusTotalKept,
      tartarusTotalOriginal - tartarusTotalKept
    );
  }

  const summary = {
    totalBlocks: outBlocks.length,
    verifiedBlocks: outBlocks.filter((b) => b.renderState === "VERIFIED").length,
    unverifiedBlocks: outBlocks.filter((b) => b.renderState === "UNVERIFIED").length,
    modes: {
      strict: outBlocks.filter((b) => b.executionMode === "strict").length,
      compatible: outBlocks.filter((b) => b.executionMode === "compatible").length,
      legacy: outBlocks.filter((b) => b.executionMode === "legacy").length,
    },
  };

  const tartarus = buildTartarusSummary(tartarusSummaryRecords);

  const model = {
    schema: "retni.portalmodel/1",
    planDigest: truncatePortalString(input.planDigest),
    summary,
    blocks: outBlocks,
  };

  const releaseStatus = normalizeReleaseStatus(input.releaseStatus);
  const releaseReasonCodes = stableSortUniqueReasonsV0(input.releaseReasonCodes || []);
  if (releaseStatus) model.releaseStatus = releaseStatus;
  if (releaseReasonCodes.length > 0) model.releaseReasonCodes = releaseReasonCodes;
  if (isNonEmptyString(input.releaseId)) model.releaseId = truncatePortalString(input.releaseId);
  if (isNonEmptyString(input.releasePathDigest)) {
    model.releasePathDigest = truncatePortalString(input.releasePathDigest);
  }
  if (releaseStatus === "UNVERIFIED" || releaseStatus === "MAYBE") warnings.push("RELEASE_UNVERIFIED");

  const historyStatus = normalizeHistoryStatus(input.historyStatus);
  const historyReasonCodes = stableSortUniqueReasonsV0(input.historyReasonCodes || []);
  if (isNonEmptyString(input.historyHeadDigest)) {
    model.historyHeadDigest = truncatePortalString(input.historyHeadDigest);
  }
  if (historyStatus) model.historyStatus = historyStatus;
  if (historyReasonCodes.length > 0) model.historyReasonCodes = historyReasonCodes;

  if (isNonEmptyString(input.marketId)) model.marketId = truncatePortalString(input.marketId);
  if (isNonEmptyString(input.marketPolicyDigest)) {
    model.marketPolicyDigest = truncatePortalString(input.marketPolicyDigest);
  }
  if (input.receiptSummary) model.receiptSummary = input.receiptSummary;
  if (input.pulses) model.pulses = input.pulses;
  if (input.buildAttestation) model.buildAttestation = input.buildAttestation;

  const warningsOut = stableSortUniqueStringsV0(
    warnings.map((w) => truncatePortalString(String(w))).filter(isNonEmptyString)
  );
  const truncationsOut = stableSortBy(
    truncations,
    (t) => `${t.section}\u0000${String(t.kept).padStart(8, "0")}\u0000${String(t.dropped).padStart(8, "0")}`
  );

  if (tartarus) model.tartarus = tartarus;
  if (warningsOut.length > 0) model.warnings = warningsOut;
  if (truncationsOut.length > 0) model.projectionTruncations = truncationsOut;

  return applyPortalProjectionCapsV0(model);
};
