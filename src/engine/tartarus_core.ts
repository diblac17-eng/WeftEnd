// src/engine/tartarus_core.ts
// Tartarus core (JS-compatible, deterministic).
// @ts-nocheck

import {
  canonicalJSONV0,
  stableSortUniqueReasonsV0,
  stableSortUniqueStringsV0,
} from "../core/trust_algebra_v0_core";

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const computeRecordIdV0 = (recordSansId) => {
  const canon = canonicalJSONV0(recordSansId);
  return `fnv1a32:${fnv1a32(canon)}`;
};

const secretCaps = new Set([
  "id.sign",
  "auth.password.submit",
  "payment.tokenize",
  "storage.writeSecret",
  "ui.input.capture",
  "ui.secret.read",
  "ui.secret.emit",
  "storage.secret.write",
  "net.secret.send",
  "clipboard.read",
  "clipboard.write",
  "diag.raw",
]);

const hasReason = (reasons, code) => reasons.includes(code);
const hasReasonPrefix = (reasons, prefix) => reasons.some((r) => r.startsWith(prefix));

const mapKind = (kind) => {
  switch (kind) {
    case "stamp.missing":
      return { severity: "QUARANTINE", remedy: "CONTACT_SHOP" };
    case "stamp.invalid":
      return { severity: "QUARANTINE", remedy: "CONTACT_SHOP" };
    case "tier.violation":
      return { severity: "QUARANTINE", remedy: "MOVE_TIER_DOWN" };
    case "cap.replay":
      return { severity: "DENY", remedy: "NONE" };
    case "membrane.selftest.failed":
      return { severity: "DENY", remedy: "DOWNGRADE_MODE" };
    case "secretzone.unavailable":
      return { severity: "DENY", remedy: "DOWNGRADE_MODE" };
    case "secret.leak.attempt":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "artifact.mismatch":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "pkg.locator.mismatch":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "evidence.digest.mismatch":
      return { severity: "DENY", remedy: "PROVIDE_EVIDENCE" };
    case "release.manifest.invalid":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "release.signature.bad":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "release.manifest.mismatch":
      return { severity: "DENY", remedy: "DOWNGRADE_MODE" };
    case "history.invalid":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "history.signature.bad":
      return { severity: "QUARANTINE", remedy: "REBUILD_FROM_TRUSTED" };
    case "history.link.mismatch":
      return { severity: "QUARANTINE", remedy: "CONTACT_SHOP" };
    case "market.takedown.active":
      return { severity: "QUARANTINE", remedy: "CONTACT_SHOP" };
    case "market.ban.active":
      return { severity: "DENY", remedy: "NONE" };
    case "market.allowlist.missing":
      return { severity: "QUARANTINE", remedy: "PROVIDE_EVIDENCE" };
    case "market.evidence.missing":
      return { severity: "QUARANTINE", remedy: "PROVIDE_EVIDENCE" };
    default:
      return { severity: "DENY", remedy: "NONE" };
  }
};

export const classifyViolationV0 = (input) => {
  const reasonCodes = stableSortUniqueReasonsV0(input.reasonCodes || [], {
    subject: input.blockHash,
    locator: input.capId || input.blockHash,
  });
  const evidenceDigests = stableSortUniqueStringsV0(input.evidenceDigests || []);

  let kind;
  if (hasReason(reasonCodes, "STAMP_MISSING")) {
    kind = "stamp.missing";
  } else if (
    hasReason(reasonCodes, "STAMP_INVALID") ||
    hasReason(reasonCodes, "STAMP_SIG_INVALID") ||
    hasReason(reasonCodes, "STAMP_SIG_PORT_MISSING")
  ) {
    kind = "stamp.invalid";
  } else if (hasReason(reasonCodes, "TIER_VIOLATION")) {
    kind = "tier.violation";
  } else if (hasReason(reasonCodes, "REPLAY_DETECTED")) {
    kind = "cap.replay";
  } else if (hasReason(reasonCodes, "TRUST_PKG_LOCATOR_MISMATCH")) {
    kind = "pkg.locator.mismatch";
  } else if (hasReason(reasonCodes, "ARTIFACT_DIGEST_MISMATCH")) {
    kind = "artifact.mismatch";
  } else if (hasReason(reasonCodes, "TAKEDOWN_ACTIVE")) {
    kind = "market.takedown.active";
  } else if (hasReason(reasonCodes, "BANNED")) {
    kind = "market.ban.active";
  } else if (hasReason(reasonCodes, "ALLOWLIST_REQUIRED")) {
    kind = "market.allowlist.missing";
  } else if (hasReasonPrefix(reasonCodes, "MISSING_EVIDENCE:")) {
    kind = "market.evidence.missing";
  } else if (hasReasonPrefix(reasonCodes, "SANDBOX_HARDENING_FAILED:")) {
    kind = "membrane.selftest.failed";
  } else if (hasReason(reasonCodes, "EVIDENCE_DIGEST_MISMATCH")) {
    kind = "evidence.digest.mismatch";
  } else if (hasReason(reasonCodes, "RELEASE_SIGNATURE_BAD")) {
    kind = "release.signature.bad";
  } else if (
    hasReason(reasonCodes, "RELEASE_PLANDIGEST_MISMATCH") ||
    hasReason(reasonCodes, "RELEASE_BLOCKSET_MISMATCH") ||
    hasReason(reasonCodes, "PATH_DIGEST_MISMATCH")
  ) {
    kind = "release.manifest.mismatch";
  } else if (
    hasReason(reasonCodes, "RELEASE_MANIFEST_INVALID") ||
    hasReason(reasonCodes, "RELEASE_MANIFEST_MISSING") ||
    hasReason(reasonCodes, "PATH_DIGEST_MISSING")
  ) {
    kind = "release.manifest.invalid";
  } else if (hasReason(reasonCodes, "SECRET_ZONE_UNAVAILABLE") && input.capId && secretCaps.has(input.capId)) {
    kind = "secretzone.unavailable";
  } else if (input.kindHint) {
    kind = input.kindHint;
  } else {
    kind = "cap.replay";
  }

  const mapped = mapKind(kind);

  const recordSansId = {
    schema: "weftend.tartarus/0",
    planDigest: input.planDigest,
    blockHash: input.blockHash,
    kind,
    severity: mapped.severity,
    remedy: mapped.remedy,
    reasonCodes,
  };

  if (input.stampDigest) recordSansId.stampDigest = input.stampDigest;
  if (evidenceDigests.length > 0) recordSansId.evidenceDigests = evidenceDigests;
  if (typeof input.seq === "number") recordSansId.seq = input.seq;

  return {
    ...recordSansId,
    recordId: computeRecordIdV0(recordSansId),
  };
};
