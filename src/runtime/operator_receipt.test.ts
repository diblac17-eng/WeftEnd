/* src/runtime/operator_receipt.test.ts */
/**
 * Operator receipt tests (deterministic + staged finalize).
 */

import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "./operator_receipt";

declare const require: any;

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-operator-receipt-"));

suite("runtime/operator_receipt", () => {
  register("build is deterministic with stable entry ordering", () => {
    const input = {
      command: "run",
      schemaVersion: 0,
      weftendBuild: { algo: "sha256", digest: "sha256:11111111", source: "NODE_MAIN_JS" } as any,
      entries: [
        { kind: "report", relPath: "b.txt", digest: "sha256:2" },
        { kind: "receipt", relPath: "a.json", digest: "sha256:1" },
      ],
      warnings: ["BETA", "ALPHA", "ALPHA"],
    } as any;
    const a = buildOperatorReceiptV0(input);
    const b = buildOperatorReceiptV0(input);
    assertEq(JSON.stringify(a), JSON.stringify(b), "operator receipt build must be deterministic");
    assertEq(a.receipts[0].relPath, "a.json", "entries should be sorted deterministically");
    assertEq(a.warnings.join(","), "ALPHA,BETA", "warnings should be stable sorted unique");
  });

  register("write uses staged finalize with no stage residue", () => {
    const outRoot = makeTempDir();
    const target = path.join(outRoot, "operator_receipt.json");
    const stagePath = `${target}.stage`;
    fs.writeFileSync(target, "stale", "utf8");
    fs.writeFileSync(stagePath, "stale-stage", "utf8");

    const receipt = buildOperatorReceiptV0({
      command: "run",
      schemaVersion: 0,
      weftendBuild: { algo: "sha256", digest: "sha256:22222222", source: "NODE_MAIN_JS" } as any,
      entries: [{ kind: "receipt", relPath: "safe_run_receipt.json", digest: "sha256:3" }],
      warnings: [],
    });
    const written = writeOperatorReceiptV0(outRoot, receipt);
    assertEq(path.normalize(written), path.normalize(target), "operator receipt path mismatch");
    assert(fs.existsSync(target), "expected operator_receipt.json");
    assert(!fs.existsSync(stagePath), "operator receipt stage file must not remain after finalize");
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    assertEq(parsed.schema, "weftend.operatorReceipt/0", "expected schema marker");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`operator_receipt.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
