// src/runtime/strict/strict_executor.test.ts
// Strict executor tests (preflight stamp observation).

import { StrictExecutor } from "./strict_executor";
import { ArtifactStoreV0, computeArtifactDigestV0 } from "../store/artifact_store";
import { makeReleaseCryptoPort, makeReleaseManifest, releaseKeyAllowlist } from "../test_support/release_manifest";
import type { PlanSnapshotV0 } from "../../core/types";
import { computePathDigestV0 } from "../../core/validate";

declare const require: (id: string) => any;
declare const __dirname: string;

type TestFn = () => void | Promise<void>;

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

const path = require("path");
const workerScript = path.resolve(__dirname, "sandbox_bootstrap.js");

const makePlanSnapshot = (planDigest: string, blockHash: string): PlanSnapshotV0 => ({
  schema: "weftend.plan/0",
  graphDigest: "graph-1",
  artifacts: [{ nodeId: `block:${blockHash}`, contentHash: `hash-${blockHash}` }],
  policyDigest: "policy-1",
  evidenceDigests: [],
  grants: [{ blockHash, eligibleCaps: [] }],
  mode: "strict",
  tier: "T1",
  pathSummary: {
    schema: "weftend.pathSummary/0",
    v: 0,
    pipelineId: "TEST_PIPELINE",
    weftendVersion: "0.0.0",
    publishInputHash: "fnv1a32:aa11",
    trustPolicyHash: "fnv1a32:bb22",
    anchors: { a1Hash: "fnv1a32:a1", a2Hash: "fnv1a32:a2", a3Hash: "fnv1a32:a3" },
    plan: { planHash: planDigest, trustHash: "fnv1a32:t1" },
    bundle: { bundleHash: "fnv1a32:b1" },
    packages: [],
    artifacts: [{ ref: blockHash, digest: "fnv1a32:cc33" }],
  },
});

