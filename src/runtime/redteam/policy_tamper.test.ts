/* src/runtime/redteam/policy_tamper.test.ts */
/**
 * Red team v0: policy/verifier tampering (runtime)
 */

import { computePlanDigestV0 } from "../../engine/plan_digest";
import { CapKernel } from "../kernel/cap_kernel";
import { buildEvidenceRegistry, verifyEvidenceRecords } from "../../engine/evidence";
import { computeEvidenceIdV0 } from "../../core/validate";
import { keytransInclusionVerifier } from "../../engine/verifiers/keytrans-inclusion";
import type { PlanSnapshotV0 } from "../../core/types";

type TestFn = () => void;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    fail(`${msg}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
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
  publishInputHash: "fnv1a32:aa11",
  trustPolicyHash: "fnv1a32:bb22",
  anchors: { a1Hash: "fnv1a32:a1", a2Hash: "fnv1a32:a2", a3Hash: "fnv1a32:a3" },
  plan: { planHash: "fnv1a32:p1", trustHash: "fnv1a32:t1" },
  bundle: { bundleHash: "fnv1a32:b1" },
  packages: [],
  artifacts: [],
});

suite("runtime/redteam policy tamper", () => {
  register("planDigest changes when policyDigest changes", () => {
    const base: PlanSnapshotV0 = {
      schema: "weftend.plan/0",
      graphDigest: "graph-1",
      artifacts: [{ nodeId: "block:a", contentHash: "hash-a" }],
      policyDigest: "policy-1",
      evidenceDigests: ["e1"],
      grants: [{ blockHash: "block-a", eligibleCaps: ["net.fetch"] }],
      mode: "strict",
      tier: "T1",
      pathSummary: basePathSummary(),
    };

    const d1 = computePlanDigestV0(base);
    const d2 = computePlanDigestV0({ ...base, policyDigest: "policy-2" });
    assert(d1 !== d2, "planDigest must change when policyDigest changes");
  });

  register("runtime rejects planDigest mismatch", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      knownCaps: new Set(["net.fetch"]),
      disabledCaps: new Set(),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r1",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-2",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("PLANDIGEST_MISMATCH"), "expected PLANDIGEST_MISMATCH");
  });

  register("verifier identity/version is recorded", () => {
    const registry = buildEvidenceRegistry([keytransInclusionVerifier]);
    const record: any = {
      kind: "keytrans.inclusion.v1",
      payload: { directoryHeadDigest: "fnv1a32:aaaa", keyIdDigest: "fnv1a32:bbbb" },
      subject: { nodeId: "block:a", contentHash: "hash-a" },
    };
    const records = [{ ...record, evidenceId: computeEvidenceIdV0(record) }] as any;

    const results = verifyEvidenceRecords(records, registry, { planDigest: "plan-1", callerBlockHash: "block-a" });
    assertEq(results.length, 1, "expected one verify result");
    assert(results[0].verifierId === "keytrans.inclusion", "expected verifierId");
    assert(results[0].verifierVersion === "1", "expected verifierVersion");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`policy_tamper.test.ts: ${t.name} failed${detail}`);
    }
  }
}
