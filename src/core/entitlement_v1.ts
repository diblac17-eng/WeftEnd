// src/core/entitlement_v1.ts
// Offline entitlement schema helpers (v1).

import { canonicalJSON } from "./canon";
import { sha256HexV0 } from "./hash_v0";
import type { WeftendEntitlementPayloadV1 } from "./types";

const sha256 = (input: string): string => sha256HexV0(input);

const stableSortUnique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((v) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  out.sort((a, b) => a.localeCompare(b));
  return out;
};

export const canonicalizeWeftendEntitlementPayloadV1 = (
  payload: WeftendEntitlementPayloadV1
): WeftendEntitlementPayloadV1 => {
  return {
    schema: "weftend.entitlement/1",
    schemaVersion: 0,
    licenseId: payload.licenseId.trim(),
    customerId: payload.customerId.trim(),
    tier: payload.tier,
    features: stableSortUnique(payload.features ?? []).map((f) => f.trim()),
    issuedAt: payload.issuedAt.trim(),
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt.trim() } : {}),
    issuer: {
      keyId: payload.issuer.keyId.trim(),
      algo: "sig.ed25519.v0",
    },
  };
};

export const computeWeftendEntitlementDigestV1 = (payload: WeftendEntitlementPayloadV1): string => {
  const canon = canonicalJSON(canonicalizeWeftendEntitlementPayloadV1(payload));
  return `sha256:${sha256(canon)}`;
};