suite("runtime/strict executor", () => {
  register("preflight captures runtimeObservedStamp and calls callback", async () => {
    let captured: any = null;
    const planDigest = "plan-1";
    const blockHash = "block-1";
    const planSnapshot = makePlanSnapshot(planDigest, blockHash);
    const pathDigest = computePathDigestV0(planSnapshot.pathSummary);
    const exec = new StrictExecutor({
      workerScript,
      planDigest,
      callerBlockHash: blockHash,
      grantedCaps: [],
      sourceText: "exports.main = () => ({ ok: true });",
      entryExportName: "main",
      runtimeTier: "T1",
      onRuntimeObservedStamp: (obs) => {
        captured = obs;
      },
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
    });

    const res = await exec.run();
    await exec.terminate();
    assertEq(res.ok, false, "expected preflight failure");

    const observed = exec.getRuntimeObservedStamp();
    assert(observed, "expected runtimeObservedStamp");
    assertEq(observed?.status, "UNSTAMPED", "expected UNSTAMPED status");
    assert(observed?.reasonCodes?.includes("STAMP_MISSING"), "expected STAMP_MISSING reason");
    assert(captured, "expected callback capture");
    assertEq(captured.status, "UNSTAMPED", "expected callback status");
  });

  register("refuses to run when release manifest is missing", async () => {
    const exec = new StrictExecutor({
      workerScript,
      planDigest: "plan-2",
      callerBlockHash: "block-2",
      grantedCaps: [],
      sourceText: "exports.main = () => ({ ok: true });",
      entryExportName: "main",
      planSnapshot: makePlanSnapshot("plan-2", "block-2"),
    });

    const res = await exec.run();
    await exec.terminate();
    assertEq(res.ok, false, "expected release manifest failure");
    assert((res as any).reasonCodes?.includes("RELEASE_MANIFEST_MISSING"), "expected RELEASE_MANIFEST_MISSING");
  });

  register("fails preflight on privacy-forbidden path summary fields", async () => {
    const planDigest = "plan-privacy-1";
    const blockHash = "block-privacy-1";
    const planSnapshot = makePlanSnapshot(planDigest, blockHash);
    planSnapshot.pathSummary.publishInputHash = "user@example.com";
    const pathDigest = computePathDigestV0(planSnapshot.pathSummary);

    const exec = new StrictExecutor({
      workerScript,
      planDigest,
      callerBlockHash: blockHash,
      grantedCaps: [],
      sourceText: "exports.main = () => ({ ok: true });",
      entryExportName: "main",
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
    });

    const res = await exec.run();
    await exec.terminate();
    assertEq(res.ok, false, "expected privacy preflight failure");
    assert((res as any).reasonCodes?.includes("PRIVACY_FIELD_FORBIDDEN"), "expected PRIVACY_FIELD_FORBIDDEN");
  });

  register("MAYBE release status denies execution with RELEASE_UNVERIFIED", async () => {
    const planDigest = "plan-maybe-1";
    const blockHash = "block-maybe-1";
    const planSnapshot = makePlanSnapshot(planDigest, blockHash);
    const pathDigest = computePathDigestV0(planSnapshot.pathSummary);

    const exec = new StrictExecutor({
      workerScript,
      planDigest,
      callerBlockHash: blockHash,
      grantedCaps: [],
      sourceText: "exports.main = () => ({ ok: true });",
      entryExportName: "main",
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
      testReleaseVerifyOverride: {
        status: "MAYBE",
        reasonCodes: [],
        observedReleaseId: "release-maybe-1",
        observedPlanDigest: planDigest,
        observedPathDigest: pathDigest,
      },
    });

    const res = await exec.run();
    await exec.terminate();
    assertEq(res.ok, false, "expected MAYBE to deny execution");
    assert((res as any).reasonCodes?.includes("RELEASE_UNVERIFIED"), "expected RELEASE_UNVERIFIED");
  });

  register("requires build attestation when strict policy demands it", async () => {
    const planDigest = "plan-attestation-1";
    const blockHash = "block-attestation-1";
    const planSnapshot = makePlanSnapshot(planDigest, blockHash);
    const pathDigest = computePathDigestV0(planSnapshot.pathSummary);

    const exec = new StrictExecutor({
      workerScript,
      planDigest,
      callerBlockHash: blockHash,
      grantedCaps: [],
      sourceText: "exports.main = () => ({ ok: true });",
      entryExportName: "main",
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
      strictPolicy: { requireBuildAttestation: true },
    });

    const res = await exec.run();
    await exec.terminate();
    assertEq(res.ok, false, "expected build attestation preflight failure");
    assert((res as any).reasonCodes?.includes("BUILD_ATTESTATION_MISSING"), "expected BUILD_ATTESTATION_MISSING");
  });

  register("denies execution when artifact digest mismatches and emits tartarus", async () => {
    const planDigest = "plan-3";
    const blockHash = "block-3";
    const planSnapshot = makePlanSnapshot(planDigest, blockHash);
    const pathDigest = computePathDigestV0(planSnapshot.pathSummary);
    const goodSource = "exports.main = () => ({ ok: true });";
    const digest = computeArtifactDigestV0(goodSource);
    const store = new ArtifactStoreV0({ planDigest, blockHash });
    (store as any).current.set(digest, "tampered");

    let incident: any = null;
    const exec = new StrictExecutor({
      workerScript,
      planDigest,
      callerBlockHash: blockHash,
      grantedCaps: [],
      sourceText: goodSource,
      entryExportName: "main",
      artifactStore: store,
      expectedSourceDigest: digest,
      onArtifactIncident: (record) => {
        incident = record;
      },
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
    });

    const res = await exec.run();
    await exec.terminate();
    assertEq(res.ok, false, "expected artifact mismatch deny");
    assert((res as any).reasonCodes?.includes("ARTIFACT_DIGEST_MISMATCH"), "expected ARTIFACT_DIGEST_MISMATCH");
    assertEq(incident?.kind, "artifact.mismatch", "expected artifact.mismatch tartarus");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`strict_executor.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
