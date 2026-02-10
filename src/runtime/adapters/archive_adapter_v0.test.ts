/* src/runtime/adapters/archive_adapter_v0.test.ts */
// Archive adapter determinism + truncation behavior.

import { summarizeArchiveAdapterV0, computeArchiveAdapterDigestV0 } from "./archive_adapter_v0";

declare const process: any;

const path = require("path");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const run = (): void => {
  const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
  const a = summarizeArchiveAdapterV0(input);
  const b = summarizeArchiveAdapterV0(input);
  assert(a.ok, "expected archive summary ok");
  assert(b.ok, "expected archive summary ok");
  if (!a.ok || !b.ok) return;
  assertEq(
    computeArchiveAdapterDigestV0(a.value),
    computeArchiveAdapterDigestV0(b.value),
    "archive summary digest must be stable"
  );
  const truncated = summarizeArchiveAdapterV0(input, { maxEntries: 0 });
  assert(truncated.ok, "expected truncation summary");
  if (!truncated.ok) return;
  assertEq(truncated.value.truncated, true, "expected truncated true with maxEntries=0");
  assert(
    truncated.value.markers.includes("ARCHIVE_ENTRIES_TRUNCATED"),
    "expected ARCHIVE_ENTRIES_TRUNCATED marker"
  );
};

try {
  run();
  console.log("archive_adapter_v0.test: PASS");
} catch (error) {
  console.error("archive_adapter_v0.test: FAIL");
  console.error(error);
  process.exit(1);
}

