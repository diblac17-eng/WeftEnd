// src/runtime/examiner/detect_layers_v0.ts
// Deterministic file kind detection + external ref extraction (v0).

declare const require: any;
const fs = require("fs");
const path = require("path");

import type { MintFileKindCountsV1, MintObservationsV1 } from "../../core/types";
import type { CaptureTreeV0 } from "./capture_tree_v0";
import { cmpStrV0 } from "../../core/order";

export interface DetectLimitsV0 {
  maxFileBytes: number;
  maxExternalRefs: number;
}

export interface DetectLayersResultV0 {
  observations: MintObservationsV1;
  issues: string[];
  htmlEntryPath?: string;
  htmlEntryText?: string;
}

const htmlExts = new Set([".html", ".htm"]);
const jsExts = new Set([".js", ".mjs", ".cjs"]);
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
const binaryExts = new Set([".dll", ".exe", ".bin", ".so", ".dylib"]);

const isTextCandidate = (ext: string): boolean =>
  htmlExts.has(ext) || jsExts.has(ext) || cssExts.has(ext) || jsonExts.has(ext);

const extractExternalRefs = (text: string): string[] => {
  const out: string[] = [];
  const re = /\bhttps?:\/\/[^\s"'<>]+|\bwss?:\/\/[^\s"'<>]+/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text))) {
    out.push(match[0]);
  }
  return out;
};

const readTextBounded = (absPath: string, maxBytes: number): string | null => {
  const stat = fs.statSync(absPath);
  if (stat.size > maxBytes) return null;
  return fs.readFileSync(absPath, "utf8");
};

const findHtmlEntry = (entries: { path: string }[]): string | undefined => {
  const htmls = entries.filter((e) => htmlExts.has(path.extname(e.path).toLowerCase()));
  htmls.sort((a, b) => cmpStrV0(a.path, b.path));
  const preferred = htmls.find((e) => e.path.toLowerCase().endsWith("index.html"));
  return (preferred ?? htmls[0])?.path;
};

export const detectLayersV0 = (capture: CaptureTreeV0, limits: DetectLimitsV0): DetectLayersResultV0 => {
  const issues: string[] = [];
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

  const externalRefs = new Set<string>();
  let refsTruncated = false;
  let scriptsDetected = false;
  let wasmDetected = false;

  const htmlEntryPath = findHtmlEntry(capture.entries);
  let htmlEntryText: string | undefined;

  for (const entry of capture.entries) {
    const ext = path.extname(entry.path).toLowerCase();
    if (htmlExts.has(ext)) counts.html += 1;
    else if (jsExts.has(ext)) counts.js += 1;
    else if (cssExts.has(ext)) counts.css += 1;
    else if (jsonExts.has(ext)) counts.json += 1;
    else if (wasmExts.has(ext)) counts.wasm += 1;
    else if (mediaExts.has(ext)) counts.media += 1;
    else if (binaryExts.has(ext)) counts.binary += 1;
    else counts.other += 1;

    if (jsExts.has(ext)) scriptsDetected = true;
    if (wasmExts.has(ext)) wasmDetected = true;

    if (capture.kind === "zip") continue;
    if (!isTextCandidate(ext)) continue;
    if (refsTruncated) continue;

    const absPath = capture.kind === "dir" ? path.join(capture.basePath, entry.path) : capture.basePath;
    let text: string | null = null;
    try {
      text = readTextBounded(absPath, limits.maxFileBytes);
    } catch {
      issues.push("REF_SCAN_FAILED");
      continue;
    }
    if (text === null) {
      issues.push("REF_SCAN_SKIPPED_FILE_TOO_LARGE");
      continue;
    }
    if (ext === ".html" && entry.path === htmlEntryPath) {
      htmlEntryText = text;
    }
    const refs = extractExternalRefs(text);
    for (const ref of refs) {
      if (externalRefs.size >= limits.maxExternalRefs) {
        refsTruncated = true;
        issues.push("EXTERNAL_REFS_TRUNCATED");
        break;
      }
      externalRefs.add(ref);
    }
  }

  if (!htmlEntryText && capture.kind !== "zip") {
    if (htmlEntryPath) {
      try {
        const absPath =
          capture.kind === "dir" ? path.join(capture.basePath, htmlEntryPath) : capture.basePath;
        htmlEntryText = readTextBounded(absPath, limits.maxFileBytes) ?? undefined;
      } catch {
        issues.push("HTML_ENTRY_READ_FAILED");
      }
    }
  }

  if (capture.kind === "zip") {
    issues.push("ZIP_SCAN_PARTIAL");
  }

  const observations: MintObservationsV1 = {
    fileKinds: counts,
    externalRefs: Array.from(externalRefs).sort((a, b) => cmpStrV0(a, b)),
    scriptsDetected,
    wasmDetected,
  };

  return {
    observations,
    issues,
    htmlEntryPath,
    htmlEntryText,
  };
};

