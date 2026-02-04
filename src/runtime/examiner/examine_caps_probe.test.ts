/* src/runtime/examiner/examine_caps_probe.test.ts */
/**
 * Probe should flag denied caps only when interactions trigger them.
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

const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "examiner", "web_interaction_only");

suite("runtime/examiner probe", () => {
  register("load-only is OK, scripted detects CAP_DENY_NET", () => {
    const loadOnly = examineArtifactV1(fixtureDir, { profile: "web" });
    assert(
      (loadOnly.mint.executionProbes.loadOnly.reasonCodes ?? []).length === 0,
      "load-only should have no reason codes"
    );

    const scripted = examineArtifactV1(fixtureDir, { profile: "web", scriptText: "click #go" });
    const reasons = scripted.mint.executionProbes.interactionScript?.reasonCodes ?? [];
    assert(reasons.includes("CAP_DENY_NET"), "scripted scan should record CAP_DENY_NET");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`examine_caps_probe.test.ts: ${t.name} failed${detail}`);
    }
  }
}
