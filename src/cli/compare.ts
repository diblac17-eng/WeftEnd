/* src/cli/compare.ts */
// Deterministic compare lane for receipt roots.

import { canonicalJSON } from "../core/canon";
import type { CompareChangeV0, CompareReceiptV0, WeftendBuildV0 } from "../core/types";
import { computeCompareReceiptDigestV0, validateCompareReceiptV0 } from "../core/validate";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { formatBuildDigestSummaryV0, computeWeftendBuildV0 } from "../runtime/weftend_build";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { writeReceiptReadmeV0 } from "../runtime/receipt_readme";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../runtime/operator_receipt";
import { loadCompareSourceV0 } from "./compare_loader";
import { normalizeCompareSourceV0 } from "./compare_normalize";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const MAX_DIFF_ITEMS = 50;
const COMPARE_RECEIPT_NAME = "compare_receipt.json";
const COMPARE_REPORT_NAME = "compare_report.txt";

const dedupeSort = (values: string[]): string[] =>
  stableSortUniqueStringsV0(values.filter((v) => typeof v === "string" && v.length > 0));

const boundedValues = (values: string[], maxItems: number = MAX_DIFF_ITEMS): string[] => {
  if (values.length <= maxItems) return values;
  const kept = values.slice(0, maxItems);
  kept.push(`ZZZ_TRUNCATED(+${values.length - maxItems})`);
  return kept;
};

const normalizeList = (values: string[]): string[] => boundedValues(dedupeSort(values));

const setDiff = (left: string[], right: string[]) => {
  const lset = new Set(left);
  const rset = new Set(right);
  const added = right.filter((v) => !lset.has(v));
  const removed = left.filter((v) => !rset.has(v));
  return { added, removed };
};

const num = (value: number | undefined): number => (typeof value === "number" ? value : -1);

const bool = (value: boolean | undefined): number => (value === true ? 1 : value === false ? 0 : -1);

const recordDiff = (left: Record<string, number> | undefined, right: Record<string, number> | undefined) => {
  const keys = Array.from(
    new Set([...(left ? Object.keys(left) : []), ...(right ? Object.keys(right) : [])])
  ).sort();
  let changed = false;
  const counts: Record<string, number> = {};
  keys.forEach((key) => {
    const l = left && typeof left[key] === "number" ? left[key] : 0;
    const r = right && typeof right[key] === "number" ? right[key] : 0;
    if (l !== r) changed = true;
    counts[key] = r - l;
  });
  return { changed, counts };
};

const pushChange = (changes: CompareChangeV0[], bucket: string, added: string[], removed: string[], counts?: Record<string, number>) => {
  const entry: CompareChangeV0 = {
    bucket,
    added: normalizeList(added),
    removed: normalizeList(removed),
    ...(counts ? { counts } : {}),
  };
  changes.push(entry);
};

export interface CompareOutcomeV0 {
  verdict: "SAME" | "CHANGED";
  changeBuckets: string[];
  changes: CompareChangeV0[];
}

