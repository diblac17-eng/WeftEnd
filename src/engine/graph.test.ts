/* src/engine/graph.test.ts */
/**
 * WeftEnd (WebLayers v2.6) — Graph validation tests (deterministic)
 *
 * Locks:
 * - cycle detection and error reporting
 * - dangling dependency detection
 * - duplicate node detection
 * - stable topological ordering regardless of input order
 *
 * Harness mirrors core tests: runs under BDD if present, otherwise executes locally.
 */

import { validateGraph } from "./graph";
import type { GraphManifest, GraphError } from "../core/types";

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

function assertErrorsContains(errs: GraphError[], code: string): void {
  assert(errs.some((e) => e.code === code), `Expected error code ${code} to be present.`);
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

function makeManifest(nodes: GraphManifest["nodes"], rootPageId: string): GraphManifest {
  return {
    id: "m1",
    version: "2.6",
    rootPageId,
    nodes,
    createdAt: "2025-01-01T00:00:00.000Z",
    createdBy: "tester",
  };
}

suite("engine/graph", () => {
  register("detects missing root", () => {
    const manifest = makeManifest(
      [
        { id: "page:/a", class: "ui.static" as const, dependencies: [], stamps: [], capabilityRequests: [] },
        { id: "page:/b", class: "ui.static" as const, dependencies: [], stamps: [], capabilityRequests: [] },
      ],
      "page:/missing"
    );

    const res = validateGraph(manifest);
    assertEq(res.ok, false, "should be Err for missing root");
    if (!res.ok) assertErrorsContains(res.error, "MISSING_ROOT");
  });

  register("detects duplicate nodes", () => {
    const manifest = makeManifest(
      [
        { id: "page:/a", class: "ui.static" as const, dependencies: [], stamps: [], capabilityRequests: [] },
        { id: "page:/a", class: "ui.static" as const, dependencies: [], stamps: [], capabilityRequests: [] },
      ],
      "page:/a"
    );

    const res = validateGraph(manifest);
    assertEq(res.ok, false, "should be Err for duplicate node ids");
    if (!res.ok) assertErrorsContains(res.error, "DUPLICATE_NODE");
  });

  register("detects dangling dependencies", () => {
    const manifest = makeManifest(
      [
        {
          id: "page:/a",
          class: "ui.static" as const,
          dependencies: [{ id: "page:/missing", role: "child", required: true }],
          stamps: [],
          capabilityRequests: [],
        },
      ],
      "page:/a"
    );

    const res = validateGraph(manifest);
    assertEq(res.ok, false, "should be Err for dangling dependency");
    if (!res.ok) assertErrorsContains(res.error, "DANGLING_DEPENDENCY");
  });

  register("detects cycles deterministically", () => {
    const manifest = makeManifest(
      [
        {
          id: "page:/a",
          class: "ui.static" as const,
          dependencies: [{ id: "page:/b", role: "child", required: true }],
          stamps: [],
          capabilityRequests: [],
        },
        {
          id: "page:/b",
          class: "ui.static" as const,
          dependencies: [{ id: "page:/a", role: "parent", required: true }],
          stamps: [],
          capabilityRequests: [],
        },
      ],
      "page:/a"
    );

    const res = validateGraph(manifest);
    assertEq(res.ok, false, "should be Err for cycle");
    if (!res.ok) assertErrorsContains(res.error, "CYCLE_DETECTED");
  });

  register("produces stable topological order regardless of authoring order", () => {
    const nodesA = [
      {
        id: "page:/a",
        class: "ui.static" as const,
        dependencies: [
          { id: "page:/b", role: "child", required: true },
          { id: "page:/c", role: "child", required: true },
        ],
        stamps: [],
        capabilityRequests: [],
      },
      {
        id: "page:/b",
        class: "ui.static" as const,
        dependencies: [{ id: "page:/c", role: "child", required: true }],
        stamps: [],
        capabilityRequests: [],
      },
      { id: "page:/c", class: "ui.static" as const, dependencies: [], stamps: [], capabilityRequests: [] },
    ];

    const nodesB = [...nodesA].reverse(); // different authoring order

    const resA = validateGraph(makeManifest(nodesA, "page:/a"));
    const resB = validateGraph(makeManifest(nodesB, "page:/a"));

    assertEq(resA.ok, true, "graph A should be OK");
    assertEq(resB.ok, true, "graph B should be OK");

    if (resA.ok && resB.ok) {
      const orderA = resA.value.topoOrder.map((n) => n.id);
      const orderB = resB.value.topoOrder.map((n) => n.id);
      assertEq(
        JSON.stringify(orderA),
        JSON.stringify(orderB),
        "topological order must be identical regardless of input order"
      );
      assertEq(orderA.join(","), "page:/c,page:/b,page:/a", "expected stable topological order");
    }
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`graph.test.ts: ${t.name} failed${detail}`);
    }
  }
}
