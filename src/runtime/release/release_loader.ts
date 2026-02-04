// src/runtime/release/release_loader.ts
// Release manifest verification (verify-at-load, proof-only).

import type { ReleaseManifestV0, ReleaseVerifyResultV0, Signature } from "../../core/types";
import type { CryptoPort } from "../../ports/crypto-port";
import { canonicalJSON } from "../../core/canon";
import { privacyValidateCoreTruthV0, validateReleaseManifestV0 } from "../../core/validate";
import {
  checkpointEqOrReasonV0,
  stableSortUniqueReasonsV0,
  stableSortUniqueStringsV0,
} from "../../core/trust_algebra_v0";

export interface ReleaseVerifyInputV0 {
  manifest?: ReleaseManifestV0 | null;
  expectedPlanDigest: string;
  expectedBlocks: string[];
  expectedPathDigest?: string;
  cryptoPort?: CryptoPort;
  keyAllowlist?: Record<string, string>;
}

const sameStringSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const signatureToPort = (sig: ReleaseManifestV0["signatures"][number]): Signature => ({
  algo: sig.sigKind,
  keyId: sig.keyId,
  sig: sig.sigB64,
});

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function verifyReleaseManifestV0(input: ReleaseVerifyInputV0): ReleaseVerifyResultV0 {
  const reasons: string[] = [];
  const manifest = input.manifest ?? null;

  if (!manifest) {
    reasons.push("RELEASE_MANIFEST_MISSING");
    return {
      status: "UNVERIFIED",
      reasonCodes: stableSortUniqueReasonsV0(reasons, { subject: "release", locator: "manifest" }),
    };
  }

  const issues = validateReleaseManifestV0(manifest, "release");
  if (issues.length > 0) {
    reasons.push("RELEASE_MANIFEST_INVALID");
  }
  const privacyIssues = privacyValidateCoreTruthV0(manifest, "/release_manifest.json");
  if (privacyIssues.length > 0) {
    reasons.push(...privacyIssues.map((entry) => entry.code));
  }

  const observedReleaseId = manifest.releaseId;
  const observedPlanDigest = manifest.manifestBody?.planDigest;
  const manifestPathDigest = manifest.manifestBody?.pathDigest;
  const hasManifestPathDigest = isNonEmptyString(manifestPathDigest);
  const observedPathDigest = hasManifestPathDigest ? manifestPathDigest : undefined;

  reasons.push(
    ...checkpointEqOrReasonV0(
      input.expectedPlanDigest,
      manifest.manifestBody?.planDigest,
      "RELEASE_PLANDIGEST_MISMATCH"
    )
  );

  if (!hasManifestPathDigest) {
    reasons.push("PATH_DIGEST_MISSING");
  } else if (isNonEmptyString(input.expectedPathDigest)) {
    reasons.push(
      ...checkpointEqOrReasonV0(
        input.expectedPathDigest,
        manifestPathDigest,
        "PATH_DIGEST_MISMATCH"
      )
    );
  }

  const expectedBlocks = stableSortUniqueStringsV0(input.expectedBlocks || []);
  const manifestBlocks = stableSortUniqueStringsV0(manifest.manifestBody?.blocks || []);
  if (!sameStringSet(expectedBlocks, manifestBlocks)) {
    reasons.push("RELEASE_BLOCKSET_MISMATCH");
  }

  const cryptoPort = input.cryptoPort;
  const allowlist = input.keyAllowlist || {};
  let signatureOk = false;
  if (!cryptoPort || typeof cryptoPort.verifySignature !== "function") {
    reasons.push("RELEASE_SIGNATURE_BAD");
  } else {
    let payloadCanonical = "";
    try {
      payloadCanonical = canonicalJSON(manifest.manifestBody);
    } catch {
      reasons.push("RELEASE_SIGNATURE_BAD");
    }

    if (payloadCanonical) {
      for (const sig of manifest.signatures || []) {
        const publicKey = allowlist[sig.keyId];
        if (!publicKey) continue;
        const ok = cryptoPort.verifySignature(payloadCanonical, signatureToPort(sig), publicKey);
        if (ok) {
          signatureOk = true;
          break;
        }
      }
      if (!signatureOk) reasons.push("RELEASE_SIGNATURE_BAD");
    }
  }

  const reasonCodes = stableSortUniqueReasonsV0(reasons, {
    subject: observedReleaseId ?? "release",
    locator: "manifest",
  });
  return {
    status: reasonCodes.length > 0 ? "UNVERIFIED" : "OK",
    reasonCodes,
    observedReleaseId,
    observedPlanDigest,
    observedPathDigest,
  };
}
