// src/core/mint_digest.ts
// Deterministic canonicalization + digest for WeftEnd Mint Package v1.

import { canonicalJSON } from "./canon";
import { sha256HexV0 } from "./hash_v0";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "./trust_algebra_v0";
import type {
  MintCaptureV1,
  MintDigestsV1,
  MintGradeV1,
  MintInputV1,
  MintObservationsV1,
  MintProbeResultV1,
  MintReceiptV1,
  WeftendMintPackageV1,
} from "./types";

const sha256 = (input: string): string => sha256HexV0(input);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const normalizeCounts = (input: Record<string, number> | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!input) return out;
  const keys = Object.keys(input).sort();
  for (const key of keys) {
    const value = input[key];
    if (Number.isFinite(value)) out[key] = Math.max(0, Math.floor(value));
  }
  return out;
};

const normalizeProbe = (probe: MintProbeResultV1): MintProbeResultV1 => ({
  status: probe.status,
  reasonCodes: stableSortUniqueReasonsV0(probe.reasonCodes ?? []),
  deniedCaps: normalizeCounts(probe.deniedCaps ?? {}),
  attemptedCaps: normalizeCounts(probe.attemptedCaps ?? {}),
});

const normalizeReceipt = (receipt: MintReceiptV1): MintReceiptV1 => {
  const reasonCodes = stableSortUniqueReasonsV0(receipt.reasonCodes ?? []);
  const summaryCounts = normalizeCounts(receipt.summaryCounts);
  const out: MintReceiptV1 = {
    kind: receipt.kind,
    digest: receipt.digest,
  };
  if (Object.keys(summaryCounts).length > 0) out.summaryCounts = summaryCounts;
  if (reasonCodes.length > 0) out.reasonCodes = reasonCodes;
  return out;
};

const normalizeGrade = (grade: MintGradeV1): MintGradeV1 => {
  const reasonCodes = stableSortUniqueReasonsV0(grade.reasonCodes ?? []);
  const receipts = (grade.receipts ?? []).map(normalizeReceipt);
  receipts.sort((a, b) => {
    const kc = a.kind.localeCompare(b.kind);
    if (kc !== 0) return kc;
    return a.digest.localeCompare(b.digest);
  });
  const out: MintGradeV1 = {
    status: grade.status,
    reasonCodes,
    receipts,
  };
  if (Array.isArray(grade.scars) && grade.scars.length > 0) {
    out.scars = stableSortUniqueStringsV0(grade.scars);
  }
  return out;
};

const normalizeObservations = (obs: MintObservationsV1): MintObservationsV1 => ({
  fileKinds: obs.fileKinds,
  externalRefs: stableSortUniqueStringsV0(obs.externalRefs ?? []),
  scriptsDetected: Boolean(obs.scriptsDetected),
  wasmDetected: Boolean(obs.wasmDetected),
});

const normalizeCapture = (capture?: MintCaptureV1): MintCaptureV1 | undefined => {
  if (!capture) return undefined;
  const paths =
    Array.isArray(capture.paths) && capture.paths.length > 0
      ? stableSortUniqueStringsV0(capture.paths)
      : undefined;
  const out: MintCaptureV1 = { captureDigest: capture.captureDigest };
  if (paths && paths.length > 0) out.paths = paths;
  return out;
};

const normalizeInput = (input: MintInputV1): MintInputV1 => ({
  kind: input.kind,
  rootDigest: input.rootDigest,
  fileCount: Math.max(0, Math.floor(input.fileCount)),
  totalBytes: Math.max(0, Math.floor(input.totalBytes)),
});

const normalizeDigests = (digests: MintDigestsV1): MintDigestsV1 => ({
  mintDigest: digests.mintDigest,
  inputDigest: digests.inputDigest,
  policyDigest: digests.policyDigest,
});

export const normalizeMintPackageV1 = (pkg: WeftendMintPackageV1): WeftendMintPackageV1 => {
  const probes = pkg.executionProbes;
  const out: WeftendMintPackageV1 = {
    schema: "weftend.mint/1",
    profile: pkg.profile,
    input: normalizeInput(pkg.input),
    observations: normalizeObservations(pkg.observations),
    executionProbes: {
      strictAvailable: Boolean(probes.strictAvailable),
      loadOnly: normalizeProbe(probes.loadOnly),
    },
    grade: normalizeGrade(pkg.grade),
    digests: normalizeDigests(pkg.digests),
    limits: pkg.limits,
  };
  if (pkg.capture) out.capture = normalizeCapture(pkg.capture);
  if (!probes.strictAvailable && isNonEmptyString(probes.strictUnavailableReason)) {
    out.executionProbes.strictUnavailableReason = probes.strictUnavailableReason;
  }
  if (probes.interactionScript) {
    out.executionProbes.interactionScript = normalizeProbe(probes.interactionScript);
  }
  return out;
};

export const canonicalizeMintPackageV1 = (pkg: WeftendMintPackageV1): string => {
  const normalized = normalizeMintPackageV1(pkg);
  const digests = { ...normalized.digests, mintDigest: "" };
  const body: WeftendMintPackageV1 = { ...normalized, digests };
  return canonicalJSON(body);
};

export const computeMintDigestV1 = (pkg: WeftendMintPackageV1): string =>
  `sha256:${sha256(canonicalizeMintPackageV1(pkg))}`;

