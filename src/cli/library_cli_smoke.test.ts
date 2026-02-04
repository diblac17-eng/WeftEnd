/* src/cli/library_cli_smoke.test.ts */
/**
 * CLI library command smoke test (deterministic, no path leaks).
 */

import { runCliCapture } from "./cli_test_runner";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-library-"));
const touchDir = (dir: string, mtimeMs: number) => {
  fs.mkdirSync(dir, { recursive: true });
  const time = new Date(mtimeMs);
  fs.utimesSync(dir, time, time);
};

suite("cli/library", () => {
  register("opens library root and prints safe summary", async () => {
    const temp = makeTempDir();
    const libraryRoot = path.join(temp, "Library");
    let opened = "";
    const result = await runCliCapture(["library"], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
      openExternal: (target: string) => {
        opened = target;
        return { ok: true };
      },
    });

    assertEq(result.status, 0, `expected exit 0\n${result.stderr}`);
    assert(fs.existsSync(libraryRoot), "expected library root to exist");
    assertEq(opened, libraryRoot, "expected openExternal called with library root");

    const combined = `${result.stdout}\n${result.stderr}`;
    assert(combined.includes("LIBRARY OPEN"), "expected library open summary");
    assert(combined.includes("privacyLint=PASS"), "expected privacy lint summary");
    assert(combined.includes("buildDigest="), "expected build digest summary");
    assert(!/[A-Za-z]:\\/.test(combined), "summary must not include absolute Windows paths");
    assert(!/\/Users\//.test(combined), "summary must not include user paths");
  });

  register("opens latest run overall when --latest is set", async () => {
    const temp = makeTempDir();
    const libraryRoot = path.join(temp, "Library");
    const targetA = path.join(libraryRoot, "target_a");
    const targetB = path.join(libraryRoot, "target_b");
    const runA = path.join(targetA, "run_000001");
    const runB = path.join(targetB, "run_000009");
    touchDir(runA, 1000);
    touchDir(runB, 5000);

    let opened = "";
    const result = await runCliCapture(["library", "--latest"], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
      openExternal: (target: string) => {
        opened = target;
        return { ok: true };
      },
    });

    assertEq(result.status, 0, `expected exit 0\n${result.stderr}`);
    assertEq(opened, runB, "expected openExternal called with latest run across targets");

    const combined = `${result.stdout}\n${result.stderr}`;
    assert(combined.includes("mode=LATEST"), "expected latest mode summary");
    assert(!/[A-Za-z]:\\/.test(combined), "summary must not include absolute Windows paths");
    assert(!/\/Users\//.test(combined), "summary must not include user paths");
  });

  register("opens latest run for target key when --latest --target is set", async () => {
    const temp = makeTempDir();
    const libraryRoot = path.join(temp, "Library");
    const target = path.join(libraryRoot, "target_z");
    const run1 = path.join(target, "run_000001");
    const run2 = path.join(target, "run_000002");
    touchDir(run1, 2000);
    touchDir(run2, 3000);

    let opened = "";
    const result = await runCliCapture(["library", "--latest", "--target", "target_z"], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
      openExternal: (targetPath: string) => {
        opened = targetPath;
        return { ok: true };
      },
    });

    assertEq(result.status, 0, `expected exit 0\n${result.stderr}`);
    assertEq(opened, run2, "expected openExternal called with latest run in target");

    const combined = `${result.stdout}\n${result.stderr}`;
    assert(combined.includes("mode=LATEST"), "expected latest mode summary");
    assert(!/[A-Za-z]:\\/.test(combined), "summary must not include absolute Windows paths");
    assert(!/\/Users\//.test(combined), "summary must not include user paths");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`library_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
