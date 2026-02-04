// src/runtime/classify/artifact_kind_v0.ts
// Deterministic artifact kind classification for safe-run UX.

import type { ArtifactKindV0 } from "../../core/types";
import type { CaptureTreeV0 } from "../examiner/capture_tree_v0";
import { stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

export interface ArtifactKindResultV0 {
  artifactKind: ArtifactKindV0;
  entryHint: string | null;
  reasonCodes: string[];
}

const textExts = new Set([
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".csv",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".log",
]);

const toHint = (value: string | null): string | null => {
  if (!value) return null;
  const base = path.basename(value);
  if (!base || base.length > 128) return null;
  if (base.includes("/") || base.includes("\\")) return null;
  const normalized = base.replace(/\s+/g, "_");
  if (!normalized || normalized.length > 128) return null;
  return normalized;
};

const fileKindByExt = (inputPath: string): ArtifactKindResultV0 | null => {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".zip") return { artifactKind: "ZIP", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_ZIP_INPUT"] };
  if (ext === ".exe" || ext === ".dll" || ext === ".sys" || ext === ".drv") {
    return { artifactKind: "NATIVE_EXE", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_NATIVE_BINARY"] };
  }
  if (ext === ".msi") return { artifactKind: "NATIVE_MSI", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_NATIVE_BINARY"] };
  if (ext === ".lnk") return { artifactKind: "SHORTCUT_LNK", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_LNK_UNSUPPORTED"] };
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { artifactKind: "SCRIPT_JS", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_SCRIPT_DETECTED"] };
  if (ext === ".ps1") return { artifactKind: "SCRIPT_PS1", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_SCRIPT_DETECTED"] };
  if (ext === ".html" || ext === ".htm") return { artifactKind: "WEB_DIR", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_WEB_ENTRY_DETECTED"] };
  if (textExts.has(ext)) return { artifactKind: "TEXT", entryHint: toHint(path.basename(inputPath)), reasonCodes: ["ARTIFACT_TEXT_DETECTED"] };
  return null;
};

const fromDir = (inputPath: string, capture?: CaptureTreeV0): ArtifactKindResultV0 => {
  const manifestPath = path.join(inputPath, "release_manifest.json");
  const bundlePath = path.join(inputPath, "runtime_bundle.json");
  if (fs.existsSync(manifestPath) && fs.existsSync(bundlePath)) {
    return {
      artifactKind: "RELEASE_DIR",
      entryHint: "release_manifest.json",
      reasonCodes: ["ARTIFACT_RELEASE_DETECTED"],
    };
  }

  const htmlEntries = (capture?.entries ?? [])
    .map((entry) => entry.path)
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return ext === ".html" || ext === ".htm";
    })
    .sort((a, b) => a.localeCompare(b));
  if (htmlEntries.length > 0) {
    return {
      artifactKind: "WEB_DIR",
      entryHint: toHint(htmlEntries[0]),
      reasonCodes: ["ARTIFACT_WEB_ENTRY_DETECTED"],
    };
  }

  return {
    artifactKind: "UNKNOWN",
    entryHint: null,
    reasonCodes: ["ARTIFACT_UNKNOWN_KIND"],
  };
};

export const classifyArtifactKindV0 = (inputPath: string, capture?: CaptureTreeV0): ArtifactKindResultV0 => {
  const normalized = path.resolve(process.cwd(), inputPath || "");
  if (!inputPath || !fs.existsSync(normalized)) {
    return { artifactKind: "UNKNOWN", entryHint: null, reasonCodes: ["ARTIFACT_UNKNOWN_KIND"] };
  }

  try {
    const stat = fs.lstatSync(normalized);
    if (stat.isDirectory()) {
      const dirResult = fromDir(normalized, capture);
      return { ...dirResult, reasonCodes: stableSortUniqueReasonsV0(dirResult.reasonCodes) };
    }
    if (stat.isFile()) {
      const fileKind = fileKindByExt(normalized);
      if (fileKind) return { ...fileKind, reasonCodes: stableSortUniqueReasonsV0(fileKind.reasonCodes) };
      return { artifactKind: "UNKNOWN", entryHint: toHint(path.basename(normalized)), reasonCodes: ["ARTIFACT_UNKNOWN_KIND"] };
    }
  } catch {
    return { artifactKind: "UNKNOWN", entryHint: null, reasonCodes: ["ARTIFACT_UNKNOWN_KIND"] };
  }

  return { artifactKind: "UNKNOWN", entryHint: null, reasonCodes: ["ARTIFACT_UNKNOWN_KIND"] };
};