export const compareSummariesV0 = (
  left: ReturnType<typeof normalizeCompareSourceV0>["summary"],
  right: ReturnType<typeof normalizeCompareSourceV0>["summary"]
): CompareOutcomeV0 => {
  const changes: CompareChangeV0[] = [];
  const buckets: string[] = [];

  if (left.result !== right.result) {
    buckets.push("VERDICT_CHANGED");
    pushChange(changes, "VERDICT_CHANGED", [right.result], [left.result]);
  }

  const leftExit = typeof left.exitCode === "number" ? left.exitCode : undefined;
  const rightExit = typeof right.exitCode === "number" ? right.exitCode : undefined;
  if ((leftExit ?? -1) !== (rightExit ?? -1)) {
    buckets.push("EXITCODE_CHANGED");
    const counts = leftExit !== undefined && rightExit !== undefined ? { left: leftExit, right: rightExit } : undefined;
    pushChange(changes, "EXITCODE_CHANGED", [], [], counts);
  }

  const reasonDiff = setDiff(left.reasonCodes ?? [], right.reasonCodes ?? []);
  if (reasonDiff.added.length > 0 || reasonDiff.removed.length > 0) {
    buckets.push("REASONS_CHANGED");
    pushChange(changes, "REASONS_CHANGED", reasonDiff.added, reasonDiff.removed, {
      left: (left.reasonCodes ?? []).length,
      right: (right.reasonCodes ?? []).length,
    });
  }

  if ((left.artifactDigest ?? "UNKNOWN") !== (right.artifactDigest ?? "UNKNOWN")) {
    buckets.push("DIGEST_CHANGED");
    pushChange(changes, "DIGEST_CHANGED", [right.artifactDigest ?? "UNKNOWN"], [left.artifactDigest ?? "UNKNOWN"]);
  }

  if ((left.policyDigest ?? "POLICY_UNKNOWN") !== (right.policyDigest ?? "POLICY_UNKNOWN")) {
    buckets.push("POLICY_CHANGED");
    pushChange(changes, "POLICY_CHANGED", [right.policyDigest ?? "POLICY_UNKNOWN"], [left.policyDigest ?? "POLICY_UNKNOWN"]);
  }

  const leftExt = typeof left.externalRefCount === "number" ? left.externalRefCount : undefined;
  const rightExt = typeof right.externalRefCount === "number" ? right.externalRefCount : undefined;
  const leftDom = typeof left.uniqueDomainCount === "number" ? left.uniqueDomainCount : undefined;
  const rightDom = typeof right.uniqueDomainCount === "number" ? right.uniqueDomainCount : undefined;
  if ((leftExt ?? -1) !== (rightExt ?? -1) || (leftDom ?? -1) !== (rightDom ?? -1)) {
    buckets.push("EXTERNALREFS_CHANGED");
    const counts =
      leftExt !== undefined && rightExt !== undefined && leftDom !== undefined && rightDom !== undefined
        ? {
            leftExternalRefs: leftExt,
            rightExternalRefs: rightExt,
            leftDomains: leftDom,
            rightDomains: rightDom,
          }
        : undefined;
    pushChange(changes, "EXTERNALREFS_CHANGED", [], [], counts);
  }

  if (
    (left.targetKind ?? "UNKNOWN") !== (right.targetKind ?? "UNKNOWN") ||
    (left.artifactKind ?? "unknown") !== (right.artifactKind ?? "unknown")
  ) {
    buckets.push("KIND_PROFILE_CHANGED");
    pushChange(
      changes,
      "KIND_PROFILE_CHANGED",
      [`target=${right.targetKind ?? "UNKNOWN"}`, `artifact=${right.artifactKind ?? "unknown"}`],
      [`target=${left.targetKind ?? "UNKNOWN"}`, `artifact=${left.artifactKind ?? "unknown"}`]
    );
  }

  const fileCountDelta = recordDiff(left.fileCountsByKind, right.fileCountsByKind);
  const fileCountCounts: Record<string, number> = {};
  const hasFileCounts = Boolean(left.fileCountsByKind) && Boolean(right.fileCountsByKind);
  if (hasFileCounts) {
    const fileKeys = Array.from(
      new Set([
        ...(left.fileCountsByKind ? Object.keys(left.fileCountsByKind) : []),
        ...(right.fileCountsByKind ? Object.keys(right.fileCountsByKind) : []),
      ])
    ).sort();
    fileKeys.forEach((key) => {
      const l = left.fileCountsByKind && typeof left.fileCountsByKind[key] === "number" ? left.fileCountsByKind[key] : 0;
      const r = right.fileCountsByKind && typeof right.fileCountsByKind[key] === "number" ? right.fileCountsByKind[key] : 0;
      fileCountCounts[`left_${key}`] = l;
      fileCountCounts[`right_${key}`] = r;
    });
  }
  const hasTotals = typeof left.totalFiles === "number" && typeof right.totalFiles === "number"
    && typeof left.totalBytesBounded === "number" && typeof right.totalBytesBounded === "number";
  if (
    num(left.totalFiles) !== num(right.totalFiles) ||
    num(left.totalBytesBounded) !== num(right.totalBytesBounded) ||
    fileCountDelta.changed
  ) {
    buckets.push("CONTENT_CHANGED");
    const counts = hasTotals
      ? {
          leftFiles: left.totalFiles ?? 0,
          rightFiles: right.totalFiles ?? 0,
          leftBytes: left.totalBytesBounded ?? 0,
          rightBytes: right.totalBytesBounded ?? 0,
          ...(hasFileCounts ? fileCountCounts : {}),
        }
      : undefined;
    pushChange(changes, "CONTENT_CHANGED", [], [], counts);
  }

  if (bool(left.hasScripts) !== bool(right.hasScripts)) {
    buckets.push("SCRIPT_SURFACE_CHANGED");
    pushChange(
      changes,
      "SCRIPT_SURFACE_CHANGED",
      [`hasScripts=${right.hasScripts ?? "unknown"}`],
      [`hasScripts=${left.hasScripts ?? "unknown"}`]
    );
  }

  if (bool(left.hasNativeBinaries) !== bool(right.hasNativeBinaries)) {
    buckets.push("NATIVE_BINARY_APPEARED");
    pushChange(
      changes,
      "NATIVE_BINARY_APPEARED",
      [`hasNativeBinaries=${right.hasNativeBinaries ?? "unknown"}`],
      [`hasNativeBinaries=${left.hasNativeBinaries ?? "unknown"}`]
    );
  }

  const leftUrl = typeof left.urlLikeCount === "number" ? left.urlLikeCount : undefined;
  const rightUrl = typeof right.urlLikeCount === "number" ? right.urlLikeCount : undefined;
  if ((leftUrl ?? -1) !== (rightUrl ?? -1)) {
    buckets.push("URL_INDICATORS_CHANGED");
    const counts = leftUrl !== undefined && rightUrl !== undefined ? { leftUrlLike: leftUrl, rightUrlLike: rightUrl } : undefined;
    pushChange(changes, "URL_INDICATORS_CHANGED", [], [], counts);
  }

  if (
    (left.signaturePresent ?? "unknown") !== (right.signaturePresent ?? "unknown") ||
    (left.timestampPresent ?? "unknown") !== (right.timestampPresent ?? "unknown")
  ) {
    buckets.push("SIGNATURE_STATUS_CHANGED");
    pushChange(
      changes,
      "SIGNATURE_STATUS_CHANGED",
      [
        `signature=${right.signaturePresent ?? "unknown"}`,
        `timestamp=${right.timestampPresent ?? "unknown"}`,
      ],
      [
        `signature=${left.signaturePresent ?? "unknown"}`,
        `timestamp=${left.timestampPresent ?? "unknown"}`,
      ]
    );
  }

  const leftDepth = typeof left.archiveDepthMax === "number" ? left.archiveDepthMax : undefined;
  const rightDepth = typeof right.archiveDepthMax === "number" ? right.archiveDepthMax : undefined;
  const leftNested = typeof left.nestedArchiveCount === "number" ? left.nestedArchiveCount : undefined;
  const rightNested = typeof right.nestedArchiveCount === "number" ? right.nestedArchiveCount : undefined;
  if ((leftDepth ?? -1) !== (rightDepth ?? -1) || (leftNested ?? -1) !== (rightNested ?? -1)) {
    buckets.push("ARCHIVE_DEPTH_CHANGED");
    const counts =
      leftDepth !== undefined && rightDepth !== undefined && leftNested !== undefined && rightNested !== undefined
        ? {
            leftDepth,
            rightDepth,
            leftNested,
            rightNested,
          }
        : undefined;
    pushChange(changes, "ARCHIVE_DEPTH_CHANGED", [], [], counts);
  }

  const boundsDiff = setDiff(left.boundednessMarkers ?? [], right.boundednessMarkers ?? []);
  if (boundsDiff.added.length > 0 || boundsDiff.removed.length > 0) {
    buckets.push("BOUNDS_CHANGED");
    pushChange(changes, "BOUNDS_CHANGED", boundsDiff.added, boundsDiff.removed);
  }

  const deniedDiff = setDiff(left.deniedCapCodes ?? [], right.deniedCapCodes ?? []);
  const leftReq = typeof left.capsRequested === "number" ? left.capsRequested : undefined;
  const rightReq = typeof right.capsRequested === "number" ? right.capsRequested : undefined;
  const leftDen = typeof left.capsDenied === "number" ? left.capsDenied : undefined;
  const rightDen = typeof right.capsDenied === "number" ? right.capsDenied : undefined;
  if ((leftReq ?? -1) !== (rightReq ?? -1) || (leftDen ?? -1) !== (rightDen ?? -1) || deniedDiff.added.length > 0 || deniedDiff.removed.length > 0) {
    buckets.push("CAPS_CHANGED");
    const counts = leftReq !== undefined && rightReq !== undefined && leftDen !== undefined && rightDen !== undefined
      ? {
          leftRequested: leftReq,
          rightRequested: rightReq,
          leftDenied: leftDen,
          rightDenied: rightDen,
        }
      : undefined;
    pushChange(changes, "CAPS_CHANGED", deniedDiff.added, deniedDiff.removed, counts);
  }

  if (
    (left.hostReleaseStatus ?? "UNKNOWN") !== (right.hostReleaseStatus ?? "UNKNOWN") ||
    (left.strictVerify ?? "UNKNOWN") !== (right.strictVerify ?? "UNKNOWN") ||
    (left.strictExecute ?? "UNKNOWN") !== (right.strictExecute ?? "UNKNOWN")
  ) {
    buckets.push("HOST_TRUTH_CHANGED");
    pushChange(
      changes,
      "HOST_TRUTH_CHANGED",
      [
        `releaseStatus=${right.hostReleaseStatus ?? "UNKNOWN"}`,
        `strictVerify=${right.strictVerify ?? "UNKNOWN"}`,
        `strictExecute=${right.strictExecute ?? "UNKNOWN"}`,
      ],
      [
        `releaseStatus=${left.hostReleaseStatus ?? "UNKNOWN"}`,
        `strictVerify=${left.strictVerify ?? "UNKNOWN"}`,
        `strictExecute=${left.strictExecute ?? "UNKNOWN"}`,
      ]
    );
  }

  const sortedBuckets = dedupeSort(buckets);
  const sortedChanges = changes
    .slice()
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((entry) => ({
      bucket: entry.bucket,
      added: entry.added,
      removed: entry.removed,
      ...(entry.counts ? { counts: Object.keys(entry.counts).sort().reduce((acc, key) => ({ ...acc, [key]: entry.counts![key] }), {}) } : {}),
    }));

  return {
    verdict: sortedBuckets.length === 0 ? "SAME" : "CHANGED",
    changeBuckets: sortedBuckets,
    changes: sortedChanges,
  };
};

