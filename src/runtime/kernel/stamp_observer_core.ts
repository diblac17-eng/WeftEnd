// src/runtime/kernel/stamp_observer_core.ts
// Runtime stamp observation core (JS-compatible, deterministic).
// @ts-nocheck

import { canonicalJSONV0, stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0_core";

const tierRank = (tier) => {
  switch (tier) {
    case "T0":
      return 0;
    case "T1":
      return 1;
    case "T2":
      return 2;
    case "T3":
      return 3;
    default:
      return null;
  }
};

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isArray = (v) => Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const canonicalJSON = canonicalJSONV0;

const validateShopStampLocal = (x) => {
  const issues = [];
  if (!isRecord(x)) return ["MARKET_STAMP_INVALID"];

  const allowed = [
    "schema",
    "tier",
    "shopId",
    "policyDigest",
    "blockHash",
    "acceptDecision",
    "reasonCodes",
    "stampDigest",
    "signature",
  ];
  for (const k of Object.keys(x)) {
    if (!allowed.includes(k)) {
      issues.push("MARKET_FIELDS_INVALID");
      break;
    }
  }

  if (x.schema !== "retni.shopstamp/1") issues.push("MARKET_FIELDS_INVALID");

  const tRank = isNonEmptyString(x.tier) ? tierRank(x.tier) : null;
  if (tRank === null) issues.push("MARKET_TIER_INVALID");

  if (!isNonEmptyString(x.shopId)) issues.push("MARKET_FIELDS_INVALID");
  if (!isNonEmptyString(x.policyDigest)) issues.push("MARKET_FIELDS_INVALID");
  if (!isNonEmptyString(x.blockHash)) issues.push("MARKET_HASH_INVALID");
  if (!isNonEmptyString(x.stampDigest)) issues.push("MARKET_FIELDS_INVALID");

  if (x.acceptDecision !== "ACCEPT" && x.acceptDecision !== "REJECT") {
    issues.push("MARKET_FIELDS_INVALID");
  }

  if (!isArray(x.reasonCodes)) {
    issues.push("MARKET_FIELDS_INVALID");
  } else {
    for (let i = 0; i < x.reasonCodes.length; i++) {
      if (!isNonEmptyString(x.reasonCodes[i])) {
        issues.push("MARKET_FIELDS_INVALID");
        break;
      }
    }
    for (let i = 1; i < x.reasonCodes.length; i++) {
      if (x.reasonCodes[i - 1] > x.reasonCodes[i]) {
        issues.push("MARKET_SNAPSHOT_ORDER_INVALID");
        break;
      }
    }
  }

  if (x.signature !== undefined) {
    if (!isRecord(x.signature)) issues.push("SHAPE_INVALID");
    if (!isNonEmptyString(x.signature?.algo)) issues.push("FIELD_INVALID");
    if (!isNonEmptyString(x.signature?.keyId)) issues.push("FIELD_INVALID");
    if (!isNonEmptyString(x.signature?.sig)) issues.push("FIELD_INVALID");
  }

  return issues;
};

const signatureAssessment = (stamp, verifySignature, stampKeyAllowlist) => {
  if (!stamp.signature) return { sigStatus: "UNVERIFIED", reasonCodes: ["STAMP_SIG_MISSING"] };
  if (!verifySignature) return { sigStatus: "UNVERIFIED", reasonCodes: ["STAMP_SIG_PORT_MISSING"] };

  const allowlist = stampKeyAllowlist || {};
  const publicKey = allowlist[stamp.signature.keyId];
  if (!publicKey) return { sigStatus: "UNVERIFIED", reasonCodes: ["STAMP_SIG_KEY_UNKNOWN"] };

  let payloadCanonical = "";
  try {
    const { signature: _sig, ...body } = stamp;
    payloadCanonical = canonicalJSON(body);
  } catch {
    return { sigStatus: "BAD", reasonCodes: ["STAMP_SIG_INVALID"] };
  }

  const ok = verifySignature(payloadCanonical, stamp.signature, publicKey);
  if (!ok) return { sigStatus: "BAD", reasonCodes: ["STAMP_SIG_INVALID"] };
  return { sigStatus: "OK", reasonCodes: [] };
};

export const computeRuntimeObservedStamp = (opts) => {
  const reasons = [];
  const runtimeRank = tierRank(opts.runtimeTier);
  let status = "UNSTAMPED";
  let sigStatus = "UNVERIFIED";

  if (opts.runtimeTier && !opts.shopStamp) {
    reasons.push("STAMP_MISSING");
    return { status, sigStatus, reasonCodes: stableSortUniqueReasonsV0(reasons) };
  }

  if (opts.shopStamp) {
    const issues = validateShopStampLocal(opts.shopStamp);
    if (issues.length > 0) {
      reasons.push("STAMP_INVALID");
      return { status: "STAMP_INVALID", sigStatus, reasonCodes: stableSortUniqueReasonsV0(reasons) };
    }
    if (opts.shopStamp.blockHash !== opts.callerBlockHash) reasons.push("STAMP_INVALID");
    if (opts.shopStamp.acceptDecision !== "ACCEPT") reasons.push("STAMP_INVALID");

    const sigAssessment = signatureAssessment(opts.shopStamp, opts.verifySignature, opts.stampKeyAllowlist);
    sigStatus = sigAssessment.sigStatus;
    reasons.push(...sigAssessment.reasonCodes);

    const stampRank = tierRank(opts.shopStamp.tier);
    if (runtimeRank !== null && stampRank !== null && stampRank < runtimeRank) {
      reasons.push("TIER_VIOLATION");
    }

    status = reasons.length === 0 ? "STAMP_VERIFIED" : "STAMP_INVALID";
  }

  const out = { status };
  if (sigStatus) out.sigStatus = sigStatus;
  if (reasons.length > 0) out.reasonCodes = stableSortUniqueReasonsV0(reasons);
  return out;
};

export { canonicalJSON };
