/* src/engine/redteam/evidence_swap.test.ts */
/**
 * Red team v0: evidence swapping + plan binding (engine)
 */

import { computePlanDigestV0 } from "../plan_digest";
import type { PlanSnapshotV0 } from "../../core/types";
import { computeEvidenceIdV0, validateEvidenceRecord } from "../../core/validate";

type TestFn = () => void;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

const g: any = globalThis as any;
const hasBDD = typeof g.describe === "function" && typeof g.it === "function";
const localTests: Array<{ name: string; fn: TestFn }> = [];

function register(name: string, fn: TestFn): void {
  if (hasBDD) g.it(name, fn);
  else localTests.push({ name, fn });
}

function suite(name: string, define: () => void): void {
  if (hasBDD) g.describe(name, define);
  else define();
}

const basePathSummary = () => ({
  schema: "weftend.pathSummary/0" as const,
  v: 0 as const,
  pipelineId: "TEST_PIPELINE",
  weftendVersion: "0.0.0",
  publishInputHash: "sha256:aa11",
  trustPolicyHash: "sha256:bb22",
  anchors: { a1Hash: "sha256:a1", a2Hash: "sha256:a2", a3Hash: "sha256:a3" },
  plan: { planHash: "sha256:p1", trustHash: "sha256:t1" },
  bundle: { bundleHash: "sha256:b1" },
  packages: [],
  artifacts: [],
});

suite("engine/redteam evidence swap", () => {
  register("planDigest commits to evidence digests", () => {
    const base: PlanSnapshotV0 = {
      schema: "weftend.plan/0",
      graphDigest: "graph-1",
      artifacts: [{ nodeId: "block:a", contentHash: "hash-a" }],
      policyDigest: "policy-1",
      evidenceDigests: ["e1", "e2"],
      grants: [{ blockHash: "block-a", eligibleCaps: ["net.fetch"] }],
      mode: "strict",
      tier: "T1",
      pathSummary: basePathSummary(),
    };

    const d1 = computePlanDigestV0(base);
    const d2 = computePlanDigestV0({ ...base, evidenceDigests: ["e1", "e3"] });
    assert(d1 !== d2, "planDigest must change when evidence digests change");
  });

  register("evidence envelope digest binds payload", () => {
    const record: any = {
      kind: "signature.v1",
      payload: { sig: "ok" },
      subject: { nodeId: "block:a", contentHash: "hash-a" },
    };
    const evidenceId = computeEvidenceIdV0(record);
    const tampered = {
      ...record,
      evidenceId,
      payload: { sig: "tampered" },
    };

    const issues = validateEvidenceRecord(tampered, "record");
    assert(issues.some((i) => i.code === "EVIDENCE_DIGEST_MISMATCH"), "expected digest mismatch");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`evidence_swap.test.ts: ${t.name} failed${detail}`);
    }
  }
}
