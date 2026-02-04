// src/cli/inspect.ts
// Release folder inspection (deterministic, proof-only).

import type { Result } from "../core/types";
import type { ReleaseManifestV0, EvidenceBundleV0, RuntimeBundle } from "../core/types";
import { canonicalJSON } from "../core/canon";
import {
  computeEvidenceBundleDigestV0,
  validateEvidenceBundleV0,
  validateReleaseManifestV0,
  validateRuntimeBundle,
} from "../core/validate";
import { stableSortUniqueReasonsV0, truncateReasonDetailV0 } from "../core/trust_algebra_v0";
import { makeDemoCryptoPort } from "../ports/crypto-demo";

declare const require: (id: string) => any;
declare const Buffer: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

export interface ReleaseFolderCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  reasonCodes?: string[];
  optional?: boolean;
}

export interface ReleaseFolderInspection {
  ok: boolean;
  checks: ReleaseFolderCheck[];
}

const ok = <T>(value: T): Result<T, { code: string; message: string }[]> => ({ ok: true, value });
const err = (code: string, message: string): Result<never, { code: string; message: string }[]> => ({
  ok: false,
  error: [{ code, message }],
});

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const readJson = (filePath: string): Result<unknown, { code: string; message: string }[]> => {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return ok(JSON.parse(raw));
  } catch {
    return err("JSON_PARSE_ERROR", `Failed to parse ${filePath}`);
  }
};

const hasPemPublicKey = (key: string): boolean =>
  typeof key === "string" && key.includes("-----BEGIN") && key.includes("PUBLIC KEY-----");

const isDemoPublicKey = (key: string): boolean =>
  typeof key === "string" && key.startsWith("pub:");

const verifySignature = (payloadCanonical: string, sigKind: string, sigB64: string, publicKey: string): boolean => {
  if (!isNonEmptyString(sigKind) || !isNonEmptyString(sigB64) || !isNonEmptyString(publicKey)) return false;
  if (isDemoPublicKey(publicKey)) {
    const demo = makeDemoCryptoPort("ignored");
    return demo.verifySignature(payloadCanonical, { algo: sigKind, keyId: "release", sig: sigB64 }, publicKey);
  }
  if (!hasPemPublicKey(publicKey)) return false;

  const data = Buffer.from(payloadCanonical, "utf8");
  let signature: any;
  try {
    signature = Buffer.from(sigB64, "base64");
  } catch {
    return false;
  }
  try {
    if (sigKind === "sig.ed25519.v0") {
      return crypto.verify(null, data, publicKey, signature);
    }
    if (sigKind === "sig.p256.v0") {
      return crypto.verify("sha256", data, publicKey, signature);
    }
  } catch {
    return false;
  }
  return false;
};

const summarizeIssues = (issues: Array<{ code: string }>): string[] =>
  stableSortUniqueReasonsV0(issues.map((i) => i.code).filter(isNonEmptyString));

const check = (entry: ReleaseFolderCheck): ReleaseFolderCheck => ({
  ...entry,
  detail: truncateReasonDetailV0(entry.detail),
  reasonCodes: entry.reasonCodes && entry.reasonCodes.length > 0 ? stableSortUniqueReasonsV0(entry.reasonCodes) : undefined,
});

