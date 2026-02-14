// src/runtime/test_support/release_manifest.ts
// Test helpers for ReleaseManifest v0.

import { canonicalJSON } from "../../core/canon";
import { sha256HexV0 } from "../../core/hash_v0";
import { cmpStrV0 } from "../../core/order";
import { computeReleaseIdV0 } from "../../core/validate";
import type { ReleaseManifestV0 } from "../../core/types";
import type { CryptoPort } from "../../ports/crypto-port";

declare const Buffer: any;

export const RELEASE_KEY_ID = "release-key-1";
export const RELEASE_PUBLIC_KEY = "release-pub-1";

export const releaseKeyAllowlist: Record<string, string> = {
  [RELEASE_KEY_ID]: RELEASE_PUBLIC_KEY,
};

const sha256 = (input: string): string => sha256HexV0(input);

const signatureForPayload = (payloadCanonical: string): string =>
  Buffer.from(`sig:${sha256(payloadCanonical)}`, "utf8").toString("base64");

export const makeReleaseCryptoPort = (): CryptoPort => ({
  hash: (canonical: string) => `sha256:${sha256(canonical)}`,
  verifySignature: (payload: string, sig: { sig?: string }, publicKey: string) =>
    publicKey === RELEASE_PUBLIC_KEY && sig?.sig === signatureForPayload(payload),
});

export const makeReleaseManifest = (
  planDigest: string,
  blocks: string[],
  policyDigest = "policy-demo",
  pathDigest: string
): ReleaseManifestV0 => {
  const sortedBlocks = Array.from(new Set(blocks)).sort((a, b) => cmpStrV0(a, b));
  const manifestBody: ReleaseManifestV0["manifestBody"] = {
    planDigest,
    policyDigest,
    blocks: sortedBlocks,
    pathDigest,
  };
  const releaseId = computeReleaseIdV0(manifestBody);
  const payloadCanonical = canonicalJSON(manifestBody);
  const sigB64 = signatureForPayload(payloadCanonical);

  return {
    schema: "weftend.release/0",
    releaseId,
    manifestBody,
    signatures: [
      {
        sigKind: "sig.ed25519.v0",
        keyId: RELEASE_KEY_ID,
        sigB64,
      },
    ],
  };
};
