/* src/runtime/redteam/boundary_spoof_replay.test.ts */
/**
 * Red team v0: boundary spoofing + replay (runtime)
 */

import { CapKernel } from "../kernel/cap_kernel";
import { StrictExecutor } from "../strict/strict_executor";
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

const makeKernel = () =>
  new CapKernel({
    planDigest: "plan-1",
    callerBlockHash: "block-1",
    executionMode: "strict",
    sessionNonce: "nonce-1",
    grantedCaps: new Set(["net.fetch"]),
    knownCaps: new Set(["net.fetch"]),
    disabledCaps: new Set(),
  });

const assertSorted = (codes: string[]) => {
  const sorted = [...codes].sort();
  assertEq(JSON.stringify(sorted), JSON.stringify(codes), "reason codes must be sorted");
};

const path = require("path");
const workerScript = path.resolve(__dirname, "..", "strict", "sandbox_bootstrap.js");

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
    publishInputHash: "sha256:aa11",
    trustPolicyHash: "sha256:bb22",
    anchors: { a1Hash: "sha256:a1", a2Hash: "sha256:a2", a3Hash: "sha256:a3" },
    plan: { planHash: planDigest, trustHash: "sha256:t1" },
    bundle: { bundleHash: "sha256:b1" },
    packages: [],
    artifacts: [{ ref: blockHash, digest: "sha256:cc33" }],
  },
});

const makeTestSource = () => {
  let handler: ((msg: any) => void) | null = null;
  return {
    onMessage: (h: (msg: any) => void) => {
      handler = h;
    },
    emit: (msg: any) => {
      if (handler) handler(msg);
    },
  };
};

suite("runtime/redteam boundary spoof/replay", () => {
  register("wrong channel spoof is rejected", async () => {
    const source = makeTestSource();
    const planDigest = "plan-1";
    const blockHash = "block-1";
    const planSnapshot = makePlanSnapshot(planDigest, blockHash);
    const pathDigest = computePathDigestV0(planSnapshot.pathSummary);
    const exec = new StrictExecutor({
      workerScript,
      planDigest,
      callerBlockHash: blockHash,
      grantedCaps: ["net.fetch"],
      sourceText: "exports.main = () => ({ ok: true });",
      entryExportName: "main",
      testUntrustedMessageSource: source,
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
    });

    const runPromise = exec.run();
    source.emit({
      kind: "invoke",
      reqId: "x",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-bad",
      callerBlockHash: "block-1",
    });

    const res = await runPromise;
    await exec.terminate();
    assertEq(res.ok, false, "expected untrusted channel failure");
    if (!res.ok) {
      assert(res.reasonCodes?.includes("UNTRUSTED_CHANNEL"), "expected UNTRUSTED_CHANNEL");
    }
  });

  register("wrong nonce is rejected", () => {
    const kernel = makeKernel();
    const { decision } = kernel.handleInvoke({
      reqId: "r1",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-bad",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("NONCE_MISMATCH"), "expected NONCE_MISMATCH");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });

  register("wrong callerBlockHash is rejected", () => {
    const kernel = makeKernel();
    const { decision } = kernel.handleInvoke({
      reqId: "r2",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-OTHER",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("CALLER_MISMATCH"), "expected CALLER_MISMATCH");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });

  register("replay is rejected deterministically", () => {
    const kernel = makeKernel();
    kernel.handleInvoke({
      reqId: "dup",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    const { decision } = kernel.handleInvoke({
      reqId: "dup",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("REPLAY_DETECTED"), "expected REPLAY_DETECTED");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`boundary_spoof_replay.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
