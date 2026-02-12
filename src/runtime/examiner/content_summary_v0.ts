/* src/runtime/examiner/content_summary_v0.ts */
// Deterministic content summary for analysis-only receipts (v0).

import type {
  ArtifactKindV0,
  ContentSummaryV0,
  MintFileKindCountsV1,
  MintObservationsV1,
} from "../../core/types";
import type { CaptureTreeV0 } from "./capture_tree_v0";
import { stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";

declare const require: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_TOP_EXT = 12;
const MAX_TOP_DOMAINS = 10;
const MAX_SCAN_TOTAL_BYTES = 512 * 1024;
const MAX_SCAN_FILE_BYTES = 128 * 1024;
const MAX_HTML_LIKE_SCAN_BYTES = 4096;
const MAX_HTML_LIKE_FILES = 32;
const MAX_INDICATOR_COUNT = 1000;
const MAX_HASH_BYTES = 32 * 1024 * 1024;

const htmlExts = new Set([".html", ".htm"]);
const jsExts = new Set([".js", ".mjs", ".cjs", ".ts"]);
const scriptExts = new Set([".js", ".mjs", ".cjs", ".ts", ".ps1", ".vbs", ".bat", ".cmd"]);
const cssExts = new Set([".css"]);
const jsonExts = new Set([".json"]);
const wasmExts = new Set([".wasm"]);
const mediaExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".mov",
  ".webm",
]);
const binaryExts = new Set([".dll", ".exe", ".bin", ".so", ".dylib", ".sys", ".drv", ".msi"]);
const archiveExts = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".tgz"]);
const manifestNames = new Set(["manifest.json", "mod.json", "plugin.json", "info.json", "pack.mcmeta", "package.json"]);

const lower = (value: string): string => value.toLowerCase();

const countOccurrences = (text: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) >= 0) {
    count += 1;
    idx += needle.length;
  }
  return count;
};

const boundedIncrement = (value: number, delta: number): number =>
  Math.min(MAX_INDICATOR_COUNT, Math.max(0, value + delta));

const scanIndicatorsFromBuffer = (
  buf: Uint8Array,
  state: { urlLikeCount: number; ipLikeCount: number; powershellLikeCount: number; cmdExecLikeCount: number }
) => {
  let seq = "";
  const flush = () => {
    if (seq.length < 4) {
      seq = "";
      return;
    }
    const text = lower(seq);
    const urlHits = (text.match(/https?:\/\/|wss?:\/\//g) ?? []).length;
    if (urlHits > 0) state.urlLikeCount = boundedIncrement(state.urlLikeCount, urlHits);
    if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)) state.ipLikeCount = boundedIncrement(state.ipLikeCount, 1);
    if (text.includes("powershell") || text.includes("pwsh")) {
      state.powershellLikeCount = boundedIncrement(state.powershellLikeCount, 1);
    }
    const cmdTokens = ["cmd.exe", "powershell.exe", "rundll32", "regsvr32", "mshta", "wscript", "cscript"];
    let cmdHits = 0;
    cmdTokens.forEach((token) => {
      cmdHits += countOccurrences(text, token);
    });
    if (cmdHits > 0) state.cmdExecLikeCount = boundedIncrement(state.cmdExecLikeCount, cmdHits);
    seq = "";
  };

  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i];
    if (byte >= 32 && byte <= 126) {
      if (seq.length < 512) seq += String.fromCharCode(byte);
    } else {
      flush();
    }
  }
  flush();
};

const readBufferBounded = (filePath: string, maxBytes: number): Uint8Array | null => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const size = Math.max(0, Number(stat.size || 0));
    const bytes = Math.min(size, maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.allocUnsafe(bytes);
    try {
      if (bytes > 0) {
        fs.readSync(fd, buf, 0, bytes, 0);
      }
    } finally {
      fs.closeSync(fd);
    }
    return buf as Uint8Array;
  } catch {
    return null;
  }
};

const hasHtmlLikePrefix = (buf: Uint8Array): boolean => {
  try {
    const sample = lower(Buffer.from(buf).toString("utf8"));
    return sample.includes("<!doctype html") || sample.includes("<html");
  } catch {
    return false;
  }
};

const detectHtmlLikeContent = (inputPath: string, capture: CaptureTreeV0): boolean => {
  if (capture.kind === "file") {
    const ext = lower(path.extname(inputPath));
    if (htmlExts.has(ext)) return true;
    const buf = readBufferBounded(inputPath, MAX_HTML_LIKE_SCAN_BYTES);
    return buf ? hasHtmlLikePrefix(buf) : false;
  }
  if (capture.kind !== "dir") return false;
  const entries = capture.entries.slice().sort((a, b) => a.path.localeCompare(b.path));
  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= MAX_HTML_LIKE_FILES) break;
    const ext = lower(path.extname(entry.path));
    if (htmlExts.has(ext)) return true;
    if (ext.length > 0) continue;
    const absPath = path.join(capture.basePath, entry.path);
    const buf = readBufferBounded(absPath, MAX_HTML_LIKE_SCAN_BYTES);
    scanned += 1;
    if (buf && hasHtmlLikePrefix(buf)) return true;
  }
  return false;
};

