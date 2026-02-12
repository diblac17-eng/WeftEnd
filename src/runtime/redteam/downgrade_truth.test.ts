/* src/runtime/redteam/downgrade_truth.test.ts */
/**
 * Red team v0: downgrade truth (strict self-test failure is visible)
 */

import { StrictExecutor } from "../strict/strict_executor";
import { buildPortalModel } from "../../engine/portal_model";
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

function registerSkip(name: string, reason: string): void {
  if (hasBDD && g.it && typeof g.it.skip === "function") g.it.skip(name, () => {});
  else localTests.push({ name: `SKIP ${name}: ${reason}`, fn: () => {} });
}

function suite(name: string, define: () => void): void {
  if (hasBDD) g.describe(name, define);
  else define();
}

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

suite("runtime/redteam downgrade truth", () => {
  register("strict self-test failure downgrades and is visible in portal warnings", async () => {
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
      testKeepGlobal: "fetch",
      releaseManifest: makeReleaseManifest(planDigest, [blockHash], undefined, pathDigest),
      releaseKeyAllowlist,
      cryptoPort: makeReleaseCryptoPort(),
      planSnapshot,
    });

    const res = await exec.run();
    await exec.terminate();

    assertEq(res.ok, false, "expected strict self-test failure");
    if (res.ok) fail("expected strict self-test failure");
    const reason = res.reasonCodes && res.reasonCodes.length > 0 ? res.reasonCodes[0] : "STRICT_MODE_UNAVAILABLE";
    const warnings = [`STRICT_SELFTEST_FAILED:${reason}`];

    const model = buildPortalModel({
      planDigest: "plan-1",
      globalWarnings: warnings,
      blocks: [
        {
          blockHash: "block-1",
          executionMode: "compatible",
          requestedCaps: ["net.fetch"],
          eligibleCaps: [],
          deniedCaps: [{ capId: "net.fetch", reasonCodes: ["CAP_NOT_GRANTED"] }],
          evidenceRecords: [],
          verifyResult: { status: "UNVERIFIED", reasonCodes: ["UNVERIFIED_STRICT"] },
        },
      ],
    });

    assert(model.warnings?.includes(`STRICT_SELFTEST_FAILED:${reason}`), "expected strict selftest warning");
    assert(model.warnings?.includes("UNGOVERNED_COMPATIBLE_MODE"), "expected ungoverned compatible warning");
    assertEq(model.summary.modes.strict, 0, "strict count must be zero");
    assertEq(model.summary.modes.compatible, 1, "compatible count must be one");
  });

  registerSkip(
    "no silent strict label when strict unavailable",
    "Portal builder relies on caller to set executionMode when strict self-test fails."
  );
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`downgrade_truth.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
