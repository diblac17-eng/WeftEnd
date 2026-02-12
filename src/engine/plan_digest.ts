/* src/engine/plan_digest.ts */
/**
 * WeftEnd plan digest v0 (pure, deterministic).
 */

import { canonicalJSON } from "../core/canon";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { normalizePathSummaryV0 } from "../core/validate";
import type { PlanSnapshotV0 } from "../core/types";

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizeSnapshot = (snapshot: PlanSnapshotV0): PlanSnapshotV0 => {
  const artifacts = [...snapshot.artifacts].sort((a, b) => {
    const c = a.nodeId.localeCompare(b.nodeId);
    if (c !== 0) return c;
    return a.contentHash.localeCompare(b.contentHash);
  });

  const evidenceDigests = stableSortUniqueStringsV0(snapshot.evidenceDigests || []);

  const grants = [...snapshot.grants]
    .sort((a, b) => a.blockHash.localeCompare(b.blockHash))
    .map((grant) => ({
      blockHash: grant.blockHash,
      eligibleCaps: stableSortUniqueStringsV0(grant.eligibleCaps || []),
    }));

  return {
    schema: snapshot.schema,
    graphDigest: snapshot.graphDigest,
    artifacts,
    policyDigest: snapshot.policyDigest,
    evidenceDigests,
    grants,
    mode: snapshot.mode,
    tier: snapshot.tier,
    pathSummary: normalizePathSummaryV0(snapshot.pathSummary),
  };
};

export const computePlanDigestV0 = (snapshot: PlanSnapshotV0): string => {
  const normalized = normalizeSnapshot(snapshot);
  const canon = canonicalJSON(normalized);
  return `fnv1a32:${fnv1a32(canon)}`;
};
