/* src/runtime/examiner/intake_decision_v1.test.ts */
/**
 * Intake decision policy flag + oversize behavior tests.
 */

import { canonicalJSON } from "../../core/canon";
import type { WeftEndPolicyV1 } from "../../core/types";
import { examineArtifactV1 } from "./examine";
import { buildIntakeDecisionV1 } from "./intake_decision_v1";

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

const fixturePath = (...parts: string[]) =>
  path.join(process.cwd(), "tests", "fixtures", "intake", ...parts);

type PolicyOverrides = {
  profile?: WeftEndPolicyV1["profile"];
  reasonSeverity?: WeftEndPolicyV1["reasonSeverity"];
  severityAction?: Partial<WeftEndPolicyV1["severityAction"]>;
  capsPolicy?: Partial<WeftEndPolicyV1["capsPolicy"]>;
  disclosure?: Partial<WeftEndPolicyV1["disclosure"]>;
  bounds?: Partial<WeftEndPolicyV1["bounds"]>;
};

const makePolicy = (overrides: PolicyOverrides = {}): WeftEndPolicyV1 => {
  const base: WeftEndPolicyV1 = {
    schema: "weftend.intake.policy/1",
    profile: "web",
    reasonSeverity: {},
    severityAction: {
      INFO: "APPROVE",
      WARN: "QUEUE",
      DENY: "REJECT",
      QUARANTINE: "HOLD",
    },
    capsPolicy: {
      net: { allowedDomains: [] },
      storage: { allow: true },
      childProcess: { allow: false },
    },
    disclosure: {
      requireOnWARN: false,
      requireOnDENY: false,
      maxLines: 6,
    },
    bounds: {
      maxReasonCodes: 20,
      maxCapsItems: 20,
      maxDisclosureChars: 256,
      maxAppealBytes: 2048,
    },
  };
  return {
    ...base,
    ...overrides,
    reasonSeverity: { ...base.reasonSeverity, ...(overrides.reasonSeverity ?? {}) },
    severityAction: { ...base.severityAction, ...(overrides.severityAction ?? {}) },
    capsPolicy: { ...base.capsPolicy, ...(overrides.capsPolicy ?? {}) },
    disclosure: { ...base.disclosure, ...(overrides.disclosure ?? {}) },
    bounds: { ...base.bounds, ...(overrides.bounds ?? {}) },
  };
};

suite("runtime/intake decision flags", () => {
  register("OK does not emit disclosure by default", () => {
    const mint = examineArtifactV1(fixturePath("safe_no_caps"), { profile: "web" }).mint;
    const policy = makePolicy({ disclosure: { requireOnWARN: true, requireOnDENY: true } });
    const output = buildIntakeDecisionV1(mint, policy);
    assertEq(output.decision.grade, "OK", "expected OK grade");
    assertEq(output.disclosure, "DISCLOSURE_NOT_REQUIRED", "expected disclosure sentinel for OK");
  });

  register("WARN disclosure only when requireOnWARN", () => {
    const mint = examineArtifactV1(fixturePath("net_attempt"), { profile: "web" }).mint;
    const policyOff = makePolicy({ disclosure: { requireOnWARN: false, requireOnDENY: true } });
    const outOff = buildIntakeDecisionV1(mint, policyOff);
    assert(outOff.decision.topReasonCodes.includes("CAP_DENY_NET"), "expected CAP_DENY_NET reason");
    assertEq(outOff.disclosure, "DISCLOSURE_NOT_REQUIRED", "expected disclosure sentinel when requireOnWARN is false");

    const policyOn = makePolicy({ disclosure: { requireOnWARN: true, requireOnDENY: true } });
    const outOn = buildIntakeDecisionV1(mint, policyOn);
    assert(outOn.disclosure.length > 0, "expected disclosure when requireOnWARN is true");
  });

  register("DENY disclosure only when requireOnDENY", () => {
    const mint = examineArtifactV1(fixturePath("tampered_manifest", "tampered.zip"), {
      profile: "generic",
    }).mint;
    const policyOff = makePolicy({ disclosure: { requireOnWARN: true, requireOnDENY: false } });
    const outOff = buildIntakeDecisionV1(mint, policyOff);
    assert(outOff.decision.topReasonCodes.includes("ZIP_EOCD_MISSING"), "expected ZIP_EOCD_MISSING reason");
    assertEq(outOff.disclosure, "DISCLOSURE_NOT_REQUIRED", "expected disclosure sentinel when requireOnDENY is false");

    const policyOn = makePolicy({ disclosure: { requireOnWARN: true, requireOnDENY: true } });
    const outOn = buildIntakeDecisionV1(mint, policyOn);
    assert(outOn.disclosure.length > 0, "expected disclosure when requireOnDENY is true");
  });

  register("required disclosure missing fails closed with DISCLOSURE_REQUIRED", () => {
    const mint = examineArtifactV1(fixturePath("net_attempt"), { profile: "web" }).mint;
    const policy = makePolicy({
      disclosure: { requireOnWARN: true, requireOnDENY: true },
      bounds: { maxDisclosureChars: 0 },
    });
    const out = buildIntakeDecisionV1(mint, policy);
    assert(out.decision.topReasonCodes.includes("DISCLOSURE_REQUIRED"), "expected DISCLOSURE_REQUIRED reason");
    assertEq(out.decision.action, "REJECT", "expected fail-closed action");
  });
});

suite("runtime/intake appeal oversize", () => {
  register("oversize appeal emits marker and APPEAL_OVERSIZE reason", () => {
    const mint = examineArtifactV1(fixturePath("safe_no_caps"), { profile: "web" }).mint;
    const policy = makePolicy({ bounds: { maxAppealBytes: 0 } });
    const outA = buildIntakeDecisionV1(mint, policy);
    const outB = buildIntakeDecisionV1(mint, policy);
    assert(outA.decision.topReasonCodes.includes("APPEAL_OVERSIZE"), "expected APPEAL_OVERSIZE reason");
    assertEq((outA.appeal as any).status, "OVERSIZE", "expected oversize appeal marker");
    assert(typeof (outA.appeal as any).bytes === "number", "expected oversize byte count");
    assertEq(canonicalJSON(outA.decision), canonicalJSON(outB.decision), "expected deterministic decision");
    assertEq(canonicalJSON(outA.appeal), canonicalJSON(outB.appeal), "expected deterministic appeal");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`intake_decision_v1.test.ts: ${t.name} failed${detail}`);
    }
  }
}