export const renderCompareReportV0 = (input: {
  verdict: "SAME" | "CHANGED";
  changeBuckets: string[];
  leftSummary: ReturnType<typeof normalizeCompareSourceV0>["summary"];
  rightSummary: ReturnType<typeof normalizeCompareSourceV0>["summary"];
  changes: CompareChangeV0[];
}): string => {
  const lines: string[] = [];
  lines.push("WEFTEND COMPARE");
  lines.push(`verdict=${input.verdict}`);
  lines.push(`buckets=${input.changeBuckets.length} (${input.changeBuckets.join(",") || "-"})`);
  lines.push("");
  lines.push(`artifactDigest=${input.leftSummary.artifactDigest ?? "UNKNOWN"} -> ${input.rightSummary.artifactDigest ?? "UNKNOWN"}`);
  lines.push(`result=${input.leftSummary.result} -> ${input.rightSummary.result}`);
  lines.push(`policy=${input.leftSummary.policyDigest ?? "POLICY_UNKNOWN"} -> ${input.rightSummary.policyDigest ?? "POLICY_UNKNOWN"}`);
  lines.push(
    `kindProfile=${input.leftSummary.targetKind ?? "UNKNOWN"}:${input.leftSummary.artifactKind ?? "unknown"} -> ${input.rightSummary.targetKind ?? "UNKNOWN"}:${input.rightSummary.artifactKind ?? "unknown"}`
  );
  lines.push(
    `contentFiles=${input.leftSummary.totalFiles ?? -1}->${input.rightSummary.totalFiles ?? -1} bytes=${input.leftSummary.totalBytesBounded ?? -1}->${input.rightSummary.totalBytesBounded ?? -1}`
  );
  lines.push(
    `contentFlags=scripts:${input.leftSummary.hasScripts ?? "?"}->${input.rightSummary.hasScripts ?? "?"} native:${input.leftSummary.hasNativeBinaries ?? "?"}->${input.rightSummary.hasNativeBinaries ?? "?"} html:${input.leftSummary.hasHtml ?? "?"}->${input.rightSummary.hasHtml ?? "?"}`
  );
  lines.push(
    `hostTruth=release:${input.leftSummary.hostReleaseStatus ?? "UNKNOWN"}->${input.rightSummary.hostReleaseStatus ?? "UNKNOWN"} verify:${input.leftSummary.strictVerify ?? "UNKNOWN"}->${input.rightSummary.strictVerify ?? "UNKNOWN"} execute:${input.leftSummary.strictExecute ?? "UNKNOWN"}->${input.rightSummary.strictExecute ?? "UNKNOWN"}`
  );
  lines.push("");
  lines.push(`reasonCodes.left=${(input.leftSummary.reasonCodes ?? []).length}`);
  lines.push(`reasonCodes.right=${(input.rightSummary.reasonCodes ?? []).length}`);
  const reasonChange = input.changes.find((c) => c.bucket === "REASONS_CHANGED");
  if (reasonChange) {
    lines.push(`reasonCodes.added=${reasonChange.added.length}`);
    reasonChange.added.forEach((code) => lines.push(`+ ${code}`));
    lines.push(`reasonCodes.removed=${reasonChange.removed.length}`);
    reasonChange.removed.forEach((code) => lines.push(`- ${code}`));
  } else {
    lines.push("reasonCodes.added=0");
    lines.push("reasonCodes.removed=0");
  }
  lines.push("");
  lines.push(`externalRefs=${input.leftSummary.externalRefCount ?? -1}->${input.rightSummary.externalRefCount ?? -1}`);
  lines.push(`domains=${input.leftSummary.uniqueDomainCount ?? -1}->${input.rightSummary.uniqueDomainCount ?? -1}`);
  const capsLeft = input.leftSummary.capsDenied === undefined ? "N/A" : String(input.leftSummary.capsDenied);
  const capsRight = input.rightSummary.capsDenied === undefined ? "N/A" : String(input.rightSummary.capsDenied);
  lines.push(`capsDenied=${capsLeft}->${capsRight}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const writeText = (filePath: string, text: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
};

const buildCompareReceipt = (input: {
  weftendBuild: WeftendBuildV0;
  left: { summaryDigest: string; receiptKinds: string[] };
  right: { summaryDigest: string; receiptKinds: string[] };
  verdict: "SAME" | "CHANGED";
  changeBuckets: string[];
  changes: CompareChangeV0[];
  privacyLint: "PASS" | "FAIL";
  reasonCodes: string[];
}): CompareReceiptV0 => {
  const receipt: CompareReceiptV0 = {
    schema: "weftend.compareReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild: input.weftendBuild,
    kind: "CompareReceiptV0",
    left: {
      summaryDigest: input.left.summaryDigest,
      receiptKinds: dedupeSort(input.left.receiptKinds),
    },
    right: {
      summaryDigest: input.right.summaryDigest,
      receiptKinds: dedupeSort(input.right.receiptKinds),
    },
    verdict: input.verdict,
    changeBuckets: dedupeSort(input.changeBuckets),
    changes: input.changes
      .slice()
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((entry) => ({
        bucket: entry.bucket,
        added: entry.added,
        removed: entry.removed,
        ...(entry.counts ? { counts: entry.counts } : {}),
      })),
    privacyLint: input.privacyLint,
    reasonCodes: dedupeSort(input.reasonCodes),
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeCompareReceiptDigestV0(receipt);
  return receipt;
};

export interface RunCompareCliOptionsV0 {
  leftRoot: string;
  rightRoot: string;
  outRoot: string;
}

export const runCompareCliV0 = (options: RunCompareCliOptionsV0): number => {
  if (!options.outRoot) {
    console.error("[OUT_REQUIRED] compare requires --out <dir>.");
    return 40;
  }
  const leftLoaded = loadCompareSourceV0(options.leftRoot, "left");
  if (!leftLoaded.ok) {
    console.error(`[${leftLoaded.error.code}] ${leftLoaded.error.message}`);
    return 40;
  }
  const rightLoaded = loadCompareSourceV0(options.rightRoot, "right");
  if (!rightLoaded.ok) {
    console.error(`[${rightLoaded.error.code}] ${rightLoaded.error.message}`);
    return 40;
  }

  const leftNorm = normalizeCompareSourceV0(leftLoaded.value);
  const rightNorm = normalizeCompareSourceV0(rightLoaded.value);
  const compared = compareSummariesV0(leftNorm.summary, rightNorm.summary);

  const outRoot = path.resolve(process.cwd(), options.outRoot);
  const build = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;

  let receipt = buildCompareReceipt({
    weftendBuild: build,
    left: { summaryDigest: leftNorm.summaryDigest, receiptKinds: leftLoaded.value.receiptKinds },
    right: { summaryDigest: rightNorm.summaryDigest, receiptKinds: rightLoaded.value.receiptKinds },
    verdict: compared.verdict,
    changeBuckets: compared.changeBuckets,
    changes: compared.changes,
    privacyLint: "PASS",
    reasonCodes: [],
  });

  const reportText = renderCompareReportV0({
    verdict: compared.verdict,
    changeBuckets: compared.changeBuckets,
    leftSummary: leftNorm.summary,
    rightSummary: rightNorm.summary,
    changes: compared.changes,
  });

  const receiptIssues = validateCompareReceiptV0(receipt, "compareReceipt");
  if (receiptIssues.length > 0) {
    console.error("[COMPARE_RECEIPT_INVALID]");
    receiptIssues.forEach((i) => console.error(`${i.code}:${i.message}`));
    return 1;
  }

  writeText(path.join(outRoot, COMPARE_RECEIPT_NAME), `${canonicalJSON(receipt)}\n`);
  writeText(path.join(outRoot, COMPARE_REPORT_NAME), reportText);
  writeReceiptReadmeV0(outRoot, receipt.weftendBuild, receipt.schemaVersion);

  let operator = buildOperatorReceiptV0({
    command: "compare",
    weftendBuild: receipt.weftendBuild,
    schemaVersion: receipt.schemaVersion,
    entries: [{ kind: "compare_receipt", relPath: COMPARE_RECEIPT_NAME, digest: receipt.receiptDigest }],
    warnings: [...(receipt.weftendBuild.reasonCodes ?? [])],
  });
  writeOperatorReceiptV0(outRoot, operator);

  let privacy = runPrivacyLintV0({ root: outRoot, weftendBuild: receipt.weftendBuild });
  if (privacy.report.verdict === "FAIL") {
    receipt = buildCompareReceipt({
      weftendBuild: receipt.weftendBuild,
      left: receipt.left,
      right: receipt.right,
      verdict: receipt.verdict,
      changeBuckets: receipt.changeBuckets,
      changes: receipt.changes,
      privacyLint: "FAIL",
      reasonCodes: ["COMPARE_PRIVACY_LINT_FAIL"],
    });
    writeText(path.join(outRoot, COMPARE_RECEIPT_NAME), `${canonicalJSON(receipt)}\n`);
    operator = buildOperatorReceiptV0({
      command: "compare",
      weftendBuild: receipt.weftendBuild,
      schemaVersion: receipt.schemaVersion,
      entries: [{ kind: "compare_receipt", relPath: COMPARE_RECEIPT_NAME, digest: receipt.receiptDigest }],
      warnings: [...(receipt.weftendBuild.reasonCodes ?? []), ...receipt.reasonCodes],
    });
    writeOperatorReceiptV0(outRoot, operator);
    privacy = runPrivacyLintV0({ root: outRoot, weftendBuild: receipt.weftendBuild });
  }

  const summary = `COMPARE ${receipt.verdict} ${formatBuildDigestSummaryV0(receipt.weftendBuild)} privacyLint=${privacy.report.verdict} changes=${receipt.changeBuckets.length}`;
  console.log(summary);
  if (privacy.report.verdict !== "PASS") {
    console.error("[COMPARE_PRIVACY_LINT_FAIL] compare output failed privacy lint.");
    return 40;
  }
  return 0;
};
