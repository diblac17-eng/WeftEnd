/* src/runtime/examiner/examine_determinism.test.ts */
/**
 * Determinism tests for examiner pipeline.
 */

import { canonicalJSON } from "../../core/canon";
import { validateMintPackageV1 } from "../../core/validate";
import { examineArtifactV1 } from "./examine";

declare const require: any;
declare const process: any;
const path = require("path");

type TestFn = () => void;

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

const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "examiner", "web_minimal");

suite("runtime/examiner", () => {
  register("examineArtifactV1 is deterministic for same input", () => {
    const a = examineArtifactV1(fixtureDir, { profile: "web" });
    const b = examineArtifactV1(fixtureDir, { profile: "web" });
    assertEq(a.mint.digests.mintDigest, b.mint.digests.mintDigest, "mintDigest should match");
    assertEq(canonicalJSON(a.mint), canonicalJSON(b.mint), "canonical mint output should match");
    assertEq(validateMintPackageV1(a.mint, "mint").length, 0, "mint package should validate");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`examine_determinism.test.ts: ${t.name} failed${detail}`);
    }
  }
}
