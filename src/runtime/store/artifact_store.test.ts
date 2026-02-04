// src/runtime/store/artifact_store.test.ts
// Artifact store recovery tests (deterministic, fail-closed).

import { ArtifactStoreV0, computeArtifactDigestV0 } from "./artifact_store";

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

suite("runtime/store artifact_store", () => {
  register("recovers from tampered artifact and emits incident", () => {
    const store = new ArtifactStoreV0({ planDigest: "plan-1", blockHash: "block-1" });
    const content = "good-bytes";
    const digest = computeArtifactDigestV0(content);

    const put = store.put(digest, content);
    assertEq(put.ok, true, "expected put ok");

    const hacked = "bad-bytes";
    (store as any).current.set(digest, hacked);

    const res = store.read(digest);
    assertEq(res.ok, true, "expected recovery ok");
    assertEq(res.value, content, "expected recovered content");
    assertEq(res.recovered, true, "expected recovered flag");
    assert(res.reasonCodes?.includes("ARTIFACT_DIGEST_MISMATCH"), "expected digest mismatch reason");
    assert(res.reasonCodes?.includes("ARTIFACT_RECOVERED"), "expected recovered reason");
    assert(res.incident?.kind === "artifact.mismatch", "expected tartarus incident kind");
  });

  register("rejects untrusted injected artifact without recovery", () => {
    const store = new ArtifactStoreV0({ planDigest: "plan-1", blockHash: "block-1" });
    const digest = computeArtifactDigestV0("good-bytes");
    (store as any).current.set(digest, "tampered");

    const res = store.read(digest);
    assertEq(res.ok, false, "expected read deny");
    assert(res.reasonCodes?.includes("ARTIFACT_DIGEST_MISMATCH"), "expected digest mismatch");
    assert(res.incident?.kind === "artifact.mismatch", "expected tartarus incident");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`artifact_store.test.ts: ${t.name} failed${detail}`);
    }
  }
}
