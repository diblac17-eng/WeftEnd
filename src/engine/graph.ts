/* src/engine/graph.ts */
/**
 * WeftEnd (WebLayers v2.6) — Deterministic graph validation + ordering
 *
 * Pure functions only. No side effects, no imports outside core.
 *
 * Responsibilities (Phase 2):
 * - detect cycles, dangling dependencies, duplicate nodes, missing root
 * - produce a stable topological order (deterministic regardless of authoring order)
 * - fail closed: any structural error => Err with ordered GraphError[]
 */

import { sortDependencies } from "../core/canon";
import type { Err, GraphError, GraphManifest, Node, Ok, Result } from "../core/types";

type Wrapped<T> = { v: T; i: number };

const wrap = <T>(arr: T[]): Wrapped<T>[] => arr.map((v, i) => ({ v, i }));

const sortNodesStable = (nodes: Node[]): Node[] =>
  wrap(nodes)
    .sort((a, b) => {
      const c = a.v.id.localeCompare(b.v.id);
      if (c !== 0) return c;
      return a.i - b.i;
    })
    .map((x) => x.v);

const sortErrors = (errs: GraphError[]): GraphError[] =>
  wrap(errs)
    .sort((a, b) => {
      const cc = a.v.code.localeCompare(b.v.code);
      if (cc !== 0) return cc;
      const cn = (a.v.nodeId ?? "").localeCompare(b.v.nodeId ?? "");
      if (cn !== 0) return cn;
      const cp = (a.v.path ?? "").localeCompare(b.v.path ?? "");
      if (cp !== 0) return cp;
      return a.i - b.i;
    })
    .map((x) => x.v);

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export interface GraphCheckResult {
  topoOrder: Node[];
}

export function validateGraph(manifest: GraphManifest): Result<GraphCheckResult, GraphError[]> {
  const errors: GraphError[] = [];
  const nodesById = new Map<string, Wrapped<Node>[]>();

  wrap(manifest.nodes).forEach((n) => {
    const list = nodesById.get(n.v.id) ?? [];
    list.push(n);
    nodesById.set(n.v.id, list);
  });

  // Missing root check
  if (!nodesById.has(manifest.rootPageId)) {
    errors.push({
      code: "MISSING_ROOT",
      message: "rootPageId must reference an existing node.",
      nodeId: manifest.rootPageId,
      path: "manifest.rootPageId",
    });
  }

  // Duplicate detection (only report duplicates beyond the first occurrence).
  for (const [, entries] of nodesById) {
    if (entries.length > 1) {
      entries.slice(1).forEach((dup) =>
        errors.push({
          code: "DUPLICATE_NODE",
          message: "Duplicate node id detected.",
          nodeId: dup.v.id,
          path: `manifest.nodes[${dup.i}].id`,
        })
      );
    }
  }

  const sortedNodes = sortNodesStable(manifest.nodes);

  // Dangling dependency detection and edge normalization (stable).
  const adjacency = new Map<string, string[]>();
  for (const node of sortedNodes) {
    const deps = sortDependencies(node.dependencies ?? []);
    deps.forEach((d, idx) => {
      if (!nodesById.has(d.id)) {
        errors.push({
          code: "DANGLING_DEPENDENCY",
          message: "Dependency does not exist in manifest.nodes.",
          nodeId: node.id,
          path: `manifest.nodes[${manifest.nodes.indexOf(node)}].dependencies[${idx}]`,
        });
      } else {
        const dependents = adjacency.get(d.id) ?? [];
        dependents.push(node.id);
        adjacency.set(d.id, dependents);
      }
    });
  }

  if (errors.length > 0) return err(sortErrors(errors));

  // Cycle detection + stable topological sort (Kahn with stable queue).
  const indegree = new Map<string, number>();
  for (const node of sortedNodes) indegree.set(node.id, (node.dependencies ?? []).length);

  const queue = wrap(sortedNodes.filter((n) => (indegree.get(n.id) ?? 0) === 0)).sort((a, b) => {
    const c = a.v.id.localeCompare(b.v.id);
    if (c !== 0) return c;
    return a.i - b.i;
  });

  const topo: Node[] = [];
  while (queue.length) {
    const next = queue.shift()!;
    topo.push(next.v);

    for (const dependent of adjacency.get(next.v.id) ?? []) {
      const newDeg = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, newDeg);
      if (newDeg === 0) {
        const originalIdx = manifest.nodes.findIndex((n) => n.id === dependent);
        queue.push({ v: manifest.nodes[originalIdx], i: originalIdx });
        queue.sort((a, b) => {
          const c = a.v.id.localeCompare(b.v.id);
          if (c !== 0) return c;
          return a.i - b.i;
        });
      }
    }
  }

  if (topo.length !== sortedNodes.length) {
    // Cycle detected; find a deterministic node to report (lowest nodeId in remaining indegree>0)
    const remaining = sortNodesStable(
      sortedNodes.filter((n) => (indegree.get(n.id) ?? 0) > 0)
    );
    const nodeId = remaining[0]?.id;
    return err(
      sortErrors([
        {
          code: "CYCLE_DETECTED",
          message: "Cycle detected in dependency graph.",
          nodeId,
        },
      ])
    );
  }

  return ok({ topoOrder: topo });
}
