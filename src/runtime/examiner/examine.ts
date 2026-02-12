// src/runtime/examiner/examine.ts
// Mint package builder for v1 examiner flow.

import { canonicalJSON } from "../../core/canon";
import { sha256HexV0 } from "../../core/hash_v0";
import { computeMintDigestV1, normalizeMintPackageV1 } from "../../core/mint_digest";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";
import type {
  MintGradeStatusV1,
  MintLimitsV1,
  MintProfileV1,
  MintProbeResultV1,
  MintReceiptV1,
  WeftendMintPackageV1,
} from "../../core/types";
import { captureTreeV0, CaptureLimitsV0, CaptureTreeV0 } from "./capture_tree_v0";
import { detectLayersV0 } from "./detect_layers_v0";
import { parseProbeScriptV0, ProbeScriptLimitsV0 } from "./probe_script_v0";
import { runStrictProbeV0 } from "./probe_strict_v0";

export interface ExamineOptionsV1 {
  profile: MintProfileV1;
  scriptText?: string;
  limits?: Partial<MintLimitsV1>;
  scriptTimeoutMs?: number;
}

export interface ExamineResultV1 {
  mint: WeftendMintPackageV1;
  report: string;
  capture: CaptureTreeV0;
}

const sha256 = (input: string): string => sha256HexV0(input);

const defaultLimits: MintLimitsV1 = {
  maxFiles: 20000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxExternalRefs: 1000,
  maxScriptBytes: 2048,
  maxScriptSteps: 50,
};

const computeReceiptDigest = (payload: unknown): string =>
  `sha256:${sha256(canonicalJSON(payload))}`;

const summarizeProbe = (probe: MintProbeResultV1, kind: string): MintReceiptV1 => {
  const denied = Object.values(probe.deniedCaps ?? {}).reduce((a, b) => a + b, 0);
  const attempted = Object.values(probe.attemptedCaps ?? {}).reduce((a, b) => a + b, 0);
  return {
    kind,
    digest: computeReceiptDigest(probe),
    summaryCounts: { denied, attempted },
    reasonCodes: probe.reasonCodes ?? [],
  };
};

const severityFromReasons = (reasons: string[]): MintGradeStatusV1 => {
  const fatalPrefixes = ["CAPTURE_INPUT_", "ZIP_EOCD_MISSING", "ZIP_CD_CORRUPT"];
  const hasFatal = reasons.some((code) => fatalPrefixes.some((p) => code.startsWith(p) || code === p));
  if (hasFatal) return "DENY";
  return reasons.length > 0 ? "WARN" : "OK";
};

