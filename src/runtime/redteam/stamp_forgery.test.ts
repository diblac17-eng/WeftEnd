/* src/runtime/redteam/stamp_forgery.test.ts */
/**
 * Red team v0: stamp forgery/substitution (runtime)
 */

import { CapKernel } from "../kernel/cap_kernel";
import { canonicalJSON } from "../../core/canon";

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

const stampKeyAllowlist = { "key-1": "pub-1" };
const makeStamp = (overrides?: Record<string, unknown>) => ({
  schema: "retni.shopstamp/1",
  tier: "T1",
  shopId: "shop-1",
  policyDigest: "policy",
  blockHash: "block-1",
  acceptDecision: "ACCEPT",
  reasonCodes: ["OK"],
  stampDigest: "stamp",
  signature: { algo: "ed25519", keyId: "key-1", sig: "sig-1" },
  ...(overrides ?? {}),
});

const makeCryptoPort = (expectedCanonical: string, ok: boolean) => ({
  hash: (_canonical: string) => "hash",
  verifySignature: (payload: string, _sig: unknown, _publicKey: string) => payload === expectedCanonical && ok,
});

const makeKernel = (overrides?: Record<string, unknown>) =>
  new CapKernel({
    planDigest: "plan-1",
    callerBlockHash: "block-1",
    executionMode: "strict",
    sessionNonce: "nonce-1",
    grantedCaps: new Set(["net.fetch"]),
    knownCaps: new Set(["net.fetch"]),
    disabledCaps: new Set(),
    ...(overrides ?? {}),
  } as any);

const assertSorted = (codes: string[]) => {
  const sorted = [...codes].sort();
  assertEq(JSON.stringify(sorted), JSON.stringify(codes), "reason codes must be sorted");
};

suite("runtime/redteam stamp forgery", () => {
  register("missing stamp denies with STAMP_MISSING", () => {
    const kernel = makeKernel({ runtimeTier: "T1" });
    const { decision } = kernel.handleInvoke({
      reqId: "r1",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("STAMP_MISSING"), "expected STAMP_MISSING");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });

  register("forged stamp signature denies with STAMP_SIG_INVALID", () => {
    const stamp = makeStamp();
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), false);
    const kernel = makeKernel({
      runtimeTier: "T1",
      shopStamp: stamp,
      cryptoPort,
      stampKeyAllowlist,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r2",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("STAMP_SIG_INVALID"), "expected STAMP_SIG_INVALID");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });

  register("stamp substitution (blockHash mismatch) denies with STAMP_INVALID", () => {
    const stamp = makeStamp({ blockHash: "block-OTHER" });
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), true);
    const kernel = makeKernel({
      runtimeTier: "T1",
      shopStamp: stamp,
      cryptoPort,
      stampKeyAllowlist,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r3",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("STAMP_INVALID"), "expected STAMP_INVALID");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });

  register("tier mismatch denies with TIER_VIOLATION", () => {
    const stamp = makeStamp({ tier: "T1" });
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), true);
    const kernel = makeKernel({
      runtimeTier: "T2",
      shopStamp: stamp,
      cryptoPort,
      stampKeyAllowlist,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r4",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("TIER_VIOLATION"), "expected TIER_VIOLATION");
    if (decision.reasonCodes) assertSorted(decision.reasonCodes);
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`stamp_forgery.test.ts: ${t.name} failed${detail}`);
    }
  }
}
