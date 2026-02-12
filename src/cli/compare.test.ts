/* src/cli/compare.test.ts */
/**
 * Unit tests for compare lane semantics.
 */

import { compareSummariesV0 } from "./compare";
import { computeCompareReceiptDigestV0, validateCompareReceiptV0 } from "../core/validate";

type TestFn = () => void | Promise<void>;

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

suite("cli/compare", () => {
  register("compareSummariesV0 returns SAME for identical summaries", () => {
    const summary = {
      result: "ALLOW",
      exitCode: 0,
      reasonCodes: ["OK"],
      artifactDigest: "sha256:11111111",
      policyDigest: "sha256:22222222",
    };
    const out = compareSummariesV0(summary, summary);
    assertEq(out.verdict, "SAME", "expected SAME verdict");
    assertEq(out.changeBuckets.length, 0, "expected no change buckets");
    assertEq(out.changes.length, 0, "expected no changes");
  });

  register("compareSummariesV0 truncates large reason diffs deterministically", () => {
    const leftReasons = Array.from({ length: 120 }, (_, i) => `LEFT_${String(i).padStart(3, "0")}`);
    const rightReasons = Array.from({ length: 120 }, (_, i) => `RIGHT_${String(i).padStart(3, "0")}`);
    const out = compareSummariesV0(
      { result: "ALLOW", reasonCodes: leftReasons },
      { result: "ALLOW", reasonCodes: rightReasons }
    );
    assertEq(out.verdict, "CHANGED", "expected CHANGED verdict");
    assert(out.changeBuckets.includes("REASONS_CHANGED"), "expected REASONS_CHANGED bucket");
    const reasonChange = out.changes.find((c) => c.bucket === "REASONS_CHANGED");
    assert(Boolean(reasonChange), "expected reasons change entry");
    assert(reasonChange!.added.some((v) => v.includes("TRUNCATED(+")), "expected added truncation marker");
    assert(reasonChange!.removed.some((v) => v.includes("TRUNCATED(+")), "expected removed truncation marker");
  });

  register("validateCompareReceiptV0 rejects sensitive markers in changes", () => {
    const receipt: any = {
      schema: "weftend.compareReceipt/0",
      v: 0,
      schemaVersion: 0,
      weftendBuild: { algo: "sha256", digest: "sha256:aaaaaaaa", source: "NODE_MAIN_JS" },
      kind: "CompareReceiptV0",
      left: { summaryDigest: "sha256:11111111", receiptKinds: ["safe_run_receipt"] },
      right: { summaryDigest: "sha256:22222222", receiptKinds: ["safe_run_receipt"] },
      verdict: "CHANGED",
      changeBuckets: ["REASONS_CHANGED"],
      changes: [
        {
          bucket: "REASONS_CHANGED",
          added: ["C:\\Users\\name\\secret.txt"],
          removed: [],
        },
      ],
      privacyLint: "PASS",
      reasonCodes: [],
      receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };
    receipt.receiptDigest = computeCompareReceiptDigestV0(receipt);
    const issues = validateCompareReceiptV0(receipt, "compareReceipt");
    assert(issues.some((i) => i.code === "FIELD_INVALID"), "expected FIELD_INVALID for sensitive marker");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`compare.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
