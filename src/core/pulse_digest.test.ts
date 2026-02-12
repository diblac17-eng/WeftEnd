/* src/core/pulse_digest.test.ts */
/**
 * WeftEnd pulse + receipt summary digest determinism tests.
 */

import { computePulseDigestV0, computeReceiptSummaryDigestV0 } from "./pulse_digest";
import type { PulseBodyV0, ReceiptSummaryV0 } from "./types";

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

suite("core/pulse_digest", () => {
  register("pulse digest normalizes reason ordering", () => {
    const base: PulseBodyV0 = {
      schema: "weftend.pulse/0",
      v: 0,
      pulseSeq: 1,
      kind: "CAP_DENY",
      subject: { kind: "block", id: "block-1" },
      reasonCodes: ["B", "A"],
    };
    const digestA = computePulseDigestV0(base);
    const digestB = computePulseDigestV0({ ...base, reasonCodes: ["A", "B"] });
    assertEq(digestA, digestB, "pulse digest should be order-invariant for reasons");
  });

  register("receipt summary digest ignores receiptDigest and key order", () => {
    const summaryA: ReceiptSummaryV0 = {
      schema: "weftend.receiptSummary/0",
      v: 0,
      total: 3,
      denies: 1,
      quarantines: 1,
      bindTo: { releaseId: "release-1", pathDigest: "path-1" },
      lastReceiptId: "receipt-1",
      receiptDigest: "fnv1a32:aaaa",
    };
    const summaryB = {} as ReceiptSummaryV0;
    summaryB.bindTo = { pathDigest: "path-1", releaseId: "release-1" };
    summaryB.receiptDigest = "fnv1a32:bbbb";
    summaryB.schema = "weftend.receiptSummary/0";
    summaryB.v = 0;
    summaryB.denies = 1;
    summaryB.quarantines = 1;
    summaryB.total = 3;
    summaryB.lastReceiptId = "receipt-1";

    const digestA = computeReceiptSummaryDigestV0(summaryA);
    const digestB = computeReceiptSummaryDigestV0(summaryB);
    assertEq(digestA, digestB, "receipt digest should be stable across key order and receiptDigest");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`pulse_digest.test.ts: ${t.name} failed${detail}`);
    }
  }
}
