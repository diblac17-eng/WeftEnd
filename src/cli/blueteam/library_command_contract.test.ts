/* src/cli/blueteam/library_command_contract.test.ts */
/**
 * Blue Team: library command opens root deterministically without path leakage.
 */

import { runCliCapture } from "../cli_test_runner";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-blue-library-"));

suite("blueteam/library-command", () => {
  register("library command creates root without path leakage", async () => {
    const temp = makeTempDir();
    const root = path.join(temp, "Library");
    const result = await runCliCapture(["library"], { env: { WEFTEND_LIBRARY_ROOT: root } });
    assertEq(result.status, 0, `expected exit 0\n${result.stderr}`);
    assert(fs.existsSync(root), "expected library root to exist");
    assert(!/[A-Za-z]:\\/.test(result.stdout), "stdout must not include absolute Windows paths");
    assert(!/\/Users\//.test(result.stdout), "stdout must not include user paths");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`library_command_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
