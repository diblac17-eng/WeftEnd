/* src/runtime/host/host_status.ts */
// Host status receipt (startup self-verify, deterministic, append-only).

import { canonicalJSON } from "../../core/canon";
import type { HostStatusReceiptV0, Signature } from "../../core/types";
import {
  computeHostStatusReceiptDigestV0,
  validateHostStatusReceiptV0,
} from "../../core/validate";
import { stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import { computeArtifactDigestV0 } from "../store/artifact_store";
import { isDemoCryptoAllowed, makeDemoCryptoPort } from "../../ports/crypto-demo";
import { computeWeftendBuildV0 } from "../weftend_build";
import { writeReceiptReadmeV0 } from "../receipt_readme";

declare const require: any;
declare const process: any;
declare const __filename: any;
declare const __dirname: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");

const RECEIPT_DIR_NAME = "host_status";
const RECEIPT_PREFIX = "host_status_";
const RECEIPT_SUFFIX = ".json";
const ENFORCEMENT_VERSION = "host_enforcement_v0";

const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const MAX_CONFIG_BYTES = 64 * 1024;
const ZERO_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

export interface HostStatusOptionsV0 {
  hostRoot: string;
  hostOutRoot?: string;
  outRootSource?: "ARG_OUT" | "ENV_OUT_ROOT";
  outRootEffective?: string;
  trustRootPath: string;
  timestampMs?: number;
  binaryPathOverride?: string;
  bundlePathsOverride?: string[];
  configOverride?: Record<string, unknown>;
  hostBinaryDigestOverride?: string;
  hostConfigDigestOverride?: string;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const toBinaryString = (buf: unknown): string => {
  if (Buffer && Buffer.isBuffer && Buffer.isBuffer(buf)) {
    return (buf as any).toString("binary");
  }
  return String(buf ?? "");
};

const digestBuffer = (buf: unknown): string => computeArtifactDigestV0(toBinaryString(buf));

const sanitizeOutRootDisplay = (value: string): string => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  if (!path.isAbsolute(trimmed)) return trimmed;
  const rel = path.relative(process.cwd(), trimmed);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  return "ABSOLUTE_OUT_ROOT_REDACTED";
};

const readFileBounded = (filePath: string, reasons: string[], missingCode: string): string | null => {
  if (!isNonEmptyString(filePath) || !fs.existsSync(filePath)) {
    reasons.push(missingCode);
    return null;
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BINARY_BYTES) {
      reasons.push("HOST_INPUT_OVERSIZE");
      return null;
    }
  } catch {
    reasons.push(missingCode);
    return null;
  }
  try {
    return toBinaryString(fs.readFileSync(filePath));
  } catch {
    reasons.push(missingCode);
    return null;
  }
};

