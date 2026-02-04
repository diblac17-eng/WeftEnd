/* src/runtime/examiner/examine_external_refs.test.ts */
/**
 * External ref extraction should be deterministic and bounded.
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

const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "examiner", "web_external_refs");

suite("runtime/examiner external refs", () => {
  register("externalRefs includes detected URLs", () => {
    const result = examineArtifactV1(fixtureDir, { profile: "web" });
    const refs = result.mint.observations.externalRefs;
    assert(refs.includes("https://cdn.example.com/app.js"), "expected script src ref");
    assert(refs.includes("https://api.example.com/data"), "expected fetch ref");
    assert(refs.includes("wss://socket.example.com"), "expected websocket ref");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`examine_external_refs.test.ts: ${t.name} failed${detail}`);
    }
  }
}
