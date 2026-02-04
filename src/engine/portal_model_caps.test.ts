// src/engine/portal_model_caps.test.ts
// PortalModel projection caps tests (deterministic, bounded).

import { canonicalJSON } from "../core/canon";
import {
  buildPortalModel,
  MAX_CAPS_PER_BLOCK,
  MAX_PORTAL_BLOCKS,
  MAX_STAMPS_PER_BLOCK,
  MAX_STR_BYTES,
  MAX_TARTARUS_PER_BLOCK,
  MAX_TARTARUS_TOTAL,
} from "./portal_model";
import type { PortalModelInput } from "./portal_model";
import type { TartarusRecordV0 } from "../core/types";

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

const makeTartarusRecord = (blockHash: string, seq: number): TartarusRecordV0 => ({
  schema: "weftend.tartarus/0",
  recordId: `rec-${blockHash}-${String(seq).padStart(3, "0")}`,
  planDigest: "plan-t",
  blockHash,
  kind: "cap.replay",
  severity: "DENY",
  remedy: "NONE",
  reasonCodes: ["REPLAY_DETECTED"],
  seq,
});

suite("engine/portal_model projection caps", () => {
  register("caps block list deterministically and reports truncation", () => {
    const blocks = Array.from({ length: MAX_PORTAL_BLOCKS + 1 }, (_, i) => ({
      blockHash: `block-${String(i).padStart(4, "0")}`,
      executionMode: "strict",
      requestedCaps: [],
      eligibleCaps: [],
      evidenceRecords: [],
      verifyResult: { status: "VERIFIED" as const },
    }));

    const input: PortalModelInput = { planDigest: "plan-caps", blocks };
    const shuffled: PortalModelInput = { planDigest: "plan-caps", blocks: [...blocks].reverse() };

    const modelA = buildPortalModel(input);
    const modelB = buildPortalModel(shuffled);
    assertEq(canonicalJSON(modelA), canonicalJSON(modelB), "projection must be deterministic under shuffle");
    assertEq(modelA.blocks.length, MAX_PORTAL_BLOCKS, "expected block list to be capped");
    const truncations = modelA.projectionTruncations || [];
    const blocksTrunc = truncations.find((t: any) => t.section === "blocks");
    assert(blocksTrunc, "expected blocks truncation record");
    assertEq(blocksTrunc?.kept, MAX_PORTAL_BLOCKS, "expected kept count for blocks");
    assertEq(blocksTrunc?.dropped, 1, "expected dropped count for blocks");
  });

  register("caps per-block lists and reports truncation details", () => {
    const requestedCaps = Array.from({ length: MAX_CAPS_PER_BLOCK + 2 }, (_, i) => `cap-${i}`);
    const eligibleCaps = Array.from({ length: MAX_CAPS_PER_BLOCK + 3 }, (_, i) => `elig-${i}`);
    const deniedCaps = Array.from({ length: MAX_CAPS_PER_BLOCK + 4 }, (_, i) => ({
      capId: `deny-${i}`,
      reasonCodes: ["CAP_DENIED"],
    }));
    const evidenceRecords = Array.from({ length: MAX_STAMPS_PER_BLOCK + 1 }, (_, i) => ({
      kind: `kind-${i}`,
      payload: { i },
    }));
    const tartarusRecords = Array.from({ length: MAX_TARTARUS_PER_BLOCK + 2 }, (_, i) =>
      makeTartarusRecord("block-caps", i + 1)
    );

    const input: PortalModelInput = {
      planDigest: "plan-per-block",
      blocks: [
        {
          blockHash: "block-caps",
          executionMode: "strict" as const,
          requestedCaps,
          eligibleCaps,
          deniedCaps,
          evidenceRecords,
          tartarusRecords,
          verifyResult: { status: "UNVERIFIED" as const, reasonCodes: ["FAIL"] },
        },
      ],
    };

    const model = buildPortalModel(input);
    const row = model.blocks[0];
    assertEq(row.requestedCaps.length, MAX_CAPS_PER_BLOCK, "requested caps capped");
    assertEq(row.eligibleCaps.length, MAX_CAPS_PER_BLOCK, "eligible caps capped");
    assertEq(row.deniedCaps.length, MAX_CAPS_PER_BLOCK, "denied caps capped");
    assertEq(row.evidence.length, MAX_STAMPS_PER_BLOCK, "evidence summaries capped");
    const truncations = model.projectionTruncations || [];
    const sections = truncations.map((t: any) => t.section);
    assert(sections.includes("block:block-caps:requestedCaps"), "expected requestedCaps truncation");
    assert(sections.includes("block:block-caps:eligibleCaps"), "expected eligibleCaps truncation");
    assert(sections.includes("block:block-caps:deniedCaps"), "expected deniedCaps truncation");
    assert(sections.includes("block:block-caps:evidence"), "expected evidence truncation");
    assert(sections.includes("block:block-caps:tartarus"), "expected tartarus truncation");
    truncations.forEach((entry: any) => {
      const keys = Object.keys(entry).sort().join(",");
      assertEq(keys, "code,dropped,kept,section", "truncation record must be bounded");
      assertEq(entry.code, "PORTAL_PROJECTION_TRUNCATED", "expected truncation code");
      assert(entry.section.length <= MAX_STR_BYTES, "section must be byte-bounded");
    });
  });

  register("caps tartarus totals and reports global truncation", () => {
    const blocks = Array.from({ length: 65 }, (_, i) => {
      const blockHash = `block-t-${String(i).padStart(2, "0")}`;
      return {
        blockHash,
        executionMode: "strict" as const,
        requestedCaps: [],
        eligibleCaps: [],
        evidenceRecords: [],
        tartarusRecords: Array.from({ length: MAX_TARTARUS_PER_BLOCK }, (_, j) =>
          makeTartarusRecord(blockHash, j + 1)
        ),
        verifyResult: { status: "UNVERIFIED" as const, reasonCodes: ["FAIL"] },
      };
    });

    const input: PortalModelInput = { planDigest: "plan-total", blocks };
    const model = buildPortalModel(input);
    const truncations = model.projectionTruncations || [];
    const totalTrunc = truncations.find((t: any) => t.section === "tartarus.total");
    assert(totalTrunc, "expected tartarus.total truncation");
    assertEq(totalTrunc?.kept, MAX_TARTARUS_TOTAL, "expected kept tartarus total");
    assertEq(totalTrunc?.dropped, 16, "expected dropped tartarus total");
    assertEq(model.tartarus?.total, MAX_TARTARUS_TOTAL, "tartarus summary uses capped total");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`portal_model_caps.test.ts: ${t.name} failed${detail}`);
    }
  }
}
