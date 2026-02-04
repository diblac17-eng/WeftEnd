/* src/engine/verifiers/keytrans-inclusion.ts */
/**
 * keytrans.inclusion.v1 verifier (pure, deterministic).
 */

import { canonicalJSON } from "../../core/canon";
import { stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import type { EvidenceRecord, EvidenceVerifyResult, NormalizedClaim } from "../../core/types";
import type { EvidenceVerifyContext } from "../evidence";

const MAX_KEYTRANS_PAYLOAD_BYTES = 4096;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDigestString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && !/\s/.test(value) && value.includes(":");

type KeytransPayload = {
  directoryHeadDigest?: unknown;
  keyIdDigest?: unknown;
  proofDigest?: unknown;
};

const validatePayload = (payload: KeytransPayload | null): string[] => {
  const reasons: string[] = [];
  if (!payload) return ["KEYTRANS_INVALID"];

  const allowed = new Set(["directoryHeadDigest", "keyIdDigest", "proofDigest"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      reasons.push("KEYTRANS_INVALID");
      break;
    }
  }

  if (payload.directoryHeadDigest !== undefined && !isDigestString(payload.directoryHeadDigest)) {
    reasons.push("KEYTRANS_DIGEST_INVALID");
  }
  if (payload.keyIdDigest !== undefined && !isDigestString(payload.keyIdDigest)) {
    reasons.push("KEYTRANS_DIGEST_INVALID");
  }
  if (payload.proofDigest !== undefined && !isDigestString(payload.proofDigest)) {
    reasons.push("KEYTRANS_DIGEST_INVALID");
  }

  try {
    const canon = canonicalJSON(payload);
    if (canon.length > MAX_KEYTRANS_PAYLOAD_BYTES) reasons.push("KEYTRANS_PAYLOAD_TOO_LARGE");
  } catch {
    reasons.push("KEYTRANS_INVALID");
  }

  return stableSortUniqueReasonsV0(reasons);
};

export function verifyKeytransInclusionV0(record: EvidenceRecord, _context: EvidenceVerifyContext): EvidenceVerifyResult {
  const payload = isRecord(record.payload) ? (record.payload as KeytransPayload) : null;
  const reasonCodes = validatePayload(payload);

  const digestSource =
    (payload && isDigestString(payload.directoryHeadDigest) && payload.directoryHeadDigest) ||
    (payload && isDigestString(payload.keyIdDigest) && payload.keyIdDigest) ||
    "unknown";

  const claim: NormalizedClaim = {
    claimId: `keytrans:${digestSource}`,
    evidenceKind: "keytrans.inclusion.v1",
    normalized: {
      type: "keytrans.inclusion",
      version: "1",
      subjectId: isDigestString(payload?.keyIdDigest) ? (payload?.keyIdDigest as string) : undefined,
      fields: {
        directoryHeadDigest: payload?.directoryHeadDigest,
        keyIdDigest: payload?.keyIdDigest,
      },
    },
  };

  if (reasonCodes.length > 0) {
    return {
      evidenceId: record.evidenceId || "",
      kind: record.kind,
      status: "UNVERIFIED",
      reasonCodes,
      verifierId: "keytrans.inclusion",
      verifierVersion: "1",
      normalizedClaims: [claim],
    };
  }

  return {
    evidenceId: record.evidenceId || "",
    kind: record.kind,
    status: "VERIFIED",
    reasonCodes: [],
    verifierId: "keytrans.inclusion",
    verifierVersion: "1",
    normalizedClaims: [claim],
  };
}

export const keytransInclusionVerifier = {
  kind: "keytrans.inclusion.v1",
  verifierId: "keytrans.inclusion",
  verifierVersion: "1",
  verify: verifyKeytransInclusionV0,
};
