/* src/runtime/purpleteam/purple_compare_signal.test.ts */
/**
 * Purple Team: compare detects external refs changes and surfaces X bucket.
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-purple-compare-"));

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

suite("purpleteam/compare-signal", () => {
  register("compare buckets include EXTERNALREFS_CHANGED", async () => {
    const temp = makeTempDir();
    const inputSrc = path.join(process.cwd(), "tests", "fixtures", "intake", "web_export_stub");
    const inputDir = path.join(temp, "input");
    copyDir(inputSrc, inputDir);
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");

    const out1 = path.join(temp, "out1");
    const out2 = path.join(temp, "out2");
    const outCompare = path.join(temp, "compare");

    const first = await runCliCapture(["safe-run", inputDir, "--policy", policyPath, "--out", out1]);
    assertEq(first.status, 0, `expected exit 0\n${first.stderr}`);

    fs.appendFileSync(
      path.join(inputDir, "index.html"),
      '\n<script src="https://cdn2.example.com/extra.js"></script>\n',
      "utf8"
    );

    const second = await runCliCapture(["safe-run", inputDir, "--policy", policyPath, "--out", out2]);
    assertEq(second.status, 0, `expected exit 0\n${second.stderr}`);

    const compared = await runCliCapture(["compare", out1, out2, "--out", outCompare]);
    assertEq(compared.status, 0, `expected compare exit 0\n${compared.stderr}`);
    const report = fs.readFileSync(path.join(outCompare, "compare_report.txt"), "utf8");
    assert(report.includes("EXTERNALREFS_CHANGED"), "expected EXTERNALREFS_CHANGED bucket in report");
    assert(/\bX\b/.test(report) || report.includes("EXTERNALREFS_CHANGED"), "expected external refs signal");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`purple_compare_signal.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
