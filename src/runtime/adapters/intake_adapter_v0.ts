/* src/runtime/adapters/intake_adapter_v0.ts */
// Adapter interface contract for deterministic intake transforms.

import { stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";

declare const process: any;
declare const require: any;

const path = require("path");

export type AdapterKindV0 = "filesystem" | "email" | "archive" | "container" | "other";

export interface AdapterInputV0 {
  sourcePath: string;
  kindHint?: AdapterKindV0;
}

export interface NormalizedArtifactV0 {
  schema: "weftend.normalizedArtifact/0";
  schemaVersion: 0;
  adapterId: string;
  kind: AdapterKindV0;
  sourceFormat: string;
  rootDir: string;
  requiredFiles: string[];
  markers: string[];
}

export interface IntakeAdapterV0 {
  kind: AdapterKindV0;
  accepts(input: AdapterInputV0): boolean;
  normalize(input: AdapterInputV0): NormalizedArtifactV0;
  summaryHints?(artifact: NormalizedArtifactV0): string[];
}

const hasAbsPath = (text: string): boolean =>
  /\b[A-Za-z]:\\/.test(text) || /\/Users\//.test(text) || /\/home\//.test(text) || /\\Users\\/.test(text);

const hasEnvLike = (text: string): boolean =>
  /%[A-Za-z_][A-Za-z0-9_]*%/.test(text) ||
  /\$env:[A-Za-z_][A-Za-z0-9_]*/.test(text) ||
  /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(text);

export const normalizeRelPathV0 = (value: string): string => {
  const p = String(value || "").replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  return p;
};

export const validateNormalizedArtifactV0 = (
  artifact: NormalizedArtifactV0,
  label: string
): Array<{ code: string; message: string; path: string }> => {
  const issues: Array<{ code: string; message: string; path: string }> = [];
  if (!artifact || artifact.schema !== "weftend.normalizedArtifact/0" || artifact.schemaVersion !== 0) {
    issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "invalid normalized artifact schema", path: `${label}.schema` });
    return issues;
  }
  if (typeof artifact.adapterId !== "string" || artifact.adapterId.length === 0 || artifact.adapterId.length > 64) {
    issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "invalid adapterId", path: `${label}.adapterId` });
  }
  if (typeof artifact.sourceFormat !== "string" || artifact.sourceFormat.length === 0 || artifact.sourceFormat.length > 32) {
    issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "invalid sourceFormat", path: `${label}.sourceFormat` });
  }
  if (typeof artifact.rootDir !== "string" || artifact.rootDir.length === 0) {
    issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "invalid rootDir", path: `${label}.rootDir` });
  } else {
    const rel = normalizeRelPathV0(artifact.rootDir);
    if (rel.includes("..") || hasAbsPath(rel)) {
      issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "rootDir must be relative and path-clean", path: `${label}.rootDir` });
    }
  }
  if (!Array.isArray(artifact.requiredFiles) || artifact.requiredFiles.length === 0 || artifact.requiredFiles.length > 64) {
    issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "requiredFiles out of bounds", path: `${label}.requiredFiles` });
  } else {
    const norm = stableSortUniqueStringsV0(artifact.requiredFiles.map((v) => normalizeRelPathV0(v)));
    norm.forEach((entry, idx) => {
      if (!entry || entry.length > 256 || entry.includes("..") || hasAbsPath(entry) || hasEnvLike(entry)) {
        issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "invalid requiredFiles entry", path: `${label}.requiredFiles[${idx}]` });
      }
    });
  }
  if (!Array.isArray(artifact.markers) || artifact.markers.length > 128) {
    issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "markers out of bounds", path: `${label}.markers` });
  } else {
    artifact.markers.forEach((marker, idx) => {
      if (typeof marker !== "string" || marker.length === 0 || marker.length > 128 || hasAbsPath(marker) || hasEnvLike(marker)) {
        issues.push({ code: "ADAPTER_NORMALIZATION_INVALID", message: "invalid marker", path: `${label}.markers[${idx}]` });
      }
    });
  }
  return issues;
};

export const resolveAdapterInputPathV0 = (input: AdapterInputV0): string =>
  path.resolve(process.cwd(), input.sourcePath || "");