export const inspectReleaseFolder = (releaseDir: string): Result<ReleaseFolderInspection, { code: string; message: string }[]> => {
  if (!isNonEmptyString(releaseDir)) {
    return err("INPUT_INVALID", "releaseDir must be a non-empty string.");
  }
  const resolved = path.resolve(process.cwd(), releaseDir);
  if (!fs.existsSync(resolved)) {
    return err("INPUT_MISSING", `releaseDir not found: ${resolved}`);
  }

  const checks: ReleaseFolderCheck[] = [];
  const manifestPath = path.join(resolved, "release_manifest.json");
  const keyPath = path.join(resolved, "release_public_key.json");
  const bundlePath = path.join(resolved, "runtime_bundle.json");
  const evidencePath = path.join(resolved, "evidence.json");
  const policyPath = path.join(resolved, "policy.json");
  const tartarusPath = path.join(resolved, "tartarus.jsonl");
  const receiptsPath = path.join(resolved, "receipts");
  const artifactsPath = path.join(resolved, "artifacts");

  const manifestExists = fs.existsSync(manifestPath);
  checks.push(check({
    id: "release.manifest",
    label: "release_manifest.json",
    ok: manifestExists,
    detail: manifestExists ? "OK" : "MISSING",
    reasonCodes: manifestExists ? [] : ["RELEASE_MANIFEST_MISSING"],
  }));

  let manifest: ReleaseManifestV0 | null = null;
  let manifestValid = false;
  if (manifestExists) {
    const parsed = readJson(manifestPath);
    if (!parsed.ok) {
      checks.push(check({
        id: "release.manifest.valid",
        label: "release_manifest.json validation",
        ok: false,
        detail: "JSON_PARSE_ERROR",
        reasonCodes: ["RELEASE_MANIFEST_INVALID"],
      }));
    } else {
      const issues = validateReleaseManifestV0(parsed.value, "release");
      if (issues.length > 0) {
        checks.push(check({
          id: "release.manifest.valid",
          label: "release_manifest.json validation",
          ok: false,
          detail: summarizeIssues(issues).join("|"),
          reasonCodes: summarizeIssues(issues),
        }));
      } else {
        manifest = parsed.value as ReleaseManifestV0;
        manifestValid = true;
        checks.push(check({
          id: "release.manifest.valid",
          label: "release_manifest.json validation",
          ok: true,
          detail: "OK",
        }));
      }
    }
  }

  const keyExists = fs.existsSync(keyPath);
  checks.push(check({
    id: "release.public_key",
    label: "release_public_key.json",
    ok: keyExists,
    detail: keyExists ? "OK" : "MISSING",
    reasonCodes: keyExists ? [] : ["PUBLIC_KEY_MISSING"],
  }));

  let publicKey = "";
  let keyId = "";
  if (keyExists) {
    const parsedKey = readJson(keyPath);
    if (!parsedKey.ok || !parsedKey.value || typeof parsedKey.value !== "object") {
      checks.push(check({
        id: "release.public_key.valid",
        label: "release_public_key.json validation",
        ok: false,
        detail: "PUBLIC_KEY_INVALID",
        reasonCodes: ["PUBLIC_KEY_INVALID"],
      }));
    } else {
      const obj = parsedKey.value as Record<string, unknown>;
      publicKey = isNonEmptyString(obj.publicKey) ? obj.publicKey : "";
      keyId = isNonEmptyString(obj.keyId) ? obj.keyId : "";
      const okKey = isNonEmptyString(publicKey) && isNonEmptyString(keyId);
      checks.push(check({
        id: "release.public_key.valid",
        label: "release_public_key.json validation",
        ok: okKey,
        detail: okKey ? "OK" : "PUBLIC_KEY_INVALID",
        reasonCodes: okKey ? [] : ["PUBLIC_KEY_INVALID"],
      }));
    }
  }

  if (manifest && isNonEmptyString(publicKey)) {
    let payloadCanonical = "";
    try {
      payloadCanonical = canonicalJSON(manifest.manifestBody);
    } catch {
      payloadCanonical = "";
    }
    const sigs = Array.isArray(manifest.signatures) ? manifest.signatures : [];
    const signatureOk = payloadCanonical.length > 0 && sigs.some((sig) =>
      sig && sig.keyId === keyId && verifySignature(payloadCanonical, sig.sigKind, sig.sigB64, publicKey)
    );
    checks.push(check({
      id: "release.signature",
      label: "release manifest signature",
      ok: signatureOk,
      detail: signatureOk ? "OK" : "RELEASE_SIGNATURE_BAD",
      reasonCodes: signatureOk ? [] : ["RELEASE_SIGNATURE_BAD"],
    }));
  } else {
    const reason = !manifest ? "RELEASE_MANIFEST_MISSING" : "PUBLIC_KEY_MISSING";
    checks.push(check({
      id: "release.signature",
      label: "release manifest signature",
      ok: false,
      detail: reason,
      reasonCodes: [reason],
    }));
  }

  const bundleExists = fs.existsSync(bundlePath);
  let bundle: RuntimeBundle | null = null;
  let bundleValid = false;
  if (bundleExists) {
    const bundleRes = readJson(bundlePath);
    if (!bundleRes.ok) {
      checks.push(check({
        id: "release.runtime.bundle",
        label: "runtime_bundle.json",
        ok: false,
        detail: "JSON_PARSE_ERROR",
        reasonCodes: ["RUNTIME_BUNDLE_INVALID"],
      }));
    } else {
      const bundleCheck = validateRuntimeBundle(bundleRes.value as any);
      if (!bundleCheck.ok) {
        const codes = summarizeIssues(bundleCheck.error || []);
        checks.push(check({
          id: "release.runtime.bundle",
          label: "runtime_bundle.json",
          ok: false,
          detail: codes.join("|"),
          reasonCodes: codes.length > 0 ? codes : ["RUNTIME_BUNDLE_INVALID"],
        }));
      } else {
        bundle = bundleCheck.value as RuntimeBundle;
        bundleValid = true;
        checks.push(check({
          id: "release.runtime.bundle",
          label: "runtime_bundle.json",
          ok: true,
          detail: "OK",
        }));
      }
    }
  } else {
    checks.push(check({
      id: "release.runtime.bundle",
      label: "runtime_bundle.json",
      ok: false,
      detail: "MISSING",
      reasonCodes: ["RUNTIME_BUNDLE_MISSING"],
    }));
  }

  const planBindingReason = !manifestExists
    ? "RELEASE_MANIFEST_MISSING"
    : !manifestValid
      ? "RELEASE_MANIFEST_INVALID"
      : !bundleExists
        ? "RUNTIME_BUNDLE_MISSING"
        : !bundleValid
          ? "RUNTIME_BUNDLE_INVALID"
          : "";
  if (planBindingReason) {
    checks.push(check({
      id: "release.bundle.planDigest",
      label: "manifest planDigest vs bundle planHash",
      ok: false,
      detail: planBindingReason,
      reasonCodes: [planBindingReason],
    }));
  } else {
    const expected = manifest?.manifestBody?.planDigest || "";
    const observed = bundle?.plan?.planHash || "";
    const okBinding = expected === observed && isNonEmptyString(expected);
    checks.push(check({
      id: "release.bundle.planDigest",
      label: "manifest planDigest vs bundle planHash",
      ok: okBinding,
      detail: okBinding ? observed : "RELEASE_PLANDIGEST_MISMATCH",
      reasonCodes: okBinding ? [] : ["RELEASE_PLANDIGEST_MISMATCH"],
    }));
  }

  const policyBindingReason = !manifestExists
    ? "RELEASE_MANIFEST_MISSING"
    : !manifestValid
      ? "RELEASE_MANIFEST_INVALID"
      : !bundleExists
        ? "RUNTIME_BUNDLE_MISSING"
        : !bundleValid
          ? "RUNTIME_BUNDLE_INVALID"
          : "";
  if (policyBindingReason) {
    checks.push(check({
      id: "release.bundle.policyDigest",
      label: "manifest policyDigest vs bundle trust policyId",
      ok: false,
      detail: policyBindingReason,
      reasonCodes: [policyBindingReason],
    }));
  } else {
    const expected = manifest?.manifestBody?.policyDigest || "";
    const observed = bundle?.trust?.policyId || "";
    const okBinding = expected === observed && isNonEmptyString(expected);
    checks.push(check({
      id: "release.bundle.policyDigest",
      label: "manifest policyDigest vs bundle trust policyId",
      ok: okBinding,
      detail: okBinding ? observed : "POLICY_DIGEST_MISMATCH",
      reasonCodes: okBinding ? [] : ["POLICY_DIGEST_MISMATCH"],
    }));
  }

  const evidenceExists = fs.existsSync(evidencePath);
  if (!manifest || !isNonEmptyString(manifest.manifestBody?.evidenceJournalHead)) {
    checks.push(check({
      id: "release.evidence",
      label: "evidence.json",
      ok: evidenceExists,
      detail: evidenceExists ? "PRESENT" : "MISSING",
      optional: true,
      reasonCodes: evidenceExists ? [] : ["EVIDENCE_MISSING"],
    }));
  } else if (!evidenceExists) {
    checks.push(check({
      id: "release.evidence",
      label: "evidence.json",
      ok: false,
      detail: "MISSING",
      reasonCodes: ["EVIDENCE_MISSING"],
    }));
  } else {
    const parsedEvidence = readJson(evidencePath);
    if (!parsedEvidence.ok) {
      checks.push(check({
        id: "release.evidence",
        label: "evidence.json",
        ok: false,
        detail: "JSON_PARSE_ERROR",
        reasonCodes: ["EVIDENCE_INVALID"],
      }));
    } else {
      const evidence = parsedEvidence.value as EvidenceBundleV0;
      const evidenceIssues = validateEvidenceBundleV0(evidence, "evidence");
      if (evidenceIssues.length > 0) {
        const codes = summarizeIssues(evidenceIssues);
        checks.push(check({
          id: "release.evidence",
          label: "evidence.json",
          ok: false,
          detail: codes.join("|"),
          reasonCodes: codes.length > 0 ? codes : ["EVIDENCE_INVALID"],
        }));
      } else {
        const expectedHead = manifest.manifestBody?.evidenceJournalHead;
        const observedHead = computeEvidenceBundleDigestV0(evidence);
        const headMatch = expectedHead === observedHead;
        checks.push(check({
          id: "release.evidence",
          label: "evidence.json",
          ok: headMatch,
          detail: headMatch ? observedHead : "EVIDENCE_HEAD_MISMATCH",
          reasonCodes: headMatch ? [] : ["EVIDENCE_HEAD_MISMATCH"],
        }));
      }
    }
  }

  const policyExists = fs.existsSync(policyPath);
  checks.push(check({
    id: "release.policy",
    label: "policy.json",
    ok: policyExists,
    detail: policyExists ? "PRESENT" : "MISSING",
    optional: true,
    reasonCodes: policyExists ? [] : ["POLICY_MISSING"],
  }));

  const tartarusExists = fs.existsSync(tartarusPath);
  checks.push(check({
    id: "release.tartarus",
    label: "tartarus.jsonl",
    ok: tartarusExists,
    detail: tartarusExists ? "PRESENT" : "MISSING",
    optional: true,
    reasonCodes: tartarusExists ? [] : ["TARTARUS_MISSING"],
  }));

  const receiptsExists = fs.existsSync(receiptsPath) && fs.statSync(receiptsPath).isDirectory();
  checks.push(check({
    id: "release.receipts",
    label: "receipts/",
    ok: receiptsExists,
    detail: receiptsExists ? "PRESENT" : "MISSING",
    optional: true,
    reasonCodes: receiptsExists ? [] : ["RECEIPTS_MISSING"],
  }));

  const artifactsExists = fs.existsSync(artifactsPath) && fs.statSync(artifactsPath).isDirectory();
  checks.push(check({
    id: "release.artifacts",
    label: "artifacts/",
    ok: artifactsExists,
    detail: artifactsExists ? "PRESENT" : "MISSING",
    optional: true,
    reasonCodes: artifactsExists ? [] : ["ARTIFACTS_MISSING"],
  }));

  const requiredOk = checks.every((c) => c.ok || c.optional === true);
  return ok({ ok: requiredOk, checks });
};
