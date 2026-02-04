/* src/core/intake_policy_v1.test.ts */
/**
 * Intake policy canonicalization + validation tests.
 */

import { canonicalJSON } from "./canon";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "./intake_policy_v1";
import { validateWeftEndPolicyV1 } from "./validate";

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

const makePolicy = () => ({
  schema: "weftend.intake.policy/1" as const,
  profile: "web" as const,
  reasonSeverity: {
    CAP_DENY_NET: "WARN" as const,
    CAP_DENY_STORAGE: "WARN" as const,
  },
  severityAction: {
    INFO: "APPROVE" as const,
    WARN: "QUEUE" as const,
    DENY: "REJECT" as const,
    QUARANTINE: "HOLD" as const,
  },
  capsPolicy: {
    net: {
      allowedDomains: ["Example.com", "b.example.com", "example.com", "a.example.com"],
    },
    fs: {
      allowedPaths: ["C:\\Data\\Mods", "c:/data/mods", "/opt/mods/", "/var/mods"],
    },
    storage: { allow: true },
    childProcess: { allow: false },
  },
  disclosure: {
    requireOnWARN: true,
    requireOnDENY: true,
    maxLines: 6,
  },
  bounds: {
    maxReasonCodes: 8,
    maxCapsItems: 2,
    maxDisclosureChars: 256,
    maxAppealBytes: 512,
  },
});

suite("core/intake policy v1", () => {
  register("canonicalization normalizes and truncates deterministically", () => {
    const policy = canonicalizeWeftEndPolicyV1(makePolicy());
    const domains = policy.capsPolicy.net?.allowedDomains ?? [];
    const paths = policy.capsPolicy.fs?.allowedPaths ?? [];
    assertEq(canonicalJSON(domains), canonicalJSON(["a.example.com", "b.example.com", "...(+1)"]), "domain list");
    assertEq(canonicalJSON(paths), canonicalJSON(["/opt/mods", "/var/mods", "...(+1)"]), "path list");
  });

  register("policy digest is stable under canonicalization", () => {
    const policy = makePolicy();
    const idA = computeWeftEndPolicyIdV1(policy);
    const idB = computeWeftEndPolicyIdV1(policy);
    assertEq(idA, idB, "policyId must be stable");
  });

  register("validation fails on schema mismatch", () => {
    const policy = { ...makePolicy(), schema: "bad.schema" };
    const issues = validateWeftEndPolicyV1(policy, "policy");
    assert(issues.some((iss) => iss.code === "FIELD_INVALID"), "expected FIELD_INVALID");
  });

  register("validation fails when reasonSeverity exceeds bounds", () => {
    const policy = makePolicy();
    policy.bounds.maxReasonCodes = 1;
    const issues = validateWeftEndPolicyV1(policy, "policy");
    assert(
      issues.some((iss) => iss.code === "POLICY_UNBOUNDED_REASON_SEVERITY"),
      "expected POLICY_UNBOUNDED_REASON_SEVERITY"
    );
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`intake_policy_v1.test.ts: ${t.name} failed${detail}`);
    }
  }
}
