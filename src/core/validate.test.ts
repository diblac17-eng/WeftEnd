/* src/core/validate.test.ts */
/**
 * WeftEnd (WebLayers v2.6) — Core validate deterministic tests
 *
 * Locks:
 * - validateNodeId fail-closed rules
 * - validateRuntimeBundle happy path + binding invariants
 * - deterministic ordering of ValidationIssue[] (code, path, message)
 * - trust-node binding invariants (GRANTS_MISMATCH, CANONICAL_INVALID)
 *
 * Framework compatibility:
 * - If Jest/Vitest globals exist (describe/it), we register tests.
 * - Otherwise, we run a tiny local harness at module load.
 */

import {
  validateNodeId,
  validateRuntimeBundle,
  validateTrustNodeResultTyped,
  type ValidationIssue,
} from "../core/validate";

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

function assertJsonEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${msg}\nExpected JSON: ${e}\nActual JSON: ${a}`);
}

function hasCode(issues: ValidationIssue[], code: string): boolean {
  return issues.some((i) => i.code === code);
}

function issueByCode(issues: ValidationIssue[], code: string): ValidationIssue | undefined {
  return issues.find((i) => i.code === code);
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

function makeValidBundle(): any {
  const nodeId = "page:/home";

  return {
    manifest: {
      id: "manifest-1",
      version: "2.6",
      rootPageId: nodeId,
      nodes: [
        {
          id: nodeId,
          class: "ui.static",
          title: "Home",
          dependencies: [],
          stamps: [
            {
              id: "s1",
              kind: "build",
              at: "2025-01-01T00:00:00.000Z",
              by: "tester",
            },
          ],
          capabilityRequests: [],
          runtime: {
            abi: "ui",
            engine: "js",
            entry: "index.js",
          },
          artifact: {
            kind: "inline",
            mime: "text/javascript",
            text: "export default function(){}",
            entry: "index.js",
          },
        },
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
      createdBy: "tester",
    },
    trust: {
      manifestId: "manifest-1",
      policyId: "policy-1",
      nodes: [
        {
          nodeId,
          status: "trusted",
          reasons: [],
          grants: [],
          digest: {
            producerHash: null,
            inputsHash: null,
            outputHash: null,
            grantedCaps: [],
          },
        },
      ],
    },
    plan: {
      manifestId: "manifest-1",
      policyId: "policy-1",
      nodes: [
        {
          nodeId,
          tier: "cache.global",
          allowExecute: true,
          grantedCaps: [],
        },
      ],
      planHash: "planhash-1",
    },
    compiler: {
      compilerId: "compiler-x",
      compilerVersion: "0.0.0",
      builtAt: "2025-01-01T00:00:00.000Z",
      manifestHash: "manifesthash-1",
      trustHash: "trusthash-1",
      planHash: "planhash-1",
    },
  };
}

function makeValidTrustNode(): any {
  return {
    nodeId: "block:root",
    status: "trusted",
    reasons: [],
    grants: [],
    digest: {
      producerHash: null,
      inputsHash: null,
      outputHash: null,
      grantedCaps: [],
    },
  };
}

suite("core/validate", () => {
  register("validateNodeId accepts allowed prefixes", () => {
    const valids = [
      "page:/x",
      "block:foo",
      "block:@pub/foo",
      "svc:svc1",
      "svc:@pub/svc1",
      "data:items",
      "data:@pub/items",
      "priv:secrets",
      "sess:auth",
      "asset:logo.png",
    ];
    for (let i = 0; i < valids.length; i++) {
      const issues = validateNodeId(valids[i], `ids[${i}]`);
      assertEq(issues.length, 0, `expected valid NodeId: ${valids[i]}`);
    }
  });

  register("validateNodeId rejects empty/whitespace/unknown prefix", () => {
    assert(validateNodeId("", "x").length > 0, "empty must fail");
    assert(hasCode(validateNodeId("", "x"), "NODE_ID_INVALID"), "empty must be NODE_ID_INVALID");

    assert(hasCode(validateNodeId("page:/has space", "x"), "NODE_ID_INVALID"), "whitespace must fail");
    assert(hasCode(validateNodeId("layout:foo", "x"), "NODE_ID_INVALID"), "unknown prefix must fail");
    assert(hasCode(validateNodeId("page:foo", "x"), "NODE_ID_INVALID"), "page must be page:/...");
  });

  register("validateRuntimeBundle accepts a minimal valid bundle", () => {
    const r = validateRuntimeBundle(makeValidBundle());
    assertEq(r.ok, true, "expected ok");
  });

  register("validateRuntimeBundle surfaces BINDING_INVALID for manifest/trust/plan/compiler mismatches", () => {
    const b = makeValidBundle();

    b.trust.manifestId = "manifest-OTHER";
    b.plan.manifestId = "manifest-OTHER2";
    b.compiler.planHash = "planhash-OTHER";

    const r = validateRuntimeBundle(b);
    assertEq(r.ok, false, "expected err");

    const issues = (r as any).error as ValidationIssue[];
    assert(hasCode(issues, "BINDING_INVALID"), "expected BINDING_INVALID present");
  });

  register("validateRuntimeBundle returns deterministically ordered issues (code, path, message)", () => {
    const b = makeValidBundle();

    // Two binding violations; ordering must be stable regardless of detection order.
    b.plan.manifestId = "X";
    b.trust.manifestId = "Y";

    const r = validateRuntimeBundle(b);
    assertEq(r.ok, false, "expected err");

    const issues = (r as any).error as ValidationIssue[];

    // Both are BINDING_INVALID; then path order decides.
    assertEq(issues[0].code, "BINDING_INVALID", "first issue code must be BINDING_INVALID");
    assertEq(
      issues[0].path,
      "bundle.plan.manifestId",
      "bundle.plan.manifestId should sort before bundle.trust.manifestId"
    );
    assertEq(issues[1].code, "BINDING_INVALID", "second issue code must be BINDING_INVALID");
    assertEq(issues[1].path, "bundle.trust.manifestId", "second path must be bundle.trust.manifestId");
  });

  register("validateTrustNodeResultTyped enforces grants == digest.grantedCaps (GRANTS_MISMATCH)", () => {
    const n = makeValidTrustNode();
    n.digest.grantedCaps = [{ capId: "net:fetch", grantedBy: "policy" }]; // valid grant
    n.grants = []; // mismatch

    const r = validateTrustNodeResultTyped(n);
    assertEq(r.ok, false, "expected err");
    const issues = (r as any).error as ValidationIssue[];
    assert(hasCode(issues, "GRANTS_MISMATCH"), "expected GRANTS_MISMATCH");
  });

  register("validateTrustNodeResultTyped fails closed when grants/digest.grantedCaps are not canonicalizable (CANONICAL_INVALID)", () => {
    const n = makeValidTrustNode();

    const cyclic: any = {};
    cyclic.self = cyclic;

    const g1 = { capId: "net:fetch", grantedBy: "policy", params: cyclic };

    n.grants = [g1];
    n.digest.grantedCaps = [g1];

    const r = validateTrustNodeResultTyped(n);
    assertEq(r.ok, false, "expected err");

    const issues = (r as any).error as ValidationIssue[];
    assert(hasCode(issues, "CANONICAL_INVALID"), "expected CANONICAL_INVALID");

    const i = issueByCode(issues, "CANONICAL_INVALID");
    assertEq(i?.path, "trustNode.grants", "canonical invalid should point at trustNode.grants");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`validate.test.ts: ${t.name} failed${detail}`);
    }
  }
}