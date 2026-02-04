// src/runtime/host/host_self_manifest.ts
// Host self-manifest verification (pinned trust root).

import { canonicalJSON } from "../../core/canon";
import type { HostSelfManifestV0 } from "../../core/types";
import {
  computeHostSelfIdV0,
  validateHostSelfManifestV0,
} from "../../core/validate";
import { stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import { makeDemoCryptoPort } from "../../ports/crypto-demo";

declare const require: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const hasPemPublicKey = (key: string): boolean =>
  typeof key === "string" && key.includes("-----BEGIN") && key.includes("PUBLIC KEY-----");

const isDemoPublicKey = (key: string): boolean =>
  typeof key === "string" && key.startsWith("pub:");

const verifySignature = (payloadCanonical: string, sigKind: string, sigB64: string, publicKey: string): boolean => {
  if (!isNonEmptyString(sigKind) || !isNonEmptyString(sigB64) || !isNonEmptyString(publicKey)) return false;
  if (isDemoPublicKey(publicKey)) {
    const demo = makeDemoCryptoPort("host-update-demo");
    return demo.verifySignature(payloadCanonical, { algo: sigKind, keyId: "host", sig: sigB64 }, publicKey);
  }
  if (!hasPemPublicKey(publicKey)) return false;
  let signature: any;
  try {
    signature = Buffer.from(sigB64, "base64");
  } catch {
    return false;
  }
  try {
    const data = Buffer.from(payloadCanonical, "utf8");
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

export const readTrustRoot = (trustRootPath: string): { ok: true; keyId: string; publicKey: string } | { ok: false; reason: string } => {
  if (!isNonEmptyString(trustRootPath) || !fs.existsSync(trustRootPath)) {
    return { ok: false, reason: "HOST_TRUST_ROOT_MISSING" };
  }
  try {
    const raw = fs.readFileSync(trustRootPath, "utf8");
    const parsed = JSON.parse(raw);
    const keyId = isNonEmptyString(parsed?.keyId) ? String(parsed.keyId) : "";
    const publicKey = isNonEmptyString(parsed?.publicKey) ? String(parsed.publicKey) : "";
    if (!keyId || !publicKey) return { ok: false, reason: "HOST_TRUST_ROOT_INVALID" };
    return { ok: true, keyId, publicKey };
  } catch {
    return { ok: false, reason: "HOST_TRUST_ROOT_INVALID" };
  }
};

export const loadHostSelfManifest = (hostRoot: string): { ok: true; manifest: HostSelfManifestV0 } | { ok: false; reason: string } => {
  const manifestPath = path.join(hostRoot, "current", "host_self_manifest.json");
  if (!fs.existsSync(manifestPath)) return { ok: false, reason: "HOST_SELF_MISSING" };
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return { ok: true, manifest: parsed as HostSelfManifestV0 };
  } catch {
    return { ok: false, reason: "HOST_SELF_INVALID" };
  }
};

export const verifyHostSelfManifest = (manifest: HostSelfManifestV0, publicKey: string) => {
  const reasons: string[] = [];
  const issues = validateHostSelfManifestV0(manifest, "hostSelf");
  if (issues.length > 0) reasons.push("HOST_SELF_INVALID");

  const expectedId = computeHostSelfIdV0(manifest.body);
  if (manifest.hostSelfId !== expectedId) reasons.push("HOST_SELF_ID_MISMATCH");

  let payloadCanonical = "";
  try {
    payloadCanonical = canonicalJSON(manifest.body);
  } catch {
    reasons.push("HOST_SELF_INVALID");
  }

  const sigs = Array.isArray(manifest.signatures) ? manifest.signatures : [];
  const sigOk =
    payloadCanonical.length > 0 &&
    sigs.some((sig) => sig && verifySignature(payloadCanonical, sig.sigKind, sig.sigB64, publicKey));
  if (!sigOk) reasons.push("HOST_SELF_SIGNATURE_BAD");

  const reasonCodes = stableSortUniqueReasonsV0(reasons);
  return {
    status: reasonCodes.length > 0 ? "UNVERIFIED" : "OK",
    reasonCodes,
    hostSelfId: manifest.hostSelfId,
  };
};

export const getHostSelfStatus = (hostRoot: string, trustRootPath: string) => {
  const trust = readTrustRoot(trustRootPath);
  if (!trust.ok) {
    return { status: "UNVERIFIED" as const, reasonCodes: [trust.reason], hostSelfId: undefined };
  }
  const loaded = loadHostSelfManifest(hostRoot);
  if (!loaded.ok) {
    return {
      status: loaded.reason === "HOST_SELF_MISSING" ? ("MISSING" as const) : ("UNVERIFIED" as const),
      reasonCodes: [loaded.reason],
      hostSelfId: undefined,
    };
  }
  const verified = verifyHostSelfManifest(loaded.manifest, trust.publicKey);
  return {
    status: verified.status === "OK" ? ("OK" as const) : ("UNVERIFIED" as const),
    reasonCodes: verified.reasonCodes,
    hostSelfId: verified.hostSelfId,
  };
};
