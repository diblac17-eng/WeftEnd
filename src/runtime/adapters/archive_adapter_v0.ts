/* src/runtime/adapters/archive_adapter_v0.ts */
// Archive adapter summary lane: deterministic, bounded zip normalization metadata.

import { captureTreeV0 } from "../examiner/capture_tree_v0";
import { stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";
import { canonicalJSON } from "../../core/canon";
import { computeArtifactDigestV0 } from "../store/artifact_store";

declare const require: any;
declare const process: any;

const path = require("path");

export interface ArchiveAdapterOptionsV0 {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxPathBytes: number;
}

export interface ArchiveAdapterSummaryV0 {
  schema: "weftend.archiveAdapterSummary/0";
  schemaVersion: 0;
  adapterId: "archive_v0";
  sourceFormat: "zip";
  captureDigest: string;
  rootDigest: string;
  entryCount: number;
  totalBytesBounded: number;
  truncated: boolean;
  markers: string[];
}

const defaults: ArchiveAdapterOptionsV0 = {
  maxEntries: 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxFileBytes: 256 * 1024,
  maxPathBytes: 256,
};

export const summarizeArchiveAdapterV0 = (
  inputPath: string,
  opts?: Partial<ArchiveAdapterOptionsV0>
): { ok: true; value: ArchiveAdapterSummaryV0 } | { ok: false; code: string } => {
  const resolved = path.resolve(process.cwd(), inputPath || "");
  if (!inputPath || path.extname(resolved).toLowerCase() !== ".zip") {
    return { ok: false, code: "ARCHIVE_INPUT_UNSUPPORTED" };
  }
  const limits: ArchiveAdapterOptionsV0 = {
    maxEntries: Number(opts?.maxEntries ?? defaults.maxEntries),
    maxTotalBytes: Number(opts?.maxTotalBytes ?? defaults.maxTotalBytes),
    maxFileBytes: Number(opts?.maxFileBytes ?? defaults.maxFileBytes),
    maxPathBytes: Number(opts?.maxPathBytes ?? defaults.maxPathBytes),
  };
  const capture = captureTreeV0(resolved, {
    maxFiles: limits.maxEntries > 0 ? limits.maxEntries : 1,
    maxTotalBytes: limits.maxTotalBytes,
    maxFileBytes: limits.maxFileBytes,
    maxPathBytes: limits.maxPathBytes,
  });
  if (capture.kind !== "zip") {
    return { ok: false, code: "ARCHIVE_INPUT_UNSUPPORTED" };
  }
  const forcedTruncation = limits.maxEntries < 1;
  const entryCount = forcedTruncation ? 0 : capture.fileCount;
  const totalBytesBounded = forcedTruncation ? 0 : capture.totalBytes;
  const markers = stableSortUniqueStringsV0([
    ...(capture.truncated || forcedTruncation ? ["ARCHIVE_ENTRIES_TRUNCATED"] : []),
    ...(capture.issues ?? []),
  ]);
  const summary: ArchiveAdapterSummaryV0 = {
    schema: "weftend.archiveAdapterSummary/0",
    schemaVersion: 0,
    adapterId: "archive_v0",
    sourceFormat: "zip",
    captureDigest: capture.captureDigest,
    rootDigest: capture.rootDigest,
    entryCount,
    totalBytesBounded,
    truncated: capture.truncated || forcedTruncation,
    markers,
  };
  return { ok: true, value: summary };
};

export const computeArchiveAdapterDigestV0 = (summary: ArchiveAdapterSummaryV0): string =>
  computeArtifactDigestV0(canonicalJSON(summary));
