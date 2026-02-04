// src/runtime/release/release_loader.test.ts
// Release loader tests (verify-at-load).

import { verifyReleaseManifestV0 } from "./release_loader";
import { computePathDigestV0 } from "../../core/validate";
import { makeReleaseCryptoPort, makeReleaseManifest, releaseKeyAllowlist } from "../test_support/release_manifest";

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

suite("runtime/release_loader v0", () => {
  register("verifies a valid release manifest", () => {
    const pathDigest = "fnv1a32:path-ok";
    const manifest = makeReleaseManifest("plan-1", ["block-a"], undefined, pathDigest);
    const res = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest: "plan-1",
      expectedBlocks: ["block-a"],
      expectedPathDigest: pathDigest,
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assertEq(res.status, "OK", "expected OK status");
    assertEq(res.reasonCodes.length, 0, "expected no reasons");
  });

  register("fails closed when manifest is missing", () => {
    const res = verifyReleaseManifestV0({
      manifest: null,
      expectedPlanDigest: "plan-1",
      expectedBlocks: ["block-a"],
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assertEq(res.status, "UNVERIFIED", "expected UNVERIFIED");
    assert(res.reasonCodes.includes("RELEASE_MANIFEST_MISSING"), "expected RELEASE_MANIFEST_MISSING");
  });

  register("rejects bad signature", () => {
    const pathDigest = "fnv1a32:path-ok";
    const manifest = makeReleaseManifest("plan-1", ["block-a"], undefined, pathDigest);
    manifest.signatures[0].sigB64 = "AQ==";
    const res = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest: "plan-1",
      expectedBlocks: ["block-a"],
      expectedPathDigest: pathDigest,
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assertEq(res.status, "UNVERIFIED", "expected UNVERIFIED");
    assert(res.reasonCodes.includes("RELEASE_SIGNATURE_BAD"), "expected RELEASE_SIGNATURE_BAD");
  });

  register("rejects planDigest mismatch", () => {
    const pathDigest = "fnv1a32:path-ok";
    const manifest = makeReleaseManifest("plan-1", ["block-a"], undefined, pathDigest);
    const res = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest: "plan-2",
      expectedBlocks: ["block-a"],
      expectedPathDigest: pathDigest,
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assert(res.reasonCodes.includes("RELEASE_PLANDIGEST_MISMATCH"), "expected RELEASE_PLANDIGEST_MISMATCH");
  });

  register("rejects blockset mismatch", () => {
    const pathDigest = "fnv1a32:path-ok";
    const manifest = makeReleaseManifest("plan-1", ["block-a", "block-b"], undefined, pathDigest);
    const res = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest: "plan-1",
      expectedBlocks: ["block-a"],
      expectedPathDigest: pathDigest,
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assert(res.reasonCodes.includes("RELEASE_BLOCKSET_MISMATCH"), "expected RELEASE_BLOCKSET_MISMATCH");
  });

  register("rejects missing pathDigest when expected", () => {
    const manifest = makeReleaseManifest("plan-1", ["block-a"], undefined, "fnv1a32:path-ok");
    delete (manifest as any).manifestBody.pathDigest;
    const res = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest: "plan-1",
      expectedBlocks: ["block-a"],
      expectedPathDigest: "fnv1a32:path-missing",
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assertEq(res.status, "UNVERIFIED", "expected UNVERIFIED");
    assert(res.reasonCodes.includes("PATH_DIGEST_MISSING"), "expected PATH_DIGEST_MISSING");
  });

  register("rejects pathDigest mismatch", () => {
    const pathSummary = {
      schema: "weftend.pathSummary/0",
      v: 0,
      pipelineId: "TEST_PIPELINE",
      weftendVersion: "0.0.0",
      publishInputHash: "fnv1a32:aa11",
      trustPolicyHash: "fnv1a32:bb22",
      anchors: { a1Hash: "fnv1a32:a1", a2Hash: "fnv1a32:a2", a3Hash: "fnv1a32:a3" },
      plan: { planHash: "fnv1a32:p1", trustHash: "fnv1a32:t1" },
      bundle: { bundleHash: "fnv1a32:b1" },
      packages: [],
      artifacts: [],
    };
    const expectedPathDigest = computePathDigestV0(pathSummary as any);
    const manifest = makeReleaseManifest("plan-1", ["block-a"], undefined, "fnv1a32:path-ok");
    const res = verifyReleaseManifestV0({
      manifest,
      expectedPlanDigest: "plan-1",
      expectedBlocks: ["block-a"],
      expectedPathDigest,
      cryptoPort: makeReleaseCryptoPort(),
      keyAllowlist: releaseKeyAllowlist,
    });
    assertEq(res.status, "UNVERIFIED", "expected UNVERIFIED");
    assert(res.reasonCodes.includes("PATH_DIGEST_MISMATCH"), "expected PATH_DIGEST_MISMATCH");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`release_loader.test.ts: ${t.name} failed${detail}`);
    }
  }
}
