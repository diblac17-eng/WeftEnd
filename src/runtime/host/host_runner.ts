// src/runtime/host/host_runner.ts
// Node host runner for strict execution (verify-first, deterministic).

import { canonicalJSON } from "../../core/canon";
import type {
  EvidenceBundleV0,
  HostRunReceiptV0,
  PlanSnapshotV0,
  ReleaseManifestV0,
  RuntimeBundle,
} from "../../core/types";
import {
  computeEvidenceBundleDigestV0,
  computeHostRunReceiptDigestV0,
  computePathDigestV0,
  validateEvidenceBundleV0,
  validateHostRunReceiptV0,
  validatePlanSnapshotV0,
  validateReleaseManifestV0,
  validateRuntimeBundle,
} from "../../core/validate";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";
import { verifyReleaseManifestV0 } from "../release/release_loader";
import { StrictExecutor } from "../strict/strict_executor";
import { ArtifactStoreV0, computeArtifactDigestV0 } from "../store/artifact_store";
import { buildHostCapsSummaryV0 } from "./host_caps";
import { makeDemoCryptoPort } from "../../ports/crypto-demo";
import type { CapDenyTelemetry } from "../kernel/cap_kernel";
import { getHostSelfStatus, readTrustRoot } from "./host_self_manifest";
import { computeWeftendBuildV0 } from "../weftend_build";
import { captureTreeV0 } from "../examiner/capture_tree_v0";
import { detectLayersV0 } from "../examiner/detect_layers_v0";
import { buildContentSummaryV0 } from "../examiner/content_summary_v0";
import { classifyArtifactKindV0 } from "../classify/artifact_kind_v0";
import { resolveLibraryRootV0 } from "../library_root";
import { sanitizeLibraryTargetKeyV0 } from "../library_keys";

declare const require: any;
declare const __dirname: string;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_INPUT_BYTES = 1024 * 1024;
const ZERO_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const RECEIPT_NAME = "host_run_receipt.json";
const DEFAULT_CAPTURE_LIMITS = {
  maxFiles: 20000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 256,
};
const DEFAULT_DETECT_LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxExternalRefs: 1000,
};

