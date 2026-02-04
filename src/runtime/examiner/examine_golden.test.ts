/* src/runtime/examiner/examine_golden.test.ts */
/**
 * Golden test: web_minimal output must match fixture bytes.
 */

import { canonicalJSON } from "../../core/canon";
import { examineArtifactV1 } from "./examine";

declare const require: any;
declare const process: any;
const fs = require("fs");
const path = require("path");

type TestFn = () => void;

function fail(msg: string): never {
  throw new Error(msg);
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

const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "examiner", "web_minimal");
const expectedPath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "examiner",
  "expected",
  "mint_web_minimal.json"
);

suite("runtime/examiner golden", () => {
  register("web_minimal mint package matches fixture", () => {
    const result = examineArtifactV1(fixtureDir, { profile: "web" });
    const actual = canonicalJSON(result.mint);
    const expected = fs.readFileSync(expectedPath, "utf8").trim();
    assertEq(actual, expected, "mint package fixture must match");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`examine_golden.test.ts: ${t.name} failed${detail}`);
    }
  }
}
