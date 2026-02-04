/* src/runtime/examiner/intake_decision_v1_golden.test.ts */
/**
 * Golden tests for intake decision outputs.
 */

import { canonicalJSON } from "../../core/canon";
import { canonicalizeWeftEndPolicyV1 } from "../../core/intake_policy_v1";
import { examineArtifactV1 } from "./examine";
import { buildIntakeDecisionV1 } from "./intake_decision_v1";
import type { MintProfileV1 } from "../../core/types";

declare const require: any;
declare const process: any;
const fs = require("fs");
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

const fixtures: Array<{ name: string; input: string; policy: string; profile: MintProfileV1 }> = [
  {
    name: "safe_no_caps",
    input: path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps"),
    policy: path.join(process.cwd(), "policies", "web_component_default.json"),
    profile: "web",
  },
  {
    name: "net_attempt",
    input: path.join(process.cwd(), "tests", "fixtures", "intake", "net_attempt"),
    policy: path.join(process.cwd(), "policies", "web_component_default.json"),
    profile: "web",
  },
  {
    name: "tampered_manifest",
    input: path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip"),
    policy: path.join(process.cwd(), "policies", "release_strict_default.json"),
    profile: "generic",
  },
];

const expectedDir = path.join(process.cwd(), "tests", "fixtures", "intake", "expected");

suite("runtime/intake decision golden", () => {
  fixtures.forEach((fixture) => {
    register(`${fixture.name} outputs match golden`, () => {
      const policyRaw = JSON.parse(fs.readFileSync(fixture.policy, "utf8"));
      const policy = canonicalizeWeftEndPolicyV1(policyRaw);
      const mint = examineArtifactV1(fixture.input, { profile: fixture.profile }).mint;
      const output = buildIntakeDecisionV1(mint, policy);

      const decisionPath = path.join(expectedDir, `${fixture.name}_decision.json`);
      const disclosurePath = path.join(expectedDir, `${fixture.name}_disclosure.txt`);
      const appealPath = path.join(expectedDir, `${fixture.name}_appeal.json`);

      const expectedDecision = fs.readFileSync(decisionPath, "utf8").trim();
      const expectedDisclosure = fs.readFileSync(disclosurePath, "utf8").trim();
      const expectedAppeal = fs.readFileSync(appealPath, "utf8").trim();

      assertEq(canonicalJSON(output.decision), expectedDecision, "decision fixture must match");
      assertEq(output.disclosure.trim(), expectedDisclosure, "disclosure fixture must match");
      assertEq(canonicalJSON(output.appeal), expectedAppeal, "appeal fixture must match");

      const output2 = buildIntakeDecisionV1(mint, policy);
      assertEq(
        canonicalJSON(output.decision),
        canonicalJSON(output2.decision),
        "decision output must be deterministic"
      );
    });
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`intake_decision_v1_golden.test.ts: ${t.name} failed${detail}`);
    }
  }
}
