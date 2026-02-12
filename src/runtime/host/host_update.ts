// src/runtime/host/host_update.ts
// Host update install + status (deterministic, fail-closed).

import { canonicalJSON } from "../../core/canon";
import type {
  HostSelfManifestV0,
  HostUpdateReceiptV0,
  ReleaseManifestV0,
  RuntimeBundle,
} from "../../core/types";
import {
  computeEvidenceBundleDigestV0,
  computeHostSelfIdV0,
  computeHostUpdateReceiptDigestV0,
  computePathDigestV0,
  validateEvidenceBundleV0,
  validateHostUpdateReceiptV0,
  validateReleaseManifestV0,
  validateRuntimeBundle,
} from "../../core/validate";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";
import { computeArtifactDigestV0 } from "../store/artifact_store";
import { verifyReleaseManifestV0 } from "../release/release_loader";
import { deriveDemoPublicKey, makeDemoCryptoPort } from "../../ports/crypto-demo";
import { getHostSelfStatus, readTrustRoot } from "./host_self_manifest";
import { computeWeftendBuildV0 } from "../weftend_build";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RECEIPT_NAME = "host_update_receipt.json";
const MAX_INPUT_BYTES = 1024 * 1024;
const ZERO_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

export interface HostInstallOptionsV0 {
  releaseDir: string;
  hostRoot: string;
  trustRootPath: string;
  signingSecret?: string;
  outDir?: string;
}

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
const readTextBounded = (
  filePath: string,
  reasons: string[],
  missingCode: string,
  invalidCode: string
): string | null => {
  if (!fs.existsSync(filePath)) {
    reasons.push(missingCode);
    return null;
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_INPUT_BYTES) {
      reasons.push("HOST_INPUT_OVERSIZE");
      return null;
    }
  } catch {
    reasons.push(invalidCode);
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    reasons.push(invalidCode);
    return null;
  }
};

const parseJson = (raw: string | null, reasons: string[], invalidCode: string): unknown | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    reasons.push(invalidCode);
    return null;
  }
};

const computeHostRootDigest = (trustRoot: { keyId: string; publicKey: string }): string =>
  computeArtifactDigestV0(canonicalJSON({ keyId: trustRoot.keyId, publicKey: trustRoot.publicKey }));

const listBlocksFromPlan = (bundle: RuntimeBundle | null): string[] => {
  if (!bundle || !Array.isArray((bundle as any).plan?.nodes)) return [];
  return stableSortUniqueStringsV0(
    (bundle as any).plan.nodes
      .map((n: any) => (n && typeof n.nodeId === "string" ? n.nodeId : ""))
      .filter((id: string) => id.startsWith("block:"))
  );
};

const buildHostSelfManifest = (
  releaseManifest: ReleaseManifestV0,
  runtimeBundle: RuntimeBundle,
  digests: { releaseManifest: string; runtimeBundle: string; evidence: string; publicKey: string },
  signingSecret: string,
  keyId: string
): HostSelfManifestV0 | null => {
  const demo = makeDemoCryptoPort(signingSecret);
  const hostVersion = isNonEmptyString((runtimeBundle as any)?.compiler?.compilerVersion)
    ? String((runtimeBundle as any).compiler.compilerVersion)
    : "0.0.0";
  const body = {
    hostVersion,
    releaseId: releaseManifest.releaseId,
    releaseManifestDigest: digests.releaseManifest,
    runtimeBundleDigest: digests.runtimeBundle,
    evidenceDigest: digests.evidence,
    publicKeyDigest: digests.publicKey,
    policyDigest: releaseManifest.manifestBody?.policyDigest,
  };
  const hostSelfId = computeHostSelfIdV0(body as any);
  const payloadCanonical = canonicalJSON(body);
  const sig = demo.sign ? demo.sign(payloadCanonical, keyId) : null;
  if (!sig) return null;
  return {
    schema: "weftend.host.self/0",
    hostSelfId,
    body,
    signatures: [{ sigKind: sig.algo, keyId: sig.keyId, sigB64: sig.sig }],
  };
};

