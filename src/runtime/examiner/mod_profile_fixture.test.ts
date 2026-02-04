/* src/runtime/examiner/mod_profile_fixture.test.ts */
/**
 * Mod profile should emit mod.signals.v1 receipt with expected counts.
 */

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

const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "examiner", "mod_minimal");

suite("runtime/examiner mod profile", () => {
  register("mod.signals.v1 receipt appears with counts", () => {
    const result = examineArtifactV1(fixtureDir, { profile: "mod" });
    const receipt = result.mint.grade.receipts.find((r) => r.kind === "mod.signals.v1");
    assert(Boolean(receipt), "expected mod.signals.v1 receipt");
    const counts = receipt?.summaryCounts ?? {};
    assert(counts.manifestCount === 1, "expected manifestCount=1");
    assert(counts.dllCount === 1, "expected dllCount=1");
    assert(counts.wasmCount === 1, "expected wasmCount=1");
    assert(counts.assetCount === 1, "expected assetCount=1");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`mod_profile_fixture.test.ts: ${t.name} failed${detail}`);
    }
  }
}
