/* src/core/redteam/secret_smuggling_and_leak.test.ts */
/**
 * Red team: ensure SecretBox rejects smuggled fields and unbound secrets.
 * This protects against embedding secrets or extra fields in core payloads.
 */

import { validateSecretBoxTyped } from "../validate";

type TestFn = () => void | Promise<void>;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function assertIncludes(arr: { code: string }[], code: string, msg: string): void {
  assert(arr.some((i) => i.code === code), msg);
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

const baseSecretBox = () => ({
  schema: "retni.secretbox/1",
  kind: "opaque.secret",
  secretB64: "AQI=", // 2 bytes
  bindings: { planHash: "plan-1", issuerId: "issuer-1", mintedSeq: 0, mintedAt: "t0" },
  secretHash: "fnv1a32:deadbeef",
  boxDigest: "fnv1a32:cafebabe",
});

suite("core/redteam secret smuggling + leak", () => {
  register("accepts a well-formed SecretBox", () => {
    const res = validateSecretBoxTyped(baseSecretBox());
    assert(res.ok === true, "expected valid SecretBox");
  });

  register("rejects smuggled top-level fields", () => {
    const bad: any = baseSecretBox();
    bad.leak = "oops";
    const res = validateSecretBoxTyped(bad);
    assert(res.ok === false, "expected invalid SecretBox");
    assertIncludes((res as any).error || [], "SECRETBOX_FIELDS_INVALID", "expected SECRETBOX_FIELDS_INVALID");
  });

  register("rejects smuggled bindings fields", () => {
    const bad: any = baseSecretBox();
    bad.bindings.extra = "nope";
    const res = validateSecretBoxTyped(bad);
    assert(res.ok === false, "expected invalid SecretBox");
    assertIncludes((res as any).error || [], "SECRETBOX_FIELDS_INVALID", "expected SECRETBOX_FIELDS_INVALID");
  });

  register("rejects unbound SecretBox", () => {
    const bad: any = baseSecretBox();
    bad.bindings.planHash = "";
    const res = validateSecretBoxTyped(bad);
    assert(res.ok === false, "expected invalid SecretBox");
    assertIncludes((res as any).error || [], "SECRETBOX_UNBOUND", "expected SECRETBOX_UNBOUND");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`secret_smuggling_and_leak.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
