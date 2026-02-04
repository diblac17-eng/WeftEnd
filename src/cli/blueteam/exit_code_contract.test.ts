/* src/cli/blueteam/exit_code_contract.test.ts */
/**
 * Blue Team: operator exit code contracts (40 vs 0).
 */

import { runCliCapture } from "../cli_test_runner";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-blue-"));

suite("blueteam/exit-codes", () => {
  register("missing input exits 40", async () => {
    const temp = makeTempDir();
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const missing = path.join(temp, "missing");
    const outDir = path.join(temp, "out");
    const result = await runCliCapture(["safe-run", missing, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 40, `expected exit 40\n${result.stderr}`);
  });

  register("analysis-only WITHHELD exits 0", async () => {
    const temp = makeTempDir();
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "native_app_stub", "app.exe");
    const outDir = path.join(temp, "out");
    const result = await runCliCapture(["safe-run", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 0, `expected exit 0\n${result.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(receipt.analysisVerdict, "WITHHELD", "expected WITHHELD analysis verdict");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`exit_code_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
