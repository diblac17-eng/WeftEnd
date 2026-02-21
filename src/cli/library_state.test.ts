/* src/cli/library_state.test.ts */
/**
 * Library state view tests (baseline + history keys).
 */

import { runCliCapture } from "./cli_test_runner";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-library-state-"));

const copyDir = (src: string, dst: string) => {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  entries.forEach((entry: any) => {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory && entry.isDirectory()) {
      copyDir(from, to);
      return;
    }
    fs.copyFileSync(from, to);
  });
};

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const assertNoStageFiles = (dir: string) => {
  const entries = fs.readdirSync(dir);
  const stage = entries.filter((name: string) => name.endsWith(".stage"));
  assert(stage.length === 0, `expected no staged files in ${dir}, found: ${stage.join(",")}`);
};

suite("library state view", () => {
  register("baseline compare + accept/reject flow", async () => {
    const temp = makeTempDir();
    const libraryRoot = path.join(temp, "Library");
    const targetKey = "web_export_stub";
    const run1 = path.join(libraryRoot, targetKey, "run_000001");
    const run2 = path.join(libraryRoot, targetKey, "run_000002");
    const viewDir = path.join(libraryRoot, targetKey, "view");
    const inputSrc = path.join(process.cwd(), "tests", "fixtures", "intake", "web_export_stub");
    const inputDir = path.join(temp, "input");
    copyDir(inputSrc, inputDir);
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");

    const first = await runCliCapture(["safe-run", inputDir, "--policy", policyPath, "--out", run1], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
    });
    assertEq(first.status, 0, `expected run1 exit 0\n${first.stderr}`);
    const viewPath = path.join(viewDir, "view_state.json");
    assert(fs.existsSync(viewPath), "expected view_state.json");
    const state1 = readJson(viewPath);
    assertEq(state1.baselineRunId, "run_000001", "expected baseline run1");
    assertEq(state1.latestRunId, "run_000001", "expected latest run1");
    assert(state1.keys && state1.keys.length >= 1, "expected keys");
    assertEq(state1.keys[0].verdictVsBaseline, "SAME", "expected first run SAME vs baseline");

    fs.appendFileSync(path.join(inputDir, "app.js"), "\nconsole.log('x');\n", "utf8");
    const second = await runCliCapture(["safe-run", inputDir, "--policy", policyPath, "--out", run2], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
    });
    assertEq(second.status, 0, `expected run2 exit 0\n${second.stderr}`);
    const state2 = readJson(viewPath);
    assertEq(state2.baselineRunId, "run_000001", "expected baseline still run1");
    assertEq(state2.latestRunId, "run_000002", "expected latest run2");
    const latestIdx = state2.lastN.indexOf("run_000002");
    assert(latestIdx >= 0, "expected latest run in history");
    const latestKey = state2.keys[latestIdx];
    assertEq(latestKey.verdictVsBaseline, "CHANGED", "expected changed vs baseline");
    assert(latestKey.buckets.includes("D"), "expected digest change bucket");

    const accept = await runCliCapture(["library", "accept-baseline", targetKey], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
    });
    assertEq(accept.status, 0, `expected accept baseline exit 0\n${accept.stderr}`);
    const state3 = readJson(viewPath);
    assertEq(state3.baselineRunId, state3.latestRunId, "expected baseline advanced to latest");
    assertNoStageFiles(viewDir);

    const reject = await runCliCapture(["library", "reject-baseline", targetKey], {
      env: { WEFTEND_LIBRARY_ROOT: libraryRoot },
    });
    assertEq(reject.status, 0, `expected reject baseline exit 0\n${reject.stderr}`);
    const state4 = readJson(viewPath);
    assert(state4.blocked && state4.blocked.runId, "expected blocked state set");
    assertNoStageFiles(viewDir);
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`library_state.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
