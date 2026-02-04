/* src/runtime/kernel/cap_kernel.test.ts */
/**
 * WeftEnd (WebLayers v2.6) ƒ?" Capability kernel tests (deterministic)
 */

import { CapKernel } from "./cap_kernel";
import { canonicalJSON } from "../../core/canon";
import { computeGateReceiptIdV0 } from "../../core/validate";

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

suite("runtime/kernel cap_kernel", () => {
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
    verifySignature: (payload: string, _sig: unknown, _publicKey: string) =>
      payload === expectedCanonical && ok,
  });
  const makeReceipt = (overrides?: Record<string, unknown>) => {
    const body = {
      schema: "weftend.gateReceipt/0" as const,
      gateId: "market.admission.v0" as const,
      marketId: "market-1",
      marketPolicyDigest: "policy-1",
      planDigest: "plan-1",
      releaseId: "release-1",
      blockHash: "block-1",
      decision: "ALLOW" as const,
      reasonCodes: [] as string[],
      checkpointDigest: "checkpoint-1",
      ...(overrides ?? {}),
    };
    return { receiptId: computeGateReceiptIdV0(body), body };
  };

  register("deny-by-default when cap not granted", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r1",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("CAP_NOT_GRANTED"), "expected CAP_NOT_GRANTED");
  });

  register("binding mismatch rejects with deterministic reason", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r2",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-bad",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("PLANDIGEST_MISMATCH"), "expected PLANDIGEST_MISMATCH");
  });

  register("market receipt subject mismatch denies", () => {
    const receipt = makeReceipt({ blockHash: "block-bad" });
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      knownCaps: new Set(["net.fetch"]),
      disabledCaps: new Set(),
      marketId: "market-1",
      marketPolicyDigest: "policy-1",
      releaseId: "release-1",
      admissionReceipt: receipt as any,
      marketEligibleCaps: new Set(["net.fetch"]),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r-market-1",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("RECEIPT_SUBJECT_MISMATCH"), "expected RECEIPT_SUBJECT_MISMATCH");
  });

  register("replay protection rejects duplicate reqId", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
    });

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
  });

  register("tier violation denies execution", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T2",
      blockTier: "T1",
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
    assert(decision.reasonCodes?.includes("TIER_VIOLATION"), "expected TIER_VIOLATION");
  });

  register("missing shop stamp denies when runtime tier set", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r3a",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("STAMP_MISSING"), "expected STAMP_MISSING");
  });

  register("invalid shop stamp denies execution", () => {
    const stamp = makeStamp({ shopId: "" });
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r3b",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("STAMP_INVALID"), "expected STAMP_INVALID");
  });

  register("shop stamp tier lower than runtime tier denies", () => {
    const stamp = makeStamp({ tier: "T1" });
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), true);
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T2",
      shopStamp: stamp as any,
      cryptoPort,
      stampKeyAllowlist,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r3c",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("TIER_VIOLATION"), "expected TIER_VIOLATION");
  });

  register("shop stamp signature ok passes preflight", () => {
    const stamp = makeStamp();
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), true);
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
      cryptoPort,
      stampKeyAllowlist,
    });

    const preflight = kernel.preflightDenyReasons();
    assertEq(preflight.length, 0, "expected no preflight stamp errors");
  });

  register("getRuntimeObservedStamp reports OK when signature verifies", () => {
    const stamp = makeStamp();
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), true);
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
      cryptoPort,
      stampKeyAllowlist,
    });

    const observed = kernel.getRuntimeObservedStamp();
    assertEq(observed.status, "STAMP_VERIFIED", "expected STAMP_VERIFIED");
    assertEq(observed.sigStatus, "OK", "expected OK sigStatus");
    assert(!observed.reasonCodes || observed.reasonCodes.length === 0, "expected no reason codes");
  });

  register("shop stamp signature invalid denies preflight", () => {
    const stamp = makeStamp();
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), false);
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
      cryptoPort,
      stampKeyAllowlist,
    });

    const preflight = kernel.preflightDenyReasons();
    assert(preflight.includes("STAMP_SIG_INVALID"), "expected STAMP_SIG_INVALID");
  });

  register("getRuntimeObservedStamp reports BAD when signature invalid", () => {
    const stamp = makeStamp();
    const { signature: _sig, ...body } = stamp as any;
    const cryptoPort = makeCryptoPort(canonicalJSON(body), false);
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
      cryptoPort,
      stampKeyAllowlist,
    });

    const observed = kernel.getRuntimeObservedStamp();
    assertEq(observed.status, "STAMP_INVALID", "expected STAMP_INVALID");
    assertEq(observed.sigStatus, "BAD", "expected BAD sigStatus");
    assert(observed.reasonCodes?.includes("STAMP_SIG_INVALID"), "expected STAMP_SIG_INVALID reason");
  });

  register("shop stamp signature fails closed when CryptoPort missing", () => {
    const stamp = makeStamp();
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
      stampKeyAllowlist,
    });

    const preflight = kernel.preflightDenyReasons();
    assert(preflight.includes("STAMP_SIG_PORT_MISSING"), "expected STAMP_SIG_PORT_MISSING");
  });

  register("getRuntimeObservedStamp reports UNVERIFIED when CryptoPort missing", () => {
    const stamp = makeStamp();
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      runtimeTier: "T1",
      shopStamp: stamp as any,
      stampKeyAllowlist,
    });

    const observed = kernel.getRuntimeObservedStamp();
    assertEq(observed.status, "STAMP_INVALID", "expected STAMP_INVALID");
    assertEq(observed.sigStatus, "UNVERIFIED", "expected UNVERIFIED sigStatus");
    assert(observed.reasonCodes?.includes("STAMP_SIG_PORT_MISSING"), "expected STAMP_SIG_PORT_MISSING reason");
  });

  register("deny telemetry is proof-only and sorted", () => {
    let telemetry: any = null;
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(),
      onTelemetry: (event) => (telemetry = event),
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
    assert(telemetry, "expected telemetry event");
    assertEq(telemetry.eventKind, "cap.deny", "expected cap.deny event");
    assert(!("args" in telemetry), "telemetry must not include args");
    if (telemetry.reasonCodes) {
      const sorted = [...telemetry.reasonCodes].sort();
      assertEq(JSON.stringify(sorted), JSON.stringify(telemetry.reasonCodes), "reason codes must be sorted");
    }
  });

  register("disabled caps return CAP_DISABLED_V0 when granted", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r5",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("CAP_DISABLED_V0"), "expected CAP_DISABLED_V0");
  });

  register("secret caps require secret zone even when granted", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "compatible",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["auth.password.submit"]),
      secretZoneAvailable: false,
      disabledCaps: new Set(),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r6",
      capId: "auth.password.submit",
      executionMode: "compatible",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("SECRET_ZONE_REQUIRED"), "expected SECRET_ZONE_REQUIRED");
    assert(decision.reasonCodes?.includes("SECRET_ZONE_UNAVAILABLE"), "expected SECRET_ZONE_UNAVAILABLE");
  });

  register("compatible mode denies elevated caps when release is unverified", () => {
    const kernel = new CapKernel({
      planDigest: "plan-compat",
      callerBlockHash: "block-compat",
      executionMode: "compatible",
      sessionNonce: "nonce-compat",
      grantedCaps: new Set(["net.fetch"]),
      knownCaps: new Set(["net.fetch"]),
      disabledCaps: new Set(),
      releaseStatus: "UNVERIFIED",
      releaseReasonCodes: ["RELEASE_SIGNATURE_BAD"],
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r-compat",
      capId: "net.fetch",
      executionMode: "compatible",
      planDigest: "plan-compat",
      sessionNonce: "nonce-compat",
      callerBlockHash: "block-compat",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("RELEASE_SIGNATURE_BAD"), "expected release gating reason");
  });

  register("compatible mode allows caps when release is verified", () => {
    const kernel = new CapKernel({
      planDigest: "plan-compat-ok",
      callerBlockHash: "block-compat-ok",
      executionMode: "compatible",
      sessionNonce: "nonce-compat-ok",
      grantedCaps: new Set(["net.fetch"]),
      knownCaps: new Set(["net.fetch"]),
      disabledCaps: new Set(),
      releaseStatus: "OK",
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r-compat-ok",
      capId: "net.fetch",
      executionMode: "compatible",
      planDigest: "plan-compat-ok",
      sessionNonce: "nonce-compat-ok",
      callerBlockHash: "block-compat-ok",
    });

    assertEq(decision.ok, true, "expected allow");
  });

  register("release MAYBE denies gated caps with RELEASE_UNVERIFIED", () => {
    const kernel = new CapKernel({
      planDigest: "plan-maybe",
      callerBlockHash: "block-maybe",
      executionMode: "strict",
      sessionNonce: "nonce-maybe",
      grantedCaps: new Set(["net.fetch"]),
      knownCaps: new Set(["net.fetch"]),
      disabledCaps: new Set(),
      releaseStatus: "MAYBE",
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r-maybe",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-maybe",
      sessionNonce: "nonce-maybe",
      callerBlockHash: "block-maybe",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("RELEASE_UNVERIFIED"), "expected RELEASE_UNVERIFIED");
  });

  register("id.sign requires consent claim even when secret zone available", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["id.sign"]),
      secretZoneAvailable: true,
      disabledCaps: new Set(),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r7",
      capId: "id.sign",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("CONSENT_MISSING"), "expected CONSENT_MISSING");
  });

  register("id.sign denies when secret zone unavailable", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["id.sign"]),
      secretZoneAvailable: false,
      disabledCaps: new Set(),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r7b",
      capId: "id.sign",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("SECRET_ZONE_REQUIRED"), "expected SECRET_ZONE_REQUIRED");
    assert(decision.reasonCodes?.includes("SECRET_ZONE_UNAVAILABLE"), "expected SECRET_ZONE_UNAVAILABLE");
  });

  register("id.sign clears consent errors when claim is valid", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["id.sign"]),
      secretZoneAvailable: true,
      disabledCaps: new Set(["id.sign"]),
    });

    kernel.setConsentClaim({
      consentId: "c-ok",
      action: "id.sign",
      subject: { blockHash: "block-1", planDigest: "plan-1" },
      issuerId: "user:local",
      seq: 2,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r7c",
      capId: "id.sign",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(!decision.reasonCodes?.includes("CONSENT_MISSING"), "did not expect CONSENT_MISSING");
    assert(!decision.reasonCodes?.includes("CONSENT_MISMATCH"), "did not expect CONSENT_MISMATCH");
  });

  register("id.sign rejects consent mismatch and replay", () => {
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["id.sign"]),
      secretZoneAvailable: true,
      disabledCaps: new Set(),
    });

    kernel.setConsentClaim({
      consentId: "c1",
      action: "id.sign",
      subject: { blockHash: "block-1", planDigest: "plan-1" },
      issuerId: "user:local",
      seq: 1,
    });

    kernel.handleInvoke({
      reqId: "r8",
      capId: "id.sign",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    kernel.setConsentClaim({
      consentId: "c1",
      action: "id.sign",
      subject: { blockHash: "block-1", planDigest: "plan-1" },
      issuerId: "user:local",
      seq: 1,
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r9",
      capId: "id.sign",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("CONSENT_REPLAY"), "expected CONSENT_REPLAY");
  });

  register("takedown receipt denies caps even when eligible", () => {
    const receipt = makeReceipt({ decision: "DENY", reasonCodes: ["TAKEDOWN_ACTIVE"] });
    const kernel = new CapKernel({
      planDigest: "plan-1",
      callerBlockHash: "block-1",
      executionMode: "strict",
      sessionNonce: "nonce-1",
      grantedCaps: new Set(["net.fetch"]),
      knownCaps: new Set(["net.fetch"]),
      disabledCaps: new Set(),
      marketId: "market-1",
      marketPolicyDigest: "policy-1",
      releaseId: "release-1",
      admissionReceipt: receipt as any,
      marketEligibleCaps: new Set(["net.fetch"]),
    });

    const { decision } = kernel.handleInvoke({
      reqId: "r-market-2",
      capId: "net.fetch",
      executionMode: "strict",
      planDigest: "plan-1",
      sessionNonce: "nonce-1",
      callerBlockHash: "block-1",
    });

    assertEq(decision.ok, false, "expected deny");
    assert(decision.reasonCodes?.includes("RECEIPT_DENY"), "expected RECEIPT_DENY");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`cap_kernel.test.ts: ${t.name} failed${detail}`);
    }
  }
}
