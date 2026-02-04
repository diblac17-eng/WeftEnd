/* src/core/orangeteam/no_auto_keygen.test.ts */
/**
 * Orange Team: demo crypto must be explicitly allowed (no auto keygen).
 */

import { createHostStatusReceiptV0 } from "../../runtime/host/host_status";

declare const require: any;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");

type TestFn = () => void | Promise<void>;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-orange-"));

suite("orangeteam/no-auto-keygen", () => {
  register("host status signature requires explicit demo crypto allow", () => {
    const temp = makeTempDir();
    const trustRootPath = path.join(temp, "trust_root.json");
    fs.writeFileSync(trustRootPath, "{}", "utf8");

    const prevSecret = process.env.WEFTEND_HOST_SIGNING_SECRET;
    const prevDemo = process.env.WEFTEND_DEMO_CRYPTO_OK;

    try {
      process.env.WEFTEND_HOST_SIGNING_SECRET = "demo-secret";
      delete process.env.WEFTEND_DEMO_CRYPTO_OK;

      const res = createHostStatusReceiptV0({ hostRoot: temp, trustRootPath });
      assert(!res.receipt.signature, "expected no signature without demo allow");

      process.env.WEFTEND_DEMO_CRYPTO_OK = "1";
      const resAllowed = createHostStatusReceiptV0({ hostRoot: temp, trustRootPath });
      assert(Boolean(resAllowed.receipt.signature), "expected signature when demo allow is set");
    } finally {
      if (typeof prevSecret === "undefined") delete process.env.WEFTEND_HOST_SIGNING_SECRET;
      else process.env.WEFTEND_HOST_SIGNING_SECRET = prevSecret;
      if (typeof prevDemo === "undefined") delete process.env.WEFTEND_DEMO_CRYPTO_OK;
      else process.env.WEFTEND_DEMO_CRYPTO_OK = prevDemo;
    }
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`no_auto_keygen.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
