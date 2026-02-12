/* src/runtime/operator_receipt.ts */
// Operator receipt (top-level summary, deterministic).

import { canonicalJSON } from "../core/canon";
import type { OperatorReceiptEntryV0, OperatorReceiptV0, WeftendBuildV0 } from "../core/types";
import { computeArtifactDigestV0 } from "./store/artifact_store";
import { computeOperatorReceiptDigestV0, validateOperatorReceiptV0 } from "../core/validate";
import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";

declare const require: any;

const fs = require("fs");
const path = require("path");

const RECEIPT_NAME = "operator_receipt.json";

const sortEntries = (entries: OperatorReceiptEntryV0[]): OperatorReceiptEntryV0[] =>
  entries
    .slice()
    .sort((a, b) => {
      const c0 = a.kind.localeCompare(b.kind);
      if (c0 !== 0) return c0;
      const c1 = a.relPath.localeCompare(b.relPath);
      if (c1 !== 0) return c1;
      return a.digest.localeCompare(b.digest);
    });

export const computeOutRootDigestV0 = (entries: OperatorReceiptEntryV0[]): string =>
  computeArtifactDigestV0(canonicalJSON({ receipts: sortEntries(entries) }));

export const buildOperatorReceiptV0 = (input: {
  command: OperatorReceiptV0["command"];
  weftendBuild: WeftendBuildV0;
  schemaVersion?: number;
  entries: OperatorReceiptEntryV0[];
  warnings?: string[];
  contentSummary?: OperatorReceiptV0["contentSummary"];
}): OperatorReceiptV0 => {
  const entries = sortEntries(input.entries);
  const warnings = stableSortUniqueReasonsV0(input.warnings ?? []);
  const outRootDigest = computeOutRootDigestV0(entries);
  const receipt: OperatorReceiptV0 = {
    schema: "weftend.operatorReceipt/0",
    v: 0,
    schemaVersion: (input.schemaVersion ?? 0) as 0,
    weftendBuild: input.weftendBuild,
    command: input.command,
    outRootDigest,
    receipts: entries,
    warnings,
    ...(input.contentSummary ? { contentSummary: input.contentSummary } : {}),
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeOperatorReceiptDigestV0(receipt);
  const issues = validateOperatorReceiptV0(receipt, "operatorReceipt");
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.code}:${i.message}`).join("|");
    throw new Error(`OPERATOR_RECEIPT_INVALID:${detail}`);
  }
  return receipt;
};

export const writeOperatorReceiptV0 = (outRoot: string, receipt: OperatorReceiptV0): string => {
  fs.mkdirSync(outRoot, { recursive: true });
  const target = path.join(outRoot, RECEIPT_NAME);
  fs.writeFileSync(target, `${canonicalJSON(receipt)}\n`, "utf8");
  return target;
};
