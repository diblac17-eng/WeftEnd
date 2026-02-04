/* src/core/trust_algebra_v0.test.ts */
/**
 * WeftEnd (WebLayers v2.6) TRUST_ALGEBRA_V0 tests (deterministic).
 */

import {
  assertStableSortedUniqueV0,
  checkpointEqOrReasonV0,
  createReasonBudgetV0,
  joinDecisionV0,
  joinReasonsV0,
  joinStringsV0,
  MAX_REASON_DETAIL_BYTES,
  MAX_REASONS_PER_BLOCK,
  MAX_REASONS_TOTAL,
  normalizeReasonCodesV0,
  stableSortUniqueReasonCodesV0,
  stableSortUniqueReasonsV0,
  stableSortUniqueStringsV0,
  truncateReasonDetailV0,
} from "./trust_algebra_v0";

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

suite("core/trust_algebra_v0", () => {
  register("stableSortUniqueStringsV0 is deterministic", () => {
    const out = stableSortUniqueStringsV0(["b", "a", "b"]);
    assertEq(out.join(","), "a,b", "expected stable sorted unique strings");
  });

  register("stableSortUniqueReasonCodesV0 aliases reason sorting", () => {
    const out = stableSortUniqueReasonCodesV0(["Z", "A", "A"]);
    assertEq(out.join(","), "A,Z", "expected stable sorted unique reason codes");
  });

  register("joinReasonsV0 is commutative, associative, idempotent", () => {
    const a = ["Z", "A", "A"];
    const b = ["B"];
    const c = ["C", "A"];
    const ab = joinReasonsV0(a, b);
    const ba = joinReasonsV0(b, a);
    assertEq(ab.join(","), ba.join(","), "joinReasonsV0 must be commutative");

    const left = joinReasonsV0(ab, c);
    const right = joinReasonsV0(a, joinReasonsV0(b, c));
    assertEq(left.join(","), right.join(","), "joinReasonsV0 must be associative");

    const idempotent = joinReasonsV0(a, a);
    assertEq(idempotent.join(","), stableSortUniqueReasonsV0(a).join(","), "joinReasonsV0 must be idempotent");
  });

  register("joinStringsV0 is commutative", () => {
    const a = ["b", "a"];
    const b = ["c"];
    const ab = joinStringsV0(a, b);
    const ba = joinStringsV0(b, a);
    assertEq(ab.join(","), ba.join(","), "joinStringsV0 must be commutative");
  });

  register("joinDecisionV0 follows lattice rules", () => {
    assertEq(joinDecisionV0("YES", "YES"), "YES", "YES + YES -> YES");
    assertEq(joinDecisionV0("YES", "MAYBE"), "MAYBE", "YES + MAYBE -> MAYBE");
    assertEq(joinDecisionV0("MAYBE", "MAYBE"), "MAYBE", "MAYBE + MAYBE -> MAYBE");
    assertEq(joinDecisionV0("NO", "YES"), "NO", "NO overrides YES");
    assertEq(joinDecisionV0("MAYBE", "NO"), "NO", "NO overrides MAYBE");
  });

  register("checkpointEqOrReasonV0 is deterministic", () => {
    const ok = checkpointEqOrReasonV0("a", "a", "MISMATCH");
    const bad = checkpointEqOrReasonV0("a", "b", "MISMATCH");
    assertEq(ok.length, 0, "expected empty array when equal");
    assertEq(bad.join(","), "MISMATCH", "expected mismatch reason");
  });

  register("assertStableSortedUniqueV0 enforces sorted unique", () => {
    assert(assertStableSortedUniqueV0(["a", "b"], "demo"), "expected stable sorted unique");
    let threw = false;
    try {
      assertStableSortedUniqueV0(["b", "a"], "demo");
    } catch {
      threw = true;
    }
    assert(threw, "expected assertion to throw on unsorted input");
  });

  register("normalizeReasonCodesV0 keeps max per-block without truncation", () => {
    const input = Array.from({ length: MAX_REASONS_PER_BLOCK }, (_, i) => `R${String(i).padStart(2, "0")}`);
    const out = normalizeReasonCodesV0(input);
    assertEq(out.length, MAX_REASONS_PER_BLOCK, "expected max per-block kept");
    assert(!out.some((code) => code.startsWith("TRUST_REASONS_TRUNCATED")), "unexpected truncation meta reason");
  });

  register("normalizeReasonCodesV0 truncates and adds meta reason", () => {
    const total = MAX_REASONS_PER_BLOCK + 2;
    const input = Array.from({ length: total }, (_, i) => `R${String(i).padStart(2, "0")}`);
    const out = normalizeReasonCodesV0(input);
    assertEq(out.length, MAX_REASONS_PER_BLOCK, "expected truncation to max per-block");
    const meta = out.find((code) => code.startsWith("TRUST_REASONS_TRUNCATED"));
    assert(Boolean(meta), "expected truncation meta reason");
    const kept = MAX_REASONS_PER_BLOCK - 1;
    const dropped = total - kept;
    assertEq(meta as string, `TRUST_REASONS_TRUNCATED:kept=${kept},dropped=${dropped}`, "expected truncation detail");
  });

  register("normalizeReasonCodesV0 respects total budget", () => {
    const budget = createReasonBudgetV0(8);
    const total = 9;
    const input = Array.from({ length: total }, (_, i) => `B${i}`);
    const out = normalizeReasonCodesV0(input, { maxPerSubject: total, budget });
    assertEq(out.length, 8, "expected budgeted truncation");
    const meta = out.find((code) => code.startsWith("TRUST_REASONS_TRUNCATED"));
    assert(Boolean(meta), "expected budget truncation meta reason");
    assertEq(budget.used, 8, "expected budget use to update");
    assertEq(meta as string, "TRUST_REASONS_TRUNCATED:kept=7,dropped=2", "expected budget meta detail");
  });

  register("normalizeReasonCodesV0 accepts MAX_REASONS_TOTAL when budget allows", () => {
    const budget = createReasonBudgetV0(MAX_REASONS_TOTAL);
    const input = Array.from({ length: MAX_REASONS_TOTAL }, (_, i) => `T${i}`);
    const out = normalizeReasonCodesV0(input, { maxPerSubject: MAX_REASONS_TOTAL, budget });
    assertEq(out.length, MAX_REASONS_TOTAL, "expected full budget to be kept");
    assert(!out.some((code) => code.startsWith("TRUST_REASONS_TRUNCATED")), "unexpected truncation meta reason");
  });

  register("truncateReasonDetailV0 caps detail bytes", () => {
    const detail = "a".repeat(MAX_REASON_DETAIL_BYTES + 10);
    const out = truncateReasonDetailV0(detail);
    assert(Boolean(out), "expected truncated detail");
    assertEq((out as string).length, MAX_REASON_DETAIL_BYTES, "expected detail length capped");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`trust_algebra_v0.test.ts: ${t.name} failed${detail}`);
    }
  }
}
