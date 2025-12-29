/* src/core/canon.test.ts */
/**
 * WeftEnd (WebLayers v2.6) — Core Canon deterministic tests
 *
 * Locks:
 * - canonicalJSON normalization + key ordering + cycle/shared-ref error
 * - deterministic ordering semantics of the canon sort helpers
 *
 * Framework compatibility:
 * - If Jest/Vitest globals exist (describe/it), we register tests.
 * - Otherwise, we run a tiny local harness at module load.
 */

import {
  canonicalJSON,
  sortById,
  sortDependencies,
  sortCapRequests,
  sortCapGrants,
  sortByNodeId,
  sortBlockPins,
  sortEvidenceEnvelopes,
  sortNormalizedClaims,
  sortPortalCollection,
} from "../core/canon";

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

function assertThrows(fn: () => unknown, expectedMessage: string, msg: string): void {
  let threw = false;
  try {
    fn();
  } catch (e: any) {
    threw = true;
    assertEq(e?.message, expectedMessage, `${msg} (wrong error message)`);
  }
  assert(threw, `${msg} (did not throw)`);
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

suite("core/canon", () => {
  register("canonicalJSON sorts object keys lexicographically", () => {
    const s = canonicalJSON({ b: 1, a: 2 });
    assertEq(s, '{"a":2,"b":1}', "object key order must be sorted");
  });

  register("canonicalJSON normalizes undefined and null to null", () => {
    const s1 = canonicalJSON({ a: undefined, b: null });
    assertEq(s1, '{"a":null,"b":null}', "undefined and null normalize to null");

    const s2 = canonicalJSON(undefined);
    assertEq(s2, "null", "top-level undefined normalizes to null");

    const s3 = canonicalJSON(null);
    assertEq(s3, "null", "top-level null stays null");
  });

  register("canonicalJSON normalizes function and symbol to null", () => {
    const s1 = canonicalJSON({ f: () => 123 });
    assertEq(s1, '{"f":null}', "function values normalize to null");

    const s2 = canonicalJSON(Symbol("x"));
    assertEq(s2, "null", "top-level symbol normalizes to null");

    const s3 = canonicalJSON({ s: Symbol("y") });
    assertEq(s3, '{"s":null}', "symbol values normalize to null");
  });

  register("canonicalJSON preserves array order (and normalizes undefined within arrays)", () => {
    const s = canonicalJSON([1, undefined, 3]);
    assertEq(s, "[1,null,3]", "array order must be preserved");
  });

  register("canonicalJSON sorts nested object keys", () => {
    const s = canonicalJSON({ z: { b: 1, a: 2 } });
    assertEq(s, '{"z":{"a":2,"b":1}}', "nested object keys must be sorted");
  });

  register("canonicalJSON throws CYCLE_IN_CANONICAL_JSON on cycles", () => {
    const o: any = {};
    o.self = o;
    assertThrows(() => canonicalJSON(o), "CYCLE_IN_CANONICAL_JSON", "cycle must throw");
  });

  register("canonicalJSON throws CYCLE_IN_CANONICAL_JSON on shared references", () => {
    const shared: any = { x: 1 };
    const o: any = { a: shared, b: shared };
    assertThrows(
      () => canonicalJSON(o),
      "CYCLE_IN_CANONICAL_JSON",
      "shared references must throw (tree-shaped only)"
    );
  });

  register("sortById orders by id ascending and does not mutate input", () => {
    const input = [
      { id: "b", n: 2 },
      { id: "a", n: 1 },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    const out = sortById(input);
    assertJsonEq(input, snapshot, "sortById must not mutate input");
    assertEq(out[0].id, "a", "sortById must sort ascending");
    assertEq(out[1].id, "b", "sortById must sort ascending");
  });

  register("sortById is stable when id ties (preserve original order)", () => {
    const input = [
      { id: "a", n: 1 },
      { id: "a", n: 2 },
      { id: "b", n: 3 },
    ];
    const out = sortById(input);
    assertEq(out[0].n, 1, "stable: first tied element stays first");
    assertEq(out[1].n, 2, "stable: second tied element stays second");
  });

  register("sortDependencies orders by id then role", () => {
    const input = [
      { id: "b", role: "z" },
      { id: "a", role: "b" },
      { id: "a", role: "a" },
    ];
    const out = sortDependencies(input);
    assertJsonEq(
      out.map((d) => ({ id: d.id, role: d.role })),
      [
        { id: "a", role: "a" },
        { id: "a", role: "b" },
        { id: "b", role: "z" },
      ],
      "dependencies must sort by id, then role"
    );
  });

  register("sortCapRequests orders by capId then canonicalJSON(params)", () => {
    const input = [
      { capId: "cap", params: { b: 1, a: 2 } },
      { capId: "cap", params: null },
      { capId: "cap", params: { a: 2, b: 1 } },
      { capId: "a-cap", params: { z: 1 } },
    ];

    const out = sortCapRequests(input);

    // capId ordering
    assertEq(out[0].capId, "a-cap", "capId must sort ascending");
    assertEq(out[1].capId, "cap", "capId must sort ascending");

    // within capId === "cap": params are compared by canonicalJSON, where null => "null"
    // and object => "{...}"; since "null" < "{...}" lexicographically, null comes first.
    assertEq(canonicalJSON(out[1].params ?? null), "null", "null params must sort first");

    // tie on canonical params: {b:1,a:2} and {a:2,b:1} canonicalize identically, so order is stable.
    const capOnly = out.filter((x) => x.capId === "cap");
    assertEq(capOnly.length, 3, "expected three 'cap' entries");
    assertEq(
      canonicalJSON(capOnly[1].params ?? null),
      '{"a":2,"b":1}',
      "canonical params must match"
    );
    assertEq(
      canonicalJSON(capOnly[2].params ?? null),
      '{"a":2,"b":1}',
      "canonical params must match"
    );
    assertEq(
      (capOnly[1].params as any)?.b,
      1,
      "stable: first equivalent canonical params stays first"
    );
  });

  register("sortEvidenceEnvelopes orders by kind then canonical payload and is stable", () => {
    const input = [
      { kind: "b", payload: { z: 2, a: 1 } },
      { kind: "a", payload: null },
      { kind: "a", payload: { a: 1, b: 2 } },
      { kind: "a", payload: { b: 2, a: 1 } },
    ];

    const out = sortEvidenceEnvelopes(input);

    assertEq(out[0].kind, "a", "kind must sort ascending");
    assertEq(out[1].kind, "a", "kind must sort ascending");
    assertEq(out[2].kind, "a", "kind must sort ascending");
    assertEq(out[3].kind, "b", "kind must sort ascending");

    const canon = out.map((e) => canonicalJSON(e.payload ?? null));
    assertEq(canon[0], "null", "null payload sorts first within kind");
    assertEq(canon[1], canon[2], "equivalent payloads preserve stability");
  });

  register("sortNormalizedClaims orders by claimId then evidenceKind then normalized", () => {
    const input = [
      { claimId: "c2", evidenceKind: "sig", normalized: { b: 2, a: 1 } },
      { claimId: "c1", evidenceKind: "sig", normalized: { z: 1 } },
      { claimId: "c1", evidenceKind: "hash", normalized: { z: 1 } },
      { claimId: "c1", evidenceKind: "sig", normalized: { z: 1 } },
    ];

    const out = sortNormalizedClaims(input);
    assertEq(out[0].claimId, "c1", "claimId must sort ascending");
    assertEq(out[1].claimId, "c1", "claimId must sort ascending");
    assertEq(out[2].claimId, "c1", "claimId must sort ascending");
    assertEq(out[3].claimId, "c2", "claimId must sort ascending");

    assertEq(out[0].evidenceKind, "hash", "evidenceKind sorts within claimId");
    assertEq(out[1].evidenceKind, "sig", "evidenceKind sorts within claimId");
    assertEq(out[2].evidenceKind, "sig", "evidenceKind sorts within claimId");
    assertEq(
      canonicalJSON(out[1].normalized ?? null),
      canonicalJSON(out[2].normalized ?? null),
      "equivalent normalized payloads are stable"
    );
  });

  register("sortPortalCollection orders by nodeId, evidenceKind, claimId, payload", () => {
    const input = [
      { nodeId: "block:b", evidenceKind: "sig", claimId: "c2", payload: { z: 2, a: 1 } },
      { nodeId: "block:a", evidenceKind: "sig", claimId: "c2", payload: { z: 1 } },
      { nodeId: "block:a", evidenceKind: "hash", claimId: "c1", payload: { z: 1 } },
      { nodeId: "block:a", evidenceKind: "sig", claimId: "c1", payload: { z: 1 } },
    ];

    const out = sortPortalCollection(input);
    assertEq(out[0].nodeId, "block:a", "nodeId sorts ascending");
    assertEq(out[1].nodeId, "block:a", "nodeId sorts ascending");
    assertEq(out[2].nodeId, "block:a", "nodeId sorts ascending");
    assertEq(out[3].nodeId, "block:b", "nodeId sorts ascending");

    assertEq(out[0].evidenceKind, "hash", "evidenceKind sorts within node");
    assertEq(out[1].claimId, "c1", "claimId sorts after evidenceKind");
    assertEq(out[2].claimId, "c2", "claimId sorts after evidenceKind");
  });

  register("sortCapGrants matches sortCapRequests ordering", () => {
    const input = [
      { capId: "cap", params: { b: 1, a: 2 } },
      { capId: "cap", params: null },
      { capId: "a-cap", params: { z: 1 } },
    ];

    const out1 = sortCapRequests(input);
    const out2 = sortCapGrants(input);

    assertJsonEq(
      out2.map((c) => ({ capId: c.capId, canon: canonicalJSON(c.params ?? null) })),
      out1.map((c) => ({ capId: c.capId, canon: canonicalJSON(c.params ?? null) })),
      "grants ordering must match requests ordering"
    );
  });

  register("sortByNodeId orders by nodeId ascending and is stable on ties", () => {
    const input = [
      { nodeId: "b", n: 2 },
      { nodeId: "a", n: 1 },
      { nodeId: "a", n: 3 },
    ];
    const out = sortByNodeId(input);
    assertEq(out[0].nodeId, "a", "nodeId must sort ascending");
    assertEq(out[0].n, 1, "stable on ties preserves first occurrence");
    assertEq(out[1].n, 3, "stable on ties keeps subsequent occurrence next");
    assertEq(out[2].nodeId, "b", "nodeId must sort ascending");
  });

  register("sortBlockPins orders by nodeId then contentHash", () => {
    const input = [
      { nodeId: "b", contentHash: "2" },
      { nodeId: "a", contentHash: "b" },
      { nodeId: "a", contentHash: "a" },
    ];
    const out = sortBlockPins(input);
    assertJsonEq(
      out,
      [
        { nodeId: "a", contentHash: "a" },
        { nodeId: "a", contentHash: "b" },
        { nodeId: "b", contentHash: "2" },
      ],
      "pins must sort by nodeId, then contentHash"
    );
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      // Re-throw with test context.
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`canon.test.ts: ${t.name} failed${detail}`);
    }
  }
}
