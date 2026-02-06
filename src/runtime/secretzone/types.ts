// src/runtime/secretzone/types.ts
// SecretZone boundary protocol (v0).

import type { ConsentClaimV0 } from "../../core/types";

export type SecretZoneMode = "strict-privacy";

export interface SecretZoneEnvelope {
  executionMode: SecretZoneMode;
  planHash: string;
  sessionNonce: string;
}

export interface SecretZoneInit extends SecretZoneEnvelope {
  kind: "init";
}

export interface SecretZoneConsentRequest extends SecretZoneEnvelope {
  kind: "consent.request";
  reqId: string;
  action: "id.sign";
  subject: { blockHash: string; planDigest: string };
  scope?: string[];
}

export type SecretZoneConsentResult =
  | (SecretZoneEnvelope & { kind: "consent.result"; reqId: string; ok: true; consent: ConsentClaimV0 })
  | (SecretZoneEnvelope & { kind: "consent.result"; reqId: string; ok: false; reasonCodes: string[] });

export type SecretZoneResult =
  | (SecretZoneEnvelope & { kind: "result"; reqId: string; ok: true; value?: unknown })
  | (SecretZoneEnvelope & { kind: "result"; reqId: string; ok: false; reasonCodes: string[] });

export type SecretZoneMessage = SecretZoneInit | SecretZoneConsentRequest | SecretZoneConsentResult | SecretZoneResult;
