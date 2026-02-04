// src/engine/release_manifest.ts
// Release manifest minting (deterministic, fail-closed).

import { canonicalJSON } from "../core/canon";
import type { ReleaseManifestBodyV0, ReleaseManifestV0, Result } from "../core/types";
import type { CryptoPort } from "../ports/crypto-port";
import type { ValidationIssue } from "../core/validate";
import { computeReleaseIdV0, validateReleaseManifestV0 } from "../core/validate";

const issue = (code: string, message: string, path?: string): ValidationIssue => ({
  code,
  message,
  path,
});

export function mintReleaseManifestV0(
  manifestBody: ReleaseManifestBodyV0,
  signerKeyId: string,
  cryptoPort?: CryptoPort
): Result<ReleaseManifestV0, ValidationIssue[]> {
  if (!cryptoPort || typeof cryptoPort.sign !== "function") {
    return {
      ok: false,
      error: [issue("SIGNER_UNAVAILABLE", "CryptoPort.sign is required to mint release manifest.")],
    };
  }

  let payloadCanonical = "";
  try {
    payloadCanonical = canonicalJSON(manifestBody);
  } catch {
    return {
      ok: false,
      error: [issue("CANONICAL_INVALID", "manifestBody must be canonicalizable.", "manifestBody")],
    };
  }

  const signature = cryptoPort.sign(payloadCanonical, signerKeyId);
  if (!signature || typeof signature.sig !== "string" || signature.sig.length === 0) {
    return {
      ok: false,
      error: [issue("SIGNATURE_INVALID", "CryptoPort.sign returned an invalid signature.")],
    };
  }

  const manifest: ReleaseManifestV0 = {
    schema: "weftend.release/0",
    releaseId: computeReleaseIdV0(manifestBody),
    manifestBody,
    signatures: [
      {
        sigKind: signature.algo,
        keyId: signature.keyId,
        sigB64: signature.sig,
      },
    ],
  };

  const issues = validateReleaseManifestV0(manifest, "release");
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }

  return { ok: true, value: manifest };
}