export interface HostRunOptionsV0 {
  releaseDir: string;
  outDir: string;
  entry?: string;
  hostRoot?: string;
  trustRootPath?: string;
  gateMode?: "enforced" | "off";
  testForceCompartmentUnavailable?: boolean;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const hasPemPublicKey = (key: string): boolean =>
  typeof key === "string" && key.includes("-----BEGIN") && key.includes("PUBLIC KEY-----");

const isDemoPublicKey = (key: string): boolean =>
  typeof key === "string" && key.startsWith("pub:");

const verifySignature = (payloadCanonical: string, sigKind: string, sigB64: string, publicKey: string): boolean => {
  if (!isNonEmptyString(sigKind) || !isNonEmptyString(sigB64) || !isNonEmptyString(publicKey)) return false;
  if (isDemoPublicKey(publicKey)) {
    const demo = makeDemoCryptoPort("host");
    return demo.verifySignature(payloadCanonical, { algo: sigKind, keyId: "release", sig: sigB64 }, publicKey);
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

const readTextBounded = (filePath: string, reasons: string[], missingCode: string, invalidCode: string) => {
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

const parseJson = (raw: string | null, reasons: string[], invalidCode: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    reasons.push(invalidCode);
    return null;
  }
};

const pickEntryBlock = (
  manifest: ReleaseManifestV0 | null,
  entryFlag?: string
): { block: string | null; reason?: string } => {
  const blocks = stableSortUniqueStringsV0(manifest?.manifestBody?.blocks ?? []);
  if (!blocks.length) return { block: null, reason: "HOST_ENTRY_MISSING" };
  if (entryFlag) {
    if (blocks.includes(entryFlag)) return { block: entryFlag };
    return { block: null, reason: "HOST_ENTRY_MISSING" };
  }
  return { block: blocks[0] ?? null };
};

const readBaselineDigest = (libraryRoot: string, targetKey: string): { ok: boolean; digest?: string } => {
  const viewDir = path.join(libraryRoot, targetKey, "view");
  const baselinePath = path.join(viewDir, "baseline.txt");
  if (!fs.existsSync(baselinePath)) return { ok: false };
  let baselineRun = "";
  try {
    baselineRun = fs.readFileSync(baselinePath, "utf8").split(/\r?\n/)[0]?.trim() || "";
  } catch {
    return { ok: false };
  }
  if (!baselineRun) return { ok: false };
  const runDir = path.join(libraryRoot, targetKey, baselineRun);
  const safePath = path.join(runDir, "safe_run_receipt.json");
  const runPath = path.join(runDir, "run_receipt.json");
  const hostPath = path.join(runDir, "host_run_receipt.json");
  const readDigest = (filePath: string): string | undefined => {
    if (!fs.existsSync(filePath)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const digest =
        parsed?.releaseDirDigest ||
        parsed?.inputDigest ||
        parsed?.artifactDigest;
      return isNonEmptyString(digest) ? String(digest) : undefined;
    } catch {
      return undefined;
    }
  };
  const digest = readDigest(safePath) || readDigest(runPath) || readDigest(hostPath);
  if (!digest) return { ok: false };
  return { ok: true, digest };
};

const findEntrySource = (bundle: RuntimeBundle | null, entryBlock: string | null, releaseDir: string) => {
  if (!bundle || !entryBlock) return { ok: false, reason: "HOST_ENTRY_MISSING" };
  const nodes = Array.isArray((bundle as any).manifest?.nodes) ? (bundle as any).manifest.nodes : [];
  const node = nodes.find((n: any) => n && n.id === entryBlock);
  if (!node || !node.artifact) return { ok: false, reason: "HOST_ENTRY_MISSING" };
  const artifact = node.artifact as any;
  const entryExport = isNonEmptyString(artifact.entry) ? artifact.entry : "main";
  if (artifact.kind === "inline") {
    const mime = isNonEmptyString(artifact.mime) ? artifact.mime.toLowerCase() : "";
    const text = typeof artifact.text === "string" ? artifact.text : "";
    if (!mime.includes("javascript")) return { ok: false, reason: "HOST_ENTRY_UNSUPPORTED" };
    return { ok: true, sourceText: text, entryExport };
  }
  if (artifact.kind === "ref") {
    const ref = isNonEmptyString(artifact.ref) ? artifact.ref : "";
    if (!ref) return { ok: false, reason: "HOST_ENTRY_MISSING" };
    const refPath = path.join(releaseDir, "artifacts", ref);
    const raw = readTextBounded(refPath, [], "HOST_ENTRY_MISSING", "HOST_ENTRY_READ_FAILED");
    if (!raw) return { ok: false, reason: "HOST_ENTRY_READ_FAILED" };
    return { ok: true, sourceText: raw, entryExport };
  }
  return { ok: false, reason: "HOST_ENTRY_UNSUPPORTED" };
};

export const runHostStrictV0 = async (options: HostRunOptionsV0): Promise<{ receipt: HostRunReceiptV0; exitCode: number }> => {
  const reasons: string[] = [];
  const releaseDir = path.resolve(process.cwd(), options.releaseDir || "");
  if (!options.releaseDir || !fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
    reasons.push("RELEASE_DIR_MISSING");
  }

  const hostRoot = path.resolve(process.cwd(), options.hostRoot || process?.env?.WEFTEND_HOST_ROOT || "");
  const trustRootPath = path.resolve(process.cwd(), options.trustRootPath || process?.env?.WEFTEND_HOST_TRUST_ROOT || "");
  const hostSelfStatus = hostRoot && trustRootPath
    ? getHostSelfStatus(hostRoot, trustRootPath)
    : { status: "MISSING" as const, reasonCodes: ["HOST_SELF_ROOT_MISSING"], hostSelfId: undefined };
  if (hostSelfStatus.status !== "OK") {
    reasons.push("HOST_SELF_UNVERIFIED");
    reasons.push(...hostSelfStatus.reasonCodes);
  }

  const manifestPath = path.join(releaseDir, "release_manifest.json");
  const bundlePath = path.join(releaseDir, "runtime_bundle.json");
  const evidencePath = path.join(releaseDir, "evidence.json");
  const keyPath = path.join(releaseDir, "release_public_key.json");

  const manifestRaw = readTextBounded(manifestPath, reasons, "RELEASE_MANIFEST_MISSING", "RELEASE_MANIFEST_INVALID");
  const bundleRaw = readTextBounded(bundlePath, reasons, "RUNTIME_BUNDLE_MISSING", "RUNTIME_BUNDLE_INVALID");
  const evidenceRaw = readTextBounded(evidencePath, reasons, "EVIDENCE_MISSING", "EVIDENCE_INVALID");
  const keyRaw = readTextBounded(keyPath, reasons, "PUBLIC_KEY_MISSING", "PUBLIC_KEY_INVALID");

  const manifestDigest = manifestRaw ? computeArtifactDigestV0(manifestRaw) : ZERO_DIGEST;
  const bundleDigest = bundleRaw ? computeArtifactDigestV0(bundleRaw) : ZERO_DIGEST;
  const evidenceDigest = evidenceRaw ? computeArtifactDigestV0(evidenceRaw) : ZERO_DIGEST;
  const publicKeyDigest = keyRaw ? computeArtifactDigestV0(keyRaw) : ZERO_DIGEST;

  const manifestParsed = parseJson(manifestRaw, reasons, "RELEASE_MANIFEST_INVALID") as ReleaseManifestV0 | null;
  if (manifestParsed) {
    const manifestIssues = validateReleaseManifestV0(manifestParsed, "release");
    if (manifestIssues.length > 0) reasons.push("RELEASE_MANIFEST_INVALID");
  }

  const bundleParsed = parseJson(bundleRaw, reasons, "RUNTIME_BUNDLE_INVALID");
  const bundleCheck = bundleParsed ? validateRuntimeBundle(bundleParsed) : null;
  const bundle = bundleCheck?.ok ? (bundleCheck.value as RuntimeBundle) : null;
  if (bundleParsed && bundleCheck && !bundleCheck.ok) reasons.push("RUNTIME_BUNDLE_INVALID");

  const evidenceParsed = parseJson(evidenceRaw, reasons, "EVIDENCE_INVALID") as EvidenceBundleV0 | null;
  if (evidenceParsed) {
    const evidenceIssues = validateEvidenceBundleV0(evidenceParsed, "evidence");
    if (evidenceIssues.length > 0) reasons.push("EVIDENCE_INVALID");
  }

  let keyId = "";
  let publicKey = "";
  if (keyRaw) {
    const keyParsed = parseJson(keyRaw, reasons, "PUBLIC_KEY_INVALID") as Record<string, unknown> | null;
    if (keyParsed) {
      keyId = isNonEmptyString(keyParsed.keyId) ? String(keyParsed.keyId) : "";
      publicKey = isNonEmptyString(keyParsed.publicKey) ? String(keyParsed.publicKey) : "";
      if (!keyId || !publicKey) reasons.push("PUBLIC_KEY_INVALID");
    }
  }

  const releaseDirDigest = computeArtifactDigestV0(
    canonicalJSON({
      releaseId: manifestParsed?.releaseId ?? "",
      manifestDigest,
      bundleDigest,
      evidenceDigest,
      publicKeyDigest,
    })
  );

  const planDigest = isNonEmptyString((bundle as any)?.plan?.planHash) ? (bundle as any).plan.planHash : "";
  const policyDigest = isNonEmptyString((bundle as any)?.trust?.policyId) ? (bundle as any).trust.policyId : "";
  const expectedBlocks = Array.isArray((bundle as any)?.plan?.nodes)
    ? stableSortUniqueStringsV0(
        (bundle as any).plan.nodes
          .map((n: any) => (n && typeof n.nodeId === "string" ? n.nodeId : ""))
          .filter((id: string) => id.startsWith("block:"))
      )
    : [];

  let expectedPathDigest: string | undefined;
  const planSnapshot = (bundleParsed as any)?.planSnapshot as PlanSnapshotV0 | undefined;
  if (planSnapshot) {
    const snapshotIssues = validatePlanSnapshotV0(planSnapshot, "planSnapshot");
    if (snapshotIssues.length > 0) {
      reasons.push("PATH_SUMMARY_INVALID");
    } else {
      expectedPathDigest = computePathDigestV0(planSnapshot.pathSummary);
    }
  }

  const trustRoot = hostRoot && trustRootPath
    ? readTrustRoot(trustRootPath)
    : { ok: false as const, reason: "HOST_TRUST_ROOT_MISSING" };
  if (!trustRoot.ok) {
    reasons.push(trustRoot.reason);
  }

  const trustPublicKey = trustRoot.ok ? trustRoot.publicKey : "";
  const trustKeyId = trustRoot.ok ? trustRoot.keyId : "";
  const cryptoPort =
    trustPublicKey && isDemoPublicKey(trustPublicKey)
      ? makeDemoCryptoPort("host")
      : trustPublicKey
        ? {
            hash: (canonical: string) => computeArtifactDigestV0(canonical),
            verifySignature: (payload: string, sig: { algo: string; sig: string }, pk: string) =>
              verifySignature(payload, sig.algo, sig.sig, pk),
          }
        : undefined;
  const keyAllowlist = trustPublicKey && trustKeyId ? { [trustKeyId]: trustPublicKey } : undefined;
  const releaseVerify = verifyReleaseManifestV0({
    manifest: manifestParsed ?? null,
    expectedPlanDigest: planDigest,
    expectedBlocks,
    expectedPathDigest,
    cryptoPort,
    keyAllowlist,
  });

  if (manifestParsed && bundle) {
    if (manifestParsed.manifestBody?.planDigest !== planDigest) reasons.push("RELEASE_PLANDIGEST_MISMATCH");
    if (manifestParsed.manifestBody?.policyDigest !== policyDigest) reasons.push("POLICY_DIGEST_MISMATCH");
  }

  if (manifestParsed?.manifestBody?.evidenceJournalHead) {
    if (!evidenceParsed) {
      reasons.push("EVIDENCE_MISSING");
    } else {
      const observed = computeEvidenceBundleDigestV0(evidenceParsed);
      if (observed !== manifestParsed.manifestBody.evidenceJournalHead) {
        reasons.push("EVIDENCE_HEAD_MISMATCH");
      }
    }
  }

  const verifyReasons = stableSortUniqueReasonsV0([
    ...(releaseVerify.reasonCodes ?? []),
    ...reasons,
  ]);
  const verifyVerdict = verifyReasons.length > 0 ? "DENY" : "ALLOW";

  const gateModeRequested = options.gateMode === "enforced" ? "enforced" : undefined;
  let gateVerdict: "ALLOW" | "BLOCK" | undefined;
  let gateReasonCodes: string[] = [];
  if (gateModeRequested === "enforced") {
    const targetName = isNonEmptyString(manifestParsed?.releaseId)
      ? String(manifestParsed?.releaseId)
      : path.basename(releaseDir);
    const targetKey = sanitizeLibraryTargetKeyV0(targetName);
    const libraryRoot = resolveLibraryRootV0().root;
    const baseline = readBaselineDigest(libraryRoot, targetKey);
    if (!baseline.ok || !baseline.digest) {
      gateVerdict = "BLOCK";
      gateReasonCodes = ["GATE_MODE_DENIED", "BASELINE_REQUIRED"];
    } else if (baseline.digest !== releaseDirDigest) {
      gateVerdict = "BLOCK";
      gateReasonCodes = ["GATE_MODE_DENIED", "GATE_MODE_CHANGED_BLOCKED"];
    } else {
      gateVerdict = "ALLOW";
      gateReasonCodes = [];
    }
  }
  const gateAllowsExecution = gateVerdict !== "BLOCK";

  let execute: { attempted: boolean; result: "ALLOW" | "DENY" | "SKIP"; reasonCodes: string[] } = {
    attempted: false,
    result: "SKIP",
    reasonCodes: stableSortUniqueReasonsV0(verifyReasons.length > 0 ? ["VERIFY_DENIED", ...verifyReasons] : ["VERIFY_DENIED"]),
  };
  let executionOk: boolean | undefined;

  const grantedCaps: string[] = [];
  const capTelemetry: CapDenyTelemetry[] = [];

  const entryPick = pickEntryBlock(manifestParsed, options.entry);
  const entryBlock = entryPick.block;
  if (gateAllowsExecution && verifyVerdict === "ALLOW" && entryBlock && !options.testForceCompartmentUnavailable) {
    const entry = findEntrySource(bundle, entryBlock, releaseDir);
    if (!entry.ok) {
      execute = {
        attempted: false,
        result: "SKIP",
        reasonCodes: stableSortUniqueReasonsV0([entry.reason]),
      };
    } else {
      const expectedSourceDigest = computeArtifactDigestV0(entry.sourceText ?? "");
      const store = new ArtifactStoreV0({ planDigest, blockHash: entryBlock });
      store.put(expectedSourceDigest, entry.sourceText ?? "");
      const workerScript = path.resolve(__dirname, "..", "strict", "sandbox_bootstrap.js");
      const exec = new StrictExecutor({
        workerScript,
        planDigest,
        callerBlockHash: entryBlock,
        grantedCaps,
        sourceText: entry.sourceText,
        entryExportName: entry.entryExport,
        artifactStore: store,
        expectedSourceDigest,
        releaseManifest: manifestParsed ?? undefined,
        releaseKeyAllowlist: keyAllowlist,
        cryptoPort,
        planSnapshot,
        evidenceBundle: evidenceParsed ?? undefined,
        onTelemetry: (event) => {
          capTelemetry.push(event);
        },
      });

      const res = await exec.run();
      await exec.terminate();
      const resReasons = stableSortUniqueReasonsV0(res && res.ok === false ? res.reasonCodes ?? [] : []);
      if (resReasons.includes("STRICT_COMPARTMENT_UNAVAILABLE")) {
        execute = {
          attempted: true,
          result: "SKIP",
          reasonCodes: ["STRICT_COMPARTMENT_UNAVAILABLE"],
        };
      } else {
        executionOk = res?.ok === true;
        execute = {
          attempted: true,
          result: executionOk ? "ALLOW" : "DENY",
          reasonCodes: resReasons,
        };
      }
    }
  } else if (gateAllowsExecution && verifyVerdict === "ALLOW" && options.testForceCompartmentUnavailable) {
    execute = {
      attempted: true,
      result: "SKIP",
      reasonCodes: ["STRICT_COMPARTMENT_UNAVAILABLE"],
    };
  } else if (gateAllowsExecution && verifyVerdict === "ALLOW" && entryPick.reason) {
    execute = {
      attempted: false,
      result: "SKIP",
      reasonCodes: stableSortUniqueReasonsV0([entryPick.reason]),
    };
  } else if (!gateAllowsExecution && gateVerdict === "BLOCK") {
    execute = {
      attempted: false,
      result: "DENY",
      reasonCodes: stableSortUniqueReasonsV0(gateReasonCodes),
    };
  }

  const caps = buildHostCapsSummaryV0(grantedCaps, capTelemetry);
  const artifactDigests = {
    releaseManifest: manifestDigest,
    runtimeBundle: bundleDigest,
    evidenceBundle: evidenceDigest,
    publicKey: publicKeyDigest,
  };
  const capture = captureTreeV0(releaseDir, DEFAULT_CAPTURE_LIMITS);
  const detect = detectLayersV0(capture, DEFAULT_DETECT_LIMITS);
  const classified = classifyArtifactKindV0(releaseDir, capture);
  const contentSummary = buildContentSummaryV0({
    inputPath: releaseDir,
    capture,
    observations: detect.observations,
    artifactKind: classified.artifactKind,
    policyMatch: {
      selectedPolicy: "UNKNOWN",
      reasonCodes: ["POLICY_UNKNOWN"],
    },
  });

  const receipt: HostRunReceiptV0 = {
    version: "host_run_receipt_v0",
    schemaVersion: 0,
    weftendBuild: computeWeftendBuildV0({
      filePath: process?.env?.WEFTEND_HOST_BINARY_PATH || process.execPath || "",
      source: "HOST_BINARY_PATH",
    }).build,
    ...(gateModeRequested ? { gateModeRequested } : {}),
    ...(gateVerdict ? { gateVerdict } : {}),
    ...(gateReasonCodes.length > 0 ? { gateReasonCodes: stableSortUniqueReasonsV0(gateReasonCodes) } : {}),
    releaseDirDigest,
    contentSummary,
    releaseId: manifestParsed?.releaseId,
    ...(hostSelfStatus.hostSelfId ? { hostSelfId: hostSelfStatus.hostSelfId } : {}),
    hostSelfStatus: hostSelfStatus.status,
    hostSelfReasonCodes: stableSortUniqueReasonsV0(hostSelfStatus.reasonCodes ?? []),
    releaseStatus: releaseVerify.status ?? "UNVERIFIED",
    releaseReasonCodes: stableSortUniqueReasonsV0(releaseVerify.reasonCodes ?? []),
    verify: { verdict: verifyVerdict, reasonCodes: verifyReasons },
    execute: {
      attempted: execute.attempted,
      result: execute.result,
      reasonCodes: stableSortUniqueReasonsV0(execute.reasonCodes ?? []),
      ...(executionOk !== undefined ? { executionOk } : {}),
    },
    entryUsed: options.entry || entryBlock || "unknown",
    caps,
    artifactDigests,
    artifactsWritten: [{ name: RECEIPT_NAME, digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }],
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };

  receipt.receiptDigest = computeHostRunReceiptDigestV0(receipt);
  receipt.artifactsWritten = [{ name: RECEIPT_NAME, digest: receipt.receiptDigest }];

  const issues = validateHostRunReceiptV0(receipt, "hostRunReceipt");
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.code}:${i.message}`).join("|");
    throw new Error(`HOST_RECEIPT_INVALID:${detail}`);
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  const receiptText = `${canonicalJSON(receipt)}\n`;
  fs.writeFileSync(path.join(options.outDir, RECEIPT_NAME), receiptText, "utf8");

  const exitCode =
    execute.result === "ALLOW" && executionOk === true
      ? 0
      : 40;

  return { receipt, exitCode };
};