const computeBundleDigest = (bundlePaths: string[], reasons: string[]): string => {
  const entries = bundlePaths
    .map((p) => {
      const data = readFileBounded(p, reasons, "HOST_BUNDLE_MISSING");
      return { name: p, digest: data ? digestBuffer(data) : ZERO_DIGEST };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return computeArtifactDigestV0(canonicalJSON(entries));
};

const buildHostConfig = (hostRoot: string, trustRootPath: string): Record<string, unknown> => ({
  caps: {
    allowed: [],
    denyByDefault: true,
  },
  limits: {
    maxInputBytes: 1024 * 1024,
    maxBinaryBytes: MAX_BINARY_BYTES,
    maxConfigBytes: MAX_CONFIG_BYTES,
  },
  paths: {
    hostRoot,
    trustRootPath,
  },
  policies: {
    allowNetwork: false,
  },
});

const computeConfigDigest = (config: Record<string, unknown>, reasons: string[]): string => {
  let canonical = "";
  try {
    canonical = canonicalJSON(config);
  } catch {
    reasons.push("HOST_CONFIG_INVALID");
    return ZERO_DIGEST;
  }
  if (Buffer.byteLength(canonical, "utf8") > MAX_CONFIG_BYTES) {
    reasons.push("HOST_INPUT_OVERSIZE");
    return ZERO_DIGEST;
  }
  return computeArtifactDigestV0(canonical);
};

const signReceipt = (digest: string, env: Record<string, string | undefined>): Signature | undefined => {
  const secret = env?.WEFTEND_HOST_SIGNING_SECRET;
  if (!secret || !isDemoCryptoAllowed(env)) return undefined;
  const demo = makeDemoCryptoPort(secret);
  return demo.sign ? demo.sign(digest, "host-self") : undefined;
};

const nextReceiptPath = (root: string): string => {
  const receiptsDir = path.join(root, "weftend", "host");
  fs.mkdirSync(receiptsDir, { recursive: true });
  const existing = fs
    .readdirSync(receiptsDir)
    .filter((name: string) => name.startsWith(RECEIPT_PREFIX) && name.endsWith(RECEIPT_SUFFIX));
  let maxSeq = 0;
  existing.forEach((name: string) => {
    const core = name.slice(RECEIPT_PREFIX.length, -RECEIPT_SUFFIX.length);
    const n = Number(core);
    if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
  });
  const next = String(maxSeq + 1).padStart(6, "0");
  return path.join(receiptsDir, `${RECEIPT_PREFIX}${next}${RECEIPT_SUFFIX}`);
};

export const createHostStatusReceiptV0 = (options: HostStatusOptionsV0) => {
  const reasons: string[] = [];
  const hostRoot = isNonEmptyString(options.hostRoot) ? path.resolve(options.hostRoot) : process.cwd();
  const trustRootPath = isNonEmptyString(options.trustRootPath) ? path.resolve(options.trustRootPath) : "";

  const binaryPath =
    options.binaryPathOverride ||
    process?.env?.WEFTEND_HOST_BINARY_PATH ||
    process.execPath ||
    "";
  const bundlePaths =
    options.bundlePathsOverride ??
    [
      __filename,
      path.join(__dirname, "host_main.js"),
      path.join(__dirname, "host_runner.js"),
      path.join(__dirname, "host_update.js"),
      path.join(__dirname, "host_self_manifest.js"),
      path.join(__dirname, "host_caps.js"),
    ];

  const binaryDigest =
    options.hostBinaryDigestOverride ??
    (() => {
      const data = readFileBounded(binaryPath, reasons, "HOST_BINARY_MISSING");
      return data ? digestBuffer(data) : ZERO_DIGEST;
    })();

  const bundleDigest = computeBundleDigest(bundlePaths, reasons);
  const hostBinaryDigest = computeArtifactDigestV0(
    canonicalJSON({ binary: binaryDigest, bundle: bundleDigest })
  );

  const config =
    options.configOverride ??
    buildHostConfig(hostRoot, trustRootPath);
  const hostConfigDigest =
    options.hostConfigDigestOverride ?? computeConfigDigest(config, reasons);

  let reasonCodes = stableSortUniqueReasonsV0(reasons);
  const verifyResult = reasonCodes.length > 0 ? "UNVERIFIED" : "OK";
  if (verifyResult !== "OK") {
    reasonCodes = stableSortUniqueReasonsV0(["HOST_STARTUP_UNVERIFIED", ...reasonCodes]);
  }
  const outRootSource = options.outRootSource ?? "ENV_OUT_ROOT";
  const outRootEffective = sanitizeOutRootDisplay(
    isNonEmptyString(options.outRootEffective)
      ? options.outRootEffective
      : isNonEmptyString(options.hostOutRoot)
        ? options.hostOutRoot
        : hostRoot
  );
  const timestampMs = Number.isInteger(options.timestampMs) ? (options.timestampMs as number) : Math.floor(process.uptime() * 1000);

  const receiptBase: HostStatusReceiptV0 = {
    schema: "weftend.host.statusReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild: computeWeftendBuildV0({
      filePath: binaryPath,
      source: "HOST_BINARY_PATH",
      maxBytes: MAX_BINARY_BYTES,
    }).build,
    hostBinaryDigest,
    hostConfigDigest,
    enforcementVersion: ENFORCEMENT_VERSION,
    outRootEffective,
    outRootSource,
    verifyResult,
    reasonCodes,
    timestampMs,
    receiptDigest: ZERO_DIGEST,
  };

  const receiptDigest = computeHostStatusReceiptDigestV0(receiptBase);
  const signature = signReceipt(receiptDigest, process?.env ?? {});

  const receipt: HostStatusReceiptV0 = {
    ...receiptBase,
    receiptDigest,
    ...(signature ? { signature } : {}),
  };

  const issues = validateHostStatusReceiptV0(receipt, "hostStatusReceipt");
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.code}:${i.message}`).join("|");
    throw new Error(`HOST_STATUS_RECEIPT_INVALID:${detail}`);
  }

  return { receipt, ok: receipt.verifyResult === "OK" };
};

export const emitHostStatusReceiptV0 = (options: HostStatusOptionsV0) => {
  const { receipt, ok } = createHostStatusReceiptV0(options);
  const outRoot = isNonEmptyString(options.hostOutRoot)
    ? path.resolve(options.hostOutRoot)
    : isNonEmptyString(options.hostRoot)
      ? path.resolve(options.hostRoot)
      : process.cwd();
  const receiptPath = nextReceiptPath(outRoot);
  fs.writeFileSync(receiptPath, `${canonicalJSON(receipt)}\n`, "utf8");
  writeReceiptReadmeV0(outRoot, receipt.weftendBuild, receipt.schemaVersion);
  return { receipt, ok, receiptPath };
};
