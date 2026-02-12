// src/engine/release_manifest.test.ts
// Release manifest minting tests (deterministic).

import { canonicalJSON } from "../core/canon";
import { sha256HexV0 } from "../core/hash_v0";
import { computeReleaseIdV0, validateReleaseManifestV0 } from "../core/validate";
import { mintReleaseManifestV0 } from "./release_manifest";
import type { CryptoPort } from "../ports/crypto-port";

declare const Buffer: any;

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

const sha256 = (input: string): string => sha256HexV0(input);

const signatureForPayload = (payloadCanonical: string): string =>
  Buffer.from(`sig:${sha256(payloadCanonical)}`, "utf8").toString("base64");

const makeCryptoPort = (): CryptoPort => ({
  hash: (canonical: string) => `sha256:${sha256(canonical)}`,
  verifySignature: () => true,
  sign: (payloadCanonical: string, keyId: string) => ({
    algo: "sig.ed25519.v0",
    keyId,
    sig: signatureForPayload(payloadCanonical),
  }),
});

suite("engine/release_manifest v0", () => {
  register("mintReleaseManifestV0 yields deterministic releaseId", () => {
    const body = {
      planDigest: "plan-1",
      policyDigest: "policy-1",
      blocks: ["block-a", "block-b"],
      pathDigest: "sha256:path-1",
    };
    const cryptoPort = makeCryptoPort();
    const res = mintReleaseManifestV0(body, "key-1", cryptoPort);
    assert(res.ok, "expected ok");
    const manifest = res.ok ? res.value : null;
    assert(manifest, "expected manifest");
    assertEq(manifest?.releaseId, computeReleaseIdV0(body), "releaseId must match computeReleaseIdV0");
    const issues = validateReleaseManifestV0(manifest as any, "release");
    assertEq(issues.length, 0, "expected valid release manifest");
  });

  register("mintReleaseManifestV0 fails closed without signer", () => {
    const body = {
      planDigest: "plan-2",
      policyDigest: "policy-2",
      blocks: ["block-a"],
      pathDigest: "sha256:path-2",
    };
    const res = mintReleaseManifestV0(body, "key-1", undefined);
    assertEq(res.ok, false, "expected error");
    const codes = (res as any).error.map((i: any) => i.code).join(",");
    assert(codes.includes("SIGNER_UNAVAILABLE"), "expected SIGNER_UNAVAILABLE");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`release_manifest.test.ts: ${t.name} failed${detail}`);
    }
  }
}
