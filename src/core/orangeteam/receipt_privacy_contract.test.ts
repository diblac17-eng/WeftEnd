/* src/core/orangeteam/receipt_privacy_contract.test.ts */
/**
 * Orange Team: privacy lint fails on absolute paths and passes on clean outputs.
 */

import { runPrivacyLintV0 } from "../../runtime/privacy_lint";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-orange-privacy-"));

suite("orangeteam/privacy-lint", () => {
  register("privacy lint fails on absolute paths", () => {
    const temp = makeTempDir();
    const receipt = {
      schemaVersion: 0,
      weftendBuild: { algo: "fnv1a32", digest: "fnv1a32:00000000", source: "UNKNOWN" },
      leak: "C:\\Users\\alice\\secret.txt",
    };
    fs.writeFileSync(path.join(temp, "safe_run_receipt.json"), JSON.stringify(receipt), "utf8");
    const lint = runPrivacyLintV0({ root: temp, writeReport: false });
    assertEq(lint.report.verdict, "FAIL", "expected privacy lint FAIL");
    assert(lint.report.violations.some((v) => v.code === "ABS_PATH_WIN"), "expected ABS_PATH_WIN");
  });

  register("privacy lint passes on clean output", () => {
    const temp = makeTempDir();
    const receipt = {
      schemaVersion: 0,
      weftendBuild: { algo: "fnv1a32", digest: "fnv1a32:00000000", source: "UNKNOWN" },
      note: "OK",
    };
    fs.writeFileSync(path.join(temp, "safe_run_receipt.json"), JSON.stringify(receipt), "utf8");
    const lint = runPrivacyLintV0({ root: temp, writeReport: false });
    assertEq(lint.report.verdict, "PASS", "expected privacy lint PASS");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`receipt_privacy_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
