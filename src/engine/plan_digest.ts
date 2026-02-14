/* src/engine/plan_digest.ts */
/**
 * WeftEnd plan digest v0 (pure, deterministic).
 */

import { canonicalJSON } from "../core/canon";
import { sha256HexV0 } from "../core/hash_v0";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { normalizePathSummaryV0 } from "../core/validate";
import type { PlanSnapshotV0 } from "../core/types";

const sha256 = (input: string): string => sha256HexV0(input);

const normalizeSnapshot = (snapshot: PlanSnapshotV0): PlanSnapshotV0 => {
  const artifacts = [...snapshot.artifacts].sort((a, b) => {
    const c = cmpStrV0(a.nodeId, b.nodeId);
    if (c !== 0) return c;
    return cmpStrV0(a.contentHash, b.contentHash);
  });

  const evidenceDigests = stableSortUniqueStringsV0(snapshot.evidenceDigests || []);

  const grants = [...snapshot.grants]
    .sort((a, b) => cmpStrV0(a.blockHash, b.blockHash))
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
  return `sha256:${sha256(canon)}`;
};
