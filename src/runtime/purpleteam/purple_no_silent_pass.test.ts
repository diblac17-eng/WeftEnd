/* src/runtime/purpleteam/purple_no_silent_pass.test.ts */
/**
 * Purple Team: invalid receipts fail compare with deterministic exit code.
 */

import { runCliCapture } from "../../cli/cli_test_runner";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-purple-invalid-"));

suite("purpleteam/no-silent-pass", () => {
  register("compare rejects invalid receipt with exit 40", async () => {
    const temp = makeTempDir();
    const left = path.join(temp, "left");
    const right = path.join(temp, "right");
    const outCompare = path.join(temp, "compare");
    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });

    fs.writeFileSync(path.join(left, "safe_run_receipt.json"), JSON.stringify({ schema: "weftend.safeRunReceipt/0" }), "utf8");

    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const run = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", right]);
    assertEq(run.status, 0, `expected safe-run exit 0\n${run.stderr}`);

    const compared = await runCliCapture(["compare", left, right, "--out", outCompare]);
    assertEq(compared.status, 40, `expected compare exit 40\n${compared.stderr}`);
    assert(
      compared.stderr.includes("RECEIPT_OLD_CONTRACT") || compared.stderr.includes("COMPARE_LEFT_RECEIPT_INVALID"),
      "expected receipt contract error"
    );
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`purple_no_silent_pass.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