export const installHostUpdateV0 = (options: HostInstallOptionsV0): { receipt: HostUpdateReceiptV0; exitCode: number } => {
  const verifyReasons: string[] = [];
  const decisionReasons: string[] = [];
  const applyReasons: string[] = [];
  const releaseDir = path.resolve(process.cwd(), options.releaseDir || "");
  const hostRoot = path.resolve(process.cwd(), options.hostRoot || "");
  const trustRootPath = path.resolve(process.cwd(), options.trustRootPath || "");
  const outDir = options.outDir ? path.resolve(process.cwd(), options.outDir) : path.join(hostRoot, "receipts");

  if (!options.releaseDir || !fs.existsSync(releaseDir)) verifyReasons.push("RELEASE_DIR_MISSING");
  if (!options.hostRoot) decisionReasons.push("HOST_ROOT_MISSING");
  const trust = readTrustRoot(trustRootPath);
  if (!trust.ok) {
    verifyReasons.push(trust.reason);
    decisionReasons.push(trust.reason);
  }

  const manifestPath = path.join(releaseDir, "release_manifest.json");
  const bundlePath = path.join(releaseDir, "runtime_bundle.json");
  const evidencePath = path.join(releaseDir, "evidence.json");
  const publicKeyPath = path.join(releaseDir, "release_public_key.json");

  const manifestRaw = readTextBounded(manifestPath, verifyReasons, "RELEASE_MANIFEST_MISSING", "RELEASE_MANIFEST_INVALID");
  const bundleRaw = readTextBounded(bundlePath, verifyReasons, "RUNTIME_BUNDLE_MISSING", "RUNTIME_BUNDLE_INVALID");
  const evidenceRaw = readTextBounded(evidencePath, verifyReasons, "EVIDENCE_MISSING", "EVIDENCE_INVALID");
  const publicKeyRaw = readTextBounded(publicKeyPath, verifyReasons, "PUBLIC_KEY_MISSING", "PUBLIC_KEY_INVALID");

  let manifest: ReleaseManifestV0 | null = null;
  let bundle: RuntimeBundle | null = null;
  let evidence: unknown = null;

  if (manifestRaw) {
    const parsed = parseJson(manifestRaw, verifyReasons, "RELEASE_MANIFEST_INVALID") as ReleaseManifestV0 | null;
    if (parsed) {
      const manifestIssues = validateReleaseManifestV0(parsed, "release");
      if (manifestIssues.length > 0) verifyReasons.push("RELEASE_MANIFEST_INVALID");
      else manifest = parsed;
    }
  }

  if (bundleRaw) {
    const parsed = parseJson(bundleRaw, verifyReasons, "RUNTIME_BUNDLE_INVALID");
    const bundleCheck = parsed ? validateRuntimeBundle(parsed) : null;
    if (!bundleCheck || !bundleCheck.ok) {
      verifyReasons.push("RUNTIME_BUNDLE_INVALID");
    } else {
      bundle = bundleCheck.value as RuntimeBundle;
    }
  }

  if (evidenceRaw) {
    const parsed = parseJson(evidenceRaw, verifyReasons, "EVIDENCE_INVALID");
    if (parsed) {
      const evidenceIssues = validateEvidenceBundleV0(parsed, "evidence");
      if (evidenceIssues.length > 0) verifyReasons.push("EVIDENCE_INVALID");
      else evidence = parsed;
    }
  }

  if (publicKeyRaw) {
    const parsed = parseJson(publicKeyRaw, verifyReasons, "PUBLIC_KEY_INVALID") as Record<string, unknown> | null;
    if (parsed) {
      const keyId = isNonEmptyString((parsed as any).keyId) ? String((parsed as any).keyId) : "";
      const publicKey = isNonEmptyString((parsed as any).publicKey) ? String((parsed as any).publicKey) : "";
      if (!keyId || !publicKey) {
        verifyReasons.push("PUBLIC_KEY_INVALID");
      }
    }
  }

  const digests = {
    releaseManifest: manifestRaw ? computeArtifactDigestV0(manifestRaw) : ZERO_DIGEST,
    runtimeBundle: bundleRaw ? computeArtifactDigestV0(bundleRaw) : ZERO_DIGEST,
    evidence: evidenceRaw ? computeArtifactDigestV0(evidenceRaw) : ZERO_DIGEST,
    publicKey: publicKeyRaw ? computeArtifactDigestV0(publicKeyRaw) : ZERO_DIGEST,
  };

  if (manifest && bundle && trust.ok) {
    const expectedPlanDigest = isNonEmptyString((bundle as any).plan?.planHash) ? (bundle as any).plan.planHash : "";
    const expectedBlocks = listBlocksFromPlan(bundle);
    const expectedPathDigest = (bundle as any).planSnapshot
      ? computePathDigestV0((bundle as any).planSnapshot.pathSummary)
      : undefined;
    const allowlist = { [trust.keyId]: trust.publicKey };
    const cryptoPort =
      trust.publicKey.startsWith("pub:")
        ? makeDemoCryptoPort("host-update-demo")
        : {
            hash: (canonical: string) => computeArtifactDigestV0(canonical),
            verifySignature: (payload: string, sig: { algo: string; keyId: string; sig: string }, pk: string) =>
              verifySignature(payload, sig.algo, sig.sig, pk),
          };
    const verify = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest,
      expectedBlocks,
      expectedPathDigest,
      cryptoPort,
      keyAllowlist: allowlist,
    });
    verifyReasons.push(...(verify.reasonCodes ?? []));

    if (manifest.manifestBody?.policyDigest && isNonEmptyString((bundle as any).trust?.policyId)) {
      if (manifest.manifestBody.policyDigest !== (bundle as any).trust.policyId) {
        verifyReasons.push("POLICY_DIGEST_MISMATCH");
      }
    }

    if (manifest.manifestBody?.evidenceJournalHead && evidence) {
      const observed = computeEvidenceBundleDigestV0(evidence);
      if (observed !== manifest.manifestBody.evidenceJournalHead) {
        verifyReasons.push("EVIDENCE_HEAD_MISMATCH");
      }
    }
  }

  const verifyStatus = verifyReasons.length > 0 ? "UNVERIFIED" : "OK";
  decisionReasons.push(...verifyReasons);

  if (verifyStatus === "OK") {
    if (!options.signingSecret) {
      decisionReasons.push("HOST_SIGNING_KEY_MISSING");
    }
    if (!trust.ok) {
      decisionReasons.push("HOST_TRUST_ROOT_MISSING");
    }
  }

  if (verifyStatus === "OK" && options.signingSecret && trust.ok && manifest && bundle) {
    if (trust.publicKey.startsWith("pub:")) {
      const derivedKey = deriveDemoPublicKey(options.signingSecret);
      if (derivedKey !== trust.publicKey) {
        decisionReasons.push("HOST_SIGNING_KEY_MISMATCH");
      }
    }
  }

  const decision = decisionReasons.length > 0 ? "DENY" : "ALLOW";
  let applyResult: "APPLIED" | "ROLLED_BACK" | "SKIP" = "SKIP";
  let applyAttempted = false;
  let hostSelfId: string | undefined;

  if (decision === "ALLOW" && decisionReasons.length === 0 && options.signingSecret && trust.ok && manifest && bundle) {
    const hostSelf = buildHostSelfManifest(manifest, bundle, digests, options.signingSecret, trust.keyId);
    if (!hostSelf) {
      applyReasons.push("HOST_SELF_SIGN_FAILED");
    } else {
      hostSelfId = hostSelf.hostSelfId;
      const stagingDir = path.join(hostRoot, ".staging");
      const currentDir = path.join(hostRoot, "current");
      const backupDir = path.join(hostRoot, "backup");
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });
        const copy = (from: string, to: string) => fs.copyFileSync(from, to);
        copy(manifestPath, path.join(stagingDir, "release_manifest.json"));
        copy(bundlePath, path.join(stagingDir, "runtime_bundle.json"));
        copy(evidencePath, path.join(stagingDir, "evidence.json"));
        copy(publicKeyPath, path.join(stagingDir, "release_public_key.json"));
        fs.writeFileSync(path.join(stagingDir, "host_self_manifest.json"), `${canonicalJSON(hostSelf)}\n`, "utf8");

        fs.rmSync(backupDir, { recursive: true, force: true });
        if (fs.existsSync(currentDir)) fs.renameSync(currentDir, backupDir);
        fs.renameSync(stagingDir, currentDir);
        fs.rmSync(backupDir, { recursive: true, force: true });
        applyAttempted = true;
        applyResult = "APPLIED";
      } catch {
        applyAttempted = true;
        applyResult = "ROLLED_BACK";
        applyReasons.push("HOST_APPLY_FAILED");
        try {
          if (fs.existsSync(currentDir)) fs.rmSync(currentDir, { recursive: true, force: true });
          if (fs.existsSync(backupDir)) fs.renameSync(backupDir, currentDir);
        } catch {
          applyReasons.push("HOST_ROLLBACK_FAILED");
        }
      }
    }
  }

  const hostRootDigest = trust.ok ? computeHostRootDigest(trust) : computeArtifactDigestV0("host-root");
  const receipt: HostUpdateReceiptV0 = {
    schema: "weftend.host.updateReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild: computeWeftendBuildV0({
      filePath: process?.env?.WEFTEND_HOST_BINARY_PATH || process.execPath || "",
      source: "HOST_BINARY_PATH",
    }).build,
    hostRootDigest,
    releaseId: manifest?.releaseId,
    ...(hostSelfId ? { hostSelfId } : {}),
    decision: decisionReasons.length > 0 ? "DENY" : "ALLOW",
    reasonCodes: stableSortUniqueReasonsV0(decisionReasons),
    verify: { status: verifyStatus, reasonCodes: stableSortUniqueReasonsV0(verifyReasons) },
    apply: {
      attempted: applyAttempted,
      result: applyResult,
      reasonCodes: stableSortUniqueReasonsV0(applyReasons),
    },
    artifactsWritten: [{ name: RECEIPT_NAME, digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }],
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeHostUpdateReceiptDigestV0(receipt);
  receipt.artifactsWritten = [{ name: RECEIPT_NAME, digest: receipt.receiptDigest }];

  const issues = validateHostUpdateReceiptV0(receipt, "hostUpdateReceipt");
  if (issues.length > 0) {
    throw new Error("HOST_UPDATE_RECEIPT_INVALID");
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, RECEIPT_NAME), `${canonicalJSON(receipt)}\n`, "utf8");

  const exitCode = receipt.decision === "ALLOW" && applyResult === "APPLIED" ? 0 : 40;
  return { receipt, exitCode };
};

export const getHostStatusV0 = (hostRoot: string, trustRootPath: string) => {
  const status = getHostSelfStatus(hostRoot, trustRootPath);
  return status;
};
