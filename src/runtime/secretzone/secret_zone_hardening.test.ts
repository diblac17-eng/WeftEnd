// src/runtime/secretzone/secret_zone_hardening.test.ts
// SecretZone nonce binding tests (v0).

import { SecretZoneHost } from "./secret_zone_host";
import type { SecretZoneMessage } from "./types";

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

suite("runtime/secretzone hardening", () => {
  register("init binds planHash and nonce", () => {
    const host = new SecretZoneHost("plan-x");
    const { init, sessionNonce, hostPort, childPort } = host.initChannel();
    assertEq(init.planHash, "plan-x", "planHash must bind");
    assertEq(init.sessionNonce, sessionNonce, "nonce must bind");
    assertEq(init.executionMode, "strict-privacy", "executionMode must be strict-privacy");

    if (typeof childPort.close === "function") childPort.close();
    if (typeof hostPort.close === "function") hostPort.close();
  });

  register("ports are closable for deterministic cleanup", () => {
    const host = new SecretZoneHost("plan-x");
    const { hostPort, childPort } = host.initChannel();
    assert(typeof childPort.close === "function", "childPort.close must exist");
    assert(typeof hostPort.close === "function", "hostPort.close must exist");
    childPort.close?.();
    hostPort.close?.();
  });

  register("rejects messages with wrong nonce", async () => {
    const host = new SecretZoneHost("plan-x");
    const { childPort, hostPort, sessionNonce } = host.initChannel();

    let captured: any = null;
    if (typeof childPort.on === "function") {
      childPort.on("message", (msg: unknown) => (captured = msg as SecretZoneMessage));
    } else if (typeof childPort.onmessage !== "undefined") {
      childPort.onmessage = (evt: { data: unknown }) => (captured = evt.data as SecretZoneMessage);
    }

    const badMsg: SecretZoneMessage = {
      kind: "result",
      reqId: "x",
      ok: true,
      executionMode: "strict-privacy",
      planHash: "plan-x",
      sessionNonce: sessionNonce + "bad",
    };

    childPort.postMessage(badMsg);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert(captured, "expected response");
    assert((captured as any).reasonCodes.includes("NONCE_MISMATCH"), "expected NONCE_MISMATCH");

    if (typeof childPort.close === "function") childPort.close();
    if (typeof hostPort.close === "function") hostPort.close();
  });

  register("consent request resolves when child responds", async () => {
    const host = new SecretZoneHost("plan-consent");
    const { childPort, hostPort } = host.initChannel();

    if (typeof childPort.on === "function") {
      childPort.on("message", (msg: any) => {
        if (msg && msg.kind === "consent.request") {
          childPort.postMessage({
            kind: "consent.result",
            reqId: msg.reqId,
            ok: true,
            consent: {
              consentId: "consent-1",
              action: "id.sign",
              subject: { blockHash: "block-1", planDigest: "plan-consent" },
              issuerId: "user:local",
              seq: 1,
            },
            executionMode: msg.executionMode,
            planHash: msg.planHash,
            sessionNonce: msg.sessionNonce,
          });
        }
      });
    } else if (typeof childPort.onmessage !== "undefined") {
      childPort.onmessage = (evt: { data: any }) => {
        const msg = evt.data;
        if (msg && msg.kind === "consent.request") {
          childPort.postMessage({
            kind: "consent.result",
            reqId: msg.reqId,
            ok: true,
            consent: {
              consentId: "consent-1",
              action: "id.sign",
              subject: { blockHash: "block-1", planDigest: "plan-consent" },
              issuerId: "user:local",
              seq: 1,
            },
            executionMode: msg.executionMode,
            planHash: msg.planHash,
            sessionNonce: msg.sessionNonce,
          });
        }
      };
    }

    const res = await host.requestConsent("id.sign", { blockHash: "block-1", planDigest: "plan-consent" });
    assertEq(res.ok, true, "expected consent ok");
    assert(res.consent, "expected consent claim");

    if (typeof childPort.close === "function") childPort.close();
    if (typeof hostPort.close === "function") hostPort.close();
  });

  register("consent request fails when host channel missing", async () => {
    const host = new SecretZoneHost("plan-missing");
    const res = await host.requestConsent("id.sign", { blockHash: "block-x", planDigest: "plan-missing" });
    assertEq(res.ok, false, "expected failure");
    assert(res.reasonCodes?.includes("SECRET_ZONE_UNAVAILABLE"), "expected SECRET_ZONE_UNAVAILABLE");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`secret_zone_hardening.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
