// src/cli/license.ts
// Offline entitlement issue/verify (no network).

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftendEntitlementPayloadV1 } from "../core/entitlement_v1";
import { sha256HexV0 } from "../core/hash_v0";
import { cmpStrV0 } from "../core/order";
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

const sha256 = (input: string): string => sha256HexV0(input);

const buildLicenseId = (payload: Omit<WeftendEntitlementPayloadV1, "licenseId">): string => {
  const canon = canonicalJSON(payload);
  return `lic_${sha256(canon)}`;
};

const readText = (p: string): string => fs.readFileSync(p, "utf8");
const writeTextAtomic = (p: string, text: string): boolean => {
  const resolved = path.resolve(process.cwd(), p);
  const stagePath = `${resolved}.stage`;
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(stagePath, text, "utf8");
    fs.renameSync(stagePath, resolved);
    return true;
  } catch {
    try {
      if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);
    } catch {
      // best-effort cleanup only
    }
    return false;
  }
};

const sameResolvedPath = (aPath: string, bPath: string): boolean =>
  path.resolve(process.cwd(), String(aPath || "")) === path.resolve(process.cwd(), String(bPath || ""));

const validateLicenseIssueOutputPath = (outPath: string): { ok: true } | { ok: false; code: string; message: string } => {
  const resolvedOut = path.resolve(process.cwd(), String(outPath || ""));
  try {
    if (fs.existsSync(resolvedOut)) {
      const existing = fs.statSync(resolvedOut);
      if (existing.isDirectory()) {
        return {
          ok: false,
          code: "LICENSE_OUT_PATH_IS_DIRECTORY",
          message: "--out must be a file path or a missing path.",
        };
      }
    }
  } catch {
    return { ok: false, code: "LICENSE_OUT_PATH_STAT_FAILED", message: "unable to inspect --out path." };
  }
  const parentDir = path.dirname(resolvedOut);
  if (parentDir && fs.existsSync(parentDir)) {
    try {
      const parentStat = fs.statSync(parentDir);
      if (!parentStat.isDirectory()) {
        return {
          ok: false,
          code: "LICENSE_OUT_PATH_PARENT_NOT_DIRECTORY",
          message: "parent of --out must be a directory.",
        };
      }
    } catch {
      return {
        ok: false,
        code: "LICENSE_OUT_PATH_PARENT_STAT_FAILED",
        message: "unable to inspect parent of --out.",
      };
    }
  }
  return { ok: true };
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
  if (sameResolvedPath(keyPath, outPath)) {
    console.error("[LICENSE_OUT_CONFLICTS_KEY] --out must differ from --key.");
    return 40;
  }
  const outPathCheck = validateLicenseIssueOutputPath(outPath);
  if (!outPathCheck.ok) {
    console.error(`[${outPathCheck.code}] ${outPathCheck.message}`);
    return 40;
  }

  const features = featuresRaw
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .sort((a, b) => cmpStrV0(a, b));

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

  if (!writeTextAtomic(outPath, `${canonicalJSON(entitlement)}\n`)) {
    console.error("[LICENSE_WRITE_FAILED] unable to finalize license output.");
    return 1;
  }
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
