// src/cli/license.ts
// Offline entitlement issue/verify (no network).

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftendEntitlementPayloadV1 } from "../core/entitlement_v1";
import { validateWeftendEntitlementV1 } from "../core/validate";
import type { WeftendEntitlementPayloadV1, WeftendEntitlementV1 } from "../core/types";

declare const Buffer: any;
declare const process: any;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const isString = (v: unknown): v is string => typeof v === "string";

const parseArgs = (args: string[]): { cmd: string; flags: Record<string, string | boolean>; rest: string[] } => {
  const out: { cmd: string; flags: Record<string, string | boolean>; rest: string[] } = {
    cmd: "",
    flags: {},
    rest: [],
  };
  if (args.length === 0) return out;
  out.cmd = args[0];
  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out.flags[key] = next;
        i += 1;
      } else {
        out.flags[key] = true;
      }
    } else {
      out.rest.push(token);
    }
  }
  return out;
};

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const buildLicenseId = (payload: Omit<WeftendEntitlementPayloadV1, "licenseId">): string => {
  const canon = canonicalJSON(payload);
  return `lic_${fnv1a32(canon)}`;
};

const readText = (p: string): string => fs.readFileSync(p, "utf8");
const writeText = (p: string, text: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
};

const issueLicense = (flags: Record<string, string | boolean>): number => {
  const keyPath = String(flags["key"] || "");
  const outPath = String(flags["out"] || "");
  const customerId = String(flags["customer"] || "");
  const tier = String(flags["tier"] || "");
  const featuresRaw = String(flags["features"] || "");
  const issuedAt = String(flags["issued"] || "");
  const expiresAt = flags["expires"] ? String(flags["expires"]) : "";
  const keyId = String(flags["key-id"] || "");

  if (!keyPath) {
    console.error("[LICENSE_KEY_MISSING] --key is required.");
    return 40;
  }
  if (!outPath) {
    console.error("[LICENSE_OUT_MISSING] --out is required.");
    return 40;
  }
  if (!customerId || !tier || !featuresRaw || !issuedAt || !keyId) {
    console.error("[LICENSE_INPUT_MISSING] customer/tier/features/issued/key-id required.");
    return 40;
  }

  const features = featuresRaw
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const basePayload: Omit<WeftendEntitlementPayloadV1, "licenseId"> = {
    schema: "weftend.entitlement/1",
    schemaVersion: 0,
    customerId,
    tier: tier === "enterprise" ? "enterprise" : "community",
    features,
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    issuer: { keyId, algo: "sig.ed25519.v0" },
  };
  const licenseId = isString(flags["license-id"]) ? String(flags["license-id"]) : buildLicenseId(basePayload);
  const payload: WeftendEntitlementPayloadV1 = { ...basePayload, licenseId };
  const canonicalPayload = canonicalJSON(canonicalizeWeftendEntitlementPayloadV1(payload));

  const privateKey = crypto.createPrivateKey(readText(keyPath));
  const sig = crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), privateKey);
  const entitlement: WeftendEntitlementV1 = {
    ...payload,
    signature: {
      sigKind: "sig.ed25519.v0",
      sigB64: sig.toString("base64"),
    },
  };

  writeText(outPath, `${canonicalJSON(entitlement)}\n`);
  console.log("license: ISSUED");
  return 0;
};

const verifyLicense = (flags: Record<string, string | boolean>, rest: string[]): number => {
  const licensePath = String(flags["license"] || rest[0] || "");
  const pubPath = String(flags["pub"] || "");
  if (!licensePath) {
    console.error("[LICENSE_PATH_MISSING] --license is required.");
    return 40;
  }
  if (!pubPath) {
    console.error("[LICENSE_PUBKEY_MISSING] --pub is required.");
    return 40;
  }

  let raw: any;
  try {
    raw = JSON.parse(readText(licensePath));
  } catch {
    console.error("[LICENSE_PARSE_FAILED] license file invalid.");
    return 40;
  }

  const validated = validateWeftendEntitlementV1(raw);
  if (!validated.ok) {
    console.error("[LICENSE_SCHEMA_INVALID] entitlement schema invalid.");
    return 40;
  }

  const { signature, ...payload } = validated.value;
  const canonicalPayload = canonicalJSON(canonicalizeWeftendEntitlementPayloadV1(payload));
  const publicKey = crypto.createPublicKey(readText(pubPath));
  const ok = crypto.verify(
    null,
    Buffer.from(canonicalPayload, "utf8"),
    publicKey,
    Buffer.from(signature.sigB64, "base64")
  );
  if (!ok) {
    console.error("[LICENSE_SIGNATURE_INVALID] signature invalid.");
    return 40;
  }
  console.log("license: OK");
  return 0;
};

export const runLicenseCli = (args: string[]): number => {
  const { cmd, flags, rest } = parseArgs(args);
  if (cmd === "issue") {
    return issueLicense(flags);
  }
  if (cmd === "verify") {
    return verifyLicense(flags, rest);
  }
  console.log("Usage:");
  console.log("  weftend license issue --key <private.pem> --out <license.json> --customer <id> --tier community|enterprise --features a,b --issued YYYY-MM-DD --key-id <id> [--expires YYYY-MM-DD] [--license-id <id>]");
  console.log("  weftend license verify --license <license.json> --pub <public.pem>");
  return 1;
};