const computeSha256 = (filePath: string): string | undefined => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_HASH_BYTES) return undefined;
    const data = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(data).digest("hex");
    return `sha256:${hash}`;
  } catch {
    return undefined;
  }
};

const readU16LE = (buf: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > buf.length) return 0;
  return buf[offset] | (buf[offset + 1] << 8);
};

const readU32LE = (buf: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > buf.length) return 0;
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  ) >>> 0;
};

const matchAscii = (buf: Uint8Array, offset: number, text: string): boolean => {
  if (offset < 0 || offset + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const parsePeSummary = (buf: Uint8Array): ContentSummaryV0["signingSummary"] => {
  const summary: ContentSummaryV0["signingSummary"] = {
    signaturePresent: "unknown",
    signerCountBounded: 0,
    timestampPresent: "unknown",
    importTablePresent: "unknown",
  };
  try {
    if (buf.length < 128) return summary;
    if (readU16LE(buf, 0) !== 0x5a4d) return summary;
    const peOffset = readU32LE(buf, 0x3c);
    if (peOffset <= 0 || peOffset + 4 >= buf.length) return summary;
    if (!matchAscii(buf, peOffset, "PE\u0000\u0000")) return summary;

    const coffOffset = peOffset + 4;
    const machine = readU16LE(buf, coffOffset);
    const sections = readU16LE(buf, coffOffset + 2);
    const timeStamp = readU32LE(buf, coffOffset + 4);
    summary.peMachine = `0x${machine.toString(16).padStart(4, "0")}`;
    summary.peSections = sections;
    summary.timestampPresent = timeStamp > 0 ? "yes" : "no";

    const optionalOffset = peOffset + 24;
    if (optionalOffset + 2 > buf.length) return summary;
    const magic = readU16LE(buf, optionalOffset);
    const isPE32 = magic === 0x10b;
    const isPE64 = magic === 0x20b;
    if (!isPE32 && !isPE64) return summary;
    const dataDirOffset = optionalOffset + (isPE32 ? 96 : 112);
    const countOffset = optionalOffset + (isPE32 ? 92 : 108);
    if (countOffset + 4 > buf.length) return summary;
    const dirCount = readU32LE(buf, countOffset);
    if (dirCount < 5) return summary;
    const importOffset = dataDirOffset + 8;
    const securityOffset = dataDirOffset + 4 * 8;
    if (importOffset + 8 <= buf.length) {
      const importSize = readU32LE(buf, importOffset + 4);
      summary.importTablePresent = importSize > 0 ? "yes" : "no";
      if (importSize > 0) summary.importTableSize = importSize;
    }
    if (securityOffset + 8 <= buf.length) {
      const secSize = readU32LE(buf, securityOffset + 4);
      summary.signaturePresent = secSize > 0 ? "yes" : "no";
      summary.signerCountBounded = secSize > 0 ? 1 : 0;
    }
    return summary;
  } catch {
    return summary;
  }
};

const deriveFileKindCounts = (capture: CaptureTreeV0): MintFileKindCountsV1 => {
  const counts: MintFileKindCountsV1 = {
    html: 0,
    js: 0,
    css: 0,
    json: 0,
    wasm: 0,
    media: 0,
    binary: 0,
    other: 0,
  };
  capture.entries.forEach((entry) => {
    const ext = lower(path.extname(entry.path));
    if (htmlExts.has(ext)) counts.html += 1;
    else if (jsExts.has(ext)) counts.js += 1;
    else if (cssExts.has(ext)) counts.css += 1;
    else if (jsonExts.has(ext)) counts.json += 1;
    else if (wasmExts.has(ext)) counts.wasm += 1;
    else if (mediaExts.has(ext)) counts.media += 1;
    else if (binaryExts.has(ext)) counts.binary += 1;
    else counts.other += 1;
  });
  return counts;
};

const buildTopExtensions = (capture: CaptureTreeV0): Array<{ ext: string; count: number }> => {
  const counts = new Map<string, number>();
  capture.entries.forEach((entry) => {
    const ext = lower(path.extname(entry.path));
    if (!ext) return;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => {
      const c0 = b[1] - a[1];
      if (c0 !== 0) return c0;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, MAX_TOP_EXT)
    .map(([ext, count]) => ({ ext, count }));
};

const computeArchiveDepthMax = (capture: CaptureTreeV0): number => {
  let maxDepth = 0;
  capture.entries.forEach((entry) => {
    const depth = entry.path.split("/").filter((p) => p.length > 0).length;
    if (depth > maxDepth) maxDepth = depth;
  });
  return maxDepth;
};

const computeNestedArchiveCount = (capture: CaptureTreeV0): number => {
  let count = 0;
  capture.entries.forEach((entry) => {
    const ext = lower(path.extname(entry.path));
    if (archiveExts.has(ext)) count += 1;
  });
  return count;
};

const computeManifestCount = (capture: CaptureTreeV0): number => {
  let count = 0;
  capture.entries.forEach((entry) => {
    const base = lower(path.basename(entry.path));
    if (manifestNames.has(base)) count += 1;
  });
  return count;
};

const extractTopDomains = (refs: string[] | undefined): { count: number; topDomains: string[] } => {
  const normalized = (refs ?? [])
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const domains = new Set<string>();
  normalized.forEach((ref) => {
    try {
      const host = new URL(ref).hostname.trim().toLowerCase();
      if (host) domains.add(host);
    } catch {
      // ignore non-URL refs
    }
  });
  const top = Array.from(domains.values()).sort((a, b) => a.localeCompare(b)).slice(0, MAX_TOP_DOMAINS);
  return { count: normalized.length, topDomains: top };
};

const deriveTargetKind = (capture: CaptureTreeV0, artifactKind?: ArtifactKindV0): ContentSummaryV0["targetKind"] => {
  if (artifactKind === "SHORTCUT_LNK") return "shortcut";
  if (artifactKind === "NATIVE_EXE" || artifactKind === "NATIVE_MSI") return "nativeBinary";
  if (capture.issues.includes("CAPTURE_INPUT_MISSING")) return "missing";
  if (capture.kind === "zip") return "zip";
  if (capture.kind === "dir") return "directory";
  return "file";
};

const deriveArtifactKind = (artifactKind?: ArtifactKindV0, hasHtml?: boolean): ContentSummaryV0["artifactKind"] => {
  if (artifactKind === "RELEASE_DIR") return "executable";
  if (artifactKind === "NATIVE_EXE" || artifactKind === "NATIVE_MSI") return "executable";
  if (artifactKind === "SHORTCUT_LNK") return "executable";
  if (artifactKind === "WEB_DIR" || hasHtml) return "webBundle";
  if (artifactKind === "SCRIPT_JS" || artifactKind === "SCRIPT_PS1") return "webBundle";
  if (artifactKind === "ZIP" || artifactKind === "TEXT") return "dataOnly";
  if (artifactKind === "UNKNOWN") return "unknown";
  return "dataOnly";
};

const buildEntryHints = (
  capture: CaptureTreeV0,
  hasHtml: boolean,
  hasHtmlLike: boolean,
  manifestCount: number
): string[] => {
  const hints: string[] = [];
  if (hasHtml) hints.push("ENTRY_HTML");
  if (!hasHtml && hasHtmlLike) hints.push("ENTRY_HTML_LIKE");
  if (manifestCount > 0) hints.push("ENTRY_MANIFEST");
  if (hints.length === 0) hints.push("ENTRY_NONE");
  return stableSortUniqueStringsV0(hints);
};

const buildBoundednessMarkers = (capture: CaptureTreeV0): string[] => {
  const markers = [
    ...(capture.truncated ? ["CAPTURE_TRUNCATED"] : []),
    ...(capture.issues ?? []),
  ];
  return stableSortUniqueStringsV0(markers);
};

const scanIndicators = (inputPath: string, capture: CaptureTreeV0) => {
  const indicators = {
    urlLikeCount: 0,
    ipLikeCount: 0,
    powershellLikeCount: 0,
    cmdExecLikeCount: 0,
  };
  if (capture.kind === "dir") {
    const entries = capture.entries.slice().sort((a, b) => a.path.localeCompare(b.path));
    let remaining = MAX_SCAN_TOTAL_BYTES;
    for (const entry of entries) {
      if (remaining <= 0) break;
      const absPath = path.join(capture.basePath, entry.path);
      if (entry.size <= 0) continue;
      const maxBytes = Math.min(MAX_SCAN_FILE_BYTES, remaining);
      const buf = readBufferBounded(absPath, maxBytes);
      if (!buf) continue;
      remaining -= buf.length;
      scanIndicatorsFromBuffer(buf, indicators);
      if (
        indicators.urlLikeCount >= MAX_INDICATOR_COUNT &&
        indicators.ipLikeCount >= MAX_INDICATOR_COUNT &&
        indicators.powershellLikeCount >= MAX_INDICATOR_COUNT &&
        indicators.cmdExecLikeCount >= MAX_INDICATOR_COUNT
      ) {
        break;
      }
    }
    return indicators;
  }

  const buf = readBufferBounded(inputPath, MAX_SCAN_TOTAL_BYTES);
  if (!buf) return indicators;
  scanIndicatorsFromBuffer(buf, indicators);
  return indicators;
};

export const buildContentSummaryV0 = (options: {
  inputPath: string;
  capture: CaptureTreeV0;
  observations?: MintObservationsV1;
  artifactKind?: ArtifactKindV0;
  policyMatch: { selectedPolicy: string; reasonCodes: string[] };
}): ContentSummaryV0 => {
  const fileCounts = options.observations?.fileKinds ?? deriveFileKindCounts(options.capture);
  const totalFiles = Math.max(0, options.capture.fileCount || 0);
  const totalBytes = Math.max(0, options.capture.totalBytes || 0);
  const topExtensions = buildTopExtensions(options.capture);
  const hasNativeBinaries = options.capture.entries.some((entry) => {
    const ext = lower(path.extname(entry.path));
    return [".exe", ".dll", ".msi", ".sys", ".drv"].includes(ext);
  });
  const hasScripts = options.capture.entries.some((entry) => scriptExts.has(lower(path.extname(entry.path))));
  const hasHtmlByEntries = options.capture.entries.some((entry) => htmlExts.has(lower(path.extname(entry.path))));
  const hasHtmlByCounts = typeof fileCounts.html === "number" && fileCounts.html > 0;
  const hasHtmlDirect =
    hasHtmlByEntries ||
    hasHtmlByCounts ||
    options.artifactKind === "WEB_DIR";
  const hasHtmlLike = detectHtmlLikeContent(options.inputPath, options.capture);
  const hasHtmlAny =
    hasHtmlDirect ||
    hasHtmlLike;
  const hasIndexHtml = options.capture.entries.some((entry) => {
    const ext = lower(path.extname(entry.path));
    if (!htmlExts.has(ext)) return false;
    const base = lower(path.basename(entry.path));
    return base === "index.html" || base === "index.htm";
  });
  const archiveDepthMax = computeArchiveDepthMax(options.capture);
  const nestedArchiveCount = computeNestedArchiveCount(options.capture);
  const manifestCount = computeManifestCount(options.capture);
  const indicators = scanIndicators(options.inputPath, options.capture);
  const externalRefs = extractTopDomains(options.observations?.externalRefs);
  const targetKind = deriveTargetKind(options.capture, options.artifactKind);
  const artifactKind = deriveArtifactKind(options.artifactKind, hasHtmlAny);
  const entryHints = buildEntryHints(options.capture, hasIndexHtml || hasHtmlDirect, hasHtmlLike, manifestCount);
  const boundednessMarkers = buildBoundednessMarkers(options.capture);

  let signingSummary: ContentSummaryV0["signingSummary"] | undefined;
  if (options.capture.kind === "file") {
    const ext = lower(path.extname(options.inputPath));
    if ([".exe", ".dll", ".sys", ".drv"].includes(ext)) {
      const buf = readBufferBounded(options.inputPath, MAX_SCAN_FILE_BYTES);
      if (buf) signingSummary = parsePeSummary(buf);
    } else if (ext === ".msi") {
      signingSummary = {
        signaturePresent: "unknown",
        signerCountBounded: 0,
        timestampPresent: "unknown",
        importTablePresent: "unknown",
      };
    }
  }

  const sha256 = options.capture.kind === "file" ? computeSha256(options.inputPath) : undefined;
  const summary: ContentSummaryV0 = {
    targetKind,
    artifactKind,
    fileCountsByKind: fileCounts,
    totalFiles,
    totalBytesBounded: totalBytes,
    sizeSummary: { totalBytesBounded: totalBytes, truncated: options.capture.truncated },
    topExtensions,
    hasNativeBinaries,
    hasScripts,
    hasHtml: hasHtmlAny,
    externalRefs,
    entryHints,
    boundednessMarkers,
    archiveDepthMax,
    nestedArchiveCount,
    manifestCount,
    stringsIndicators: indicators,
    policyMatch: {
      selectedPolicy: options.policyMatch.selectedPolicy,
      reasonCodes: stableSortUniqueStringsV0(options.policyMatch.reasonCodes ?? []),
    },
    hashFamily: {
      fnv1a32: options.capture.rootDigest,
      ...(sha256 ? { sha256 } : {}),
    },
  };
  if (signingSummary) summary.signingSummary = signingSummary;
  return summary;
};