export const examineArtifactV1 = (inputPath: string, opts: ExamineOptionsV1): ExamineResultV1 => {
  const limits: MintLimitsV1 = { ...defaultLimits, ...(opts.limits ?? {}) };
  const captureLimits: CaptureLimitsV0 = {
    maxFiles: limits.maxFiles,
    maxTotalBytes: limits.maxTotalBytes,
    maxFileBytes: limits.maxFileBytes,
    maxPathBytes: 256,
  };

  const capture = captureTreeV0(inputPath, captureLimits);
  const detect = detectLayersV0(capture, {
    maxFileBytes: limits.maxFileBytes,
    maxExternalRefs: limits.maxExternalRefs,
  });

  let loadProbe = runStrictProbeV0(detect.htmlEntryText, {
    maxScriptBytes: limits.maxScriptBytes,
    scriptTimeoutMs: opts.scriptTimeoutMs,
  });
  if (!loadProbe.strictAvailable && opts.profile !== "web") {
    loadProbe = {
      strictAvailable: false,
      strictUnavailableReason: "PROBE_NOT_APPLICABLE",
      probe: { status: "OK", reasonCodes: [], deniedCaps: {}, attemptedCaps: {} },
    };
  }

  let scriptProbe: MintProbeResultV1 | undefined;
  const scriptIssues: string[] = [];
  if (opts.scriptText && opts.scriptText.trim().length > 0) {
    const parsed = parseProbeScriptV0(opts.scriptText, {
      maxBytes: limits.maxScriptBytes,
      maxSteps: limits.maxScriptSteps,
    } as ProbeScriptLimitsV0);
    scriptIssues.push(...parsed.issues);
    const probe = runStrictProbeV0(detect.htmlEntryText, {
      interactions: parsed.actions,
      maxScriptBytes: limits.maxScriptBytes,
      scriptTimeoutMs: opts.scriptTimeoutMs,
    });
    scriptProbe = {
      status: probe.probe.status,
      reasonCodes: stableSortUniqueReasonsV0([
        ...(probe.probe.reasonCodes ?? []),
        ...parsed.issues,
      ]),
      deniedCaps: probe.probe.deniedCaps,
      attemptedCaps: probe.probe.attemptedCaps,
    };
  }

  const gradeReasons = stableSortUniqueReasonsV0([
    ...capture.issues,
    ...detect.issues,
    ...(loadProbe.probe.reasonCodes ?? []),
    ...(scriptProbe?.reasonCodes ?? []),
  ]);

  const receipts: MintReceiptV1[] = [];
  receipts.push(summarizeProbe(loadProbe.probe, "probe.loadOnly.v1"));
  if (scriptProbe) receipts.push(summarizeProbe(scriptProbe, "probe.script.v1"));

  if (opts.profile === "mod") {
    const manifestNames = [
      "manifest.json",
      "mod.json",
      "plugin.json",
      "info.json",
      "pack.mcmeta",
    ];
    const manifestCount = capture.entries.filter((e) =>
      manifestNames.includes(e.path.toLowerCase().split("/").pop() || "")
    ).length;
    const dllCount = capture.entries.filter((e) => e.path.toLowerCase().endsWith(".dll")).length;
    const wasmCount = capture.entries.filter((e) => e.path.toLowerCase().endsWith(".wasm")).length;
    const assetCount = capture.entries.filter((e) =>
      /\.(png|jpg|jpeg|gif|webp|svg|mp3|wav|ogg|mp4|webm)$/i.test(e.path)
    ).length;
    receipts.push({
      kind: "mod.signals.v1",
      digest: computeReceiptDigest({ manifestCount, dllCount, wasmCount, assetCount }),
      summaryCounts: { manifestCount, dllCount, wasmCount, assetCount },
    });
  }

  const status = severityFromReasons(gradeReasons);
  const grade: WeftendMintPackageV1["grade"] = {
    status,
    reasonCodes: gradeReasons,
    receipts,
  };
  if (capture.truncated) grade.scars = ["CAPTURE_TRUNCATED"];

  const mint: WeftendMintPackageV1 = {
    schema: "weftend.mint/1",
    profile: opts.profile,
    input: {
      kind: capture.kind,
      rootDigest: capture.rootDigest,
      fileCount: capture.fileCount,
      totalBytes: capture.totalBytes,
    },
    capture: {
      captureDigest: capture.captureDigest,
      paths: stableSortUniqueStringsV0(
        capture.pathsSample.slice(0, Math.min(capture.pathsSample.length, 200))
      ),
    },
    observations: detect.observations,
    executionProbes: {
      strictAvailable: loadProbe.strictAvailable,
      ...(loadProbe.strictAvailable ? {} : { strictUnavailableReason: loadProbe.strictUnavailableReason }),
      loadOnly: loadProbe.probe,
      ...(scriptProbe ? { interactionScript: scriptProbe } : {}),
    },
    grade,
    digests: {
      mintDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      inputDigest: capture.rootDigest,
      policyDigest: "-",
    },
    limits,
  };

  mint.digests.mintDigest = computeMintDigestV1(mint);
  const normalized = normalizeMintPackageV1(mint);
  normalized.digests.mintDigest = computeMintDigestV1(normalized);

  const reportLines: string[] = [];
  const headerReason = normalized.grade.reasonCodes.join("|") || "OK";
  reportLines.push(`WeftEnd Mint v1 | profile=${opts.profile} | grade=${normalized.grade.status} | reason=${headerReason}`);
  reportLines.push(
    `Input: kind=${capture.kind} files=${capture.fileCount} bytes=${capture.totalBytes} root=${capture.rootDigest}`
  );
  reportLines.push(`Grade: ${normalized.grade.status} ${normalized.grade.reasonCodes.join("|")}`);
  reportLines.push(
    `Strict probe: ${normalized.executionProbes.strictAvailable ? "available" : "unavailable"}${
      normalized.executionProbes.strictAvailable
        ? ""
        : ` (${normalized.executionProbes.strictUnavailableReason ?? "unknown"})`
    }`
  );
  reportLines.push(
    `Denied caps: ${Object.keys(loadProbe.probe.deniedCaps).length} (load-only)`
  );
  if (scriptProbe) {
    reportLines.push(
      `Denied caps: ${Object.keys(scriptProbe.deniedCaps).length} (scripted)`
    );
  }
  reportLines.push(
    `External refs: ${normalized.observations.externalRefs.slice(0, 5).join(", ") || "none"}`
  );
  reportLines.push(`Mint digest: ${normalized.digests.mintDigest}`);
  const report = reportLines.join("\n").replace(/[^\x00-\x7F]/g, "?");

  return { mint: normalized, report, capture };
};

