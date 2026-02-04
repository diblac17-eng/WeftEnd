// src/runtime/examiner/capture_tree_v0.ts
// Deterministic, bounded capture of a file/dir/zip input (v0).

declare const require: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");

export type CaptureInputKindV0 = "file" | "dir" | "zip";

export interface CaptureLimitsV0 {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxPathBytes: number;
}

export interface CaptureEntryV0 {
  path: string;
  size: number;
  digest: string;
}

export interface CaptureTreeV0 {
  kind: CaptureInputKindV0;
  basePath: string;
  rootDigest: string;
  captureDigest: string;
  fileCount: number;
  totalBytes: number;
  entries: CaptureEntryV0[];
  pathsSample: string[];
  issues: string[];
  truncated: boolean;
}

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const fnv1a32Bytes = (buf: Uint8Array): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buf.length; i += 1) {
    hash ^= buf[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizePath = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\/+/, "");

const hasTraversal = (p: string): boolean => p.startsWith("..") || p.includes("/../");

const computeFileDigest = (absPath: string): { digest: string; size: number } => {
  const stat = fs.statSync(absPath);
  const size = Number(stat.size || 0);
  const fd = fs.openSync(absPath, "r");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let bytesRead = 0;
  let hash = 0x811c9dc5;
  try {
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      for (let i = 0; i < bytesRead; i += 1) {
        hash ^= chunk[i];
        hash = Math.imul(hash, 0x01000193);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return { digest: `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`, size };
};

const canonicalizeListing = (entries: CaptureEntryV0[]): string => {
  const items = entries.map((entry) => ({ path: entry.path, size: entry.size }));
  items.sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(items);
};

const canonicalizeDigests = (entries: CaptureEntryV0[]): string => {
  const items = entries.map((entry) => ({ path: entry.path, digest: entry.digest }));
  items.sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(items);
};

const listDir = (dir: string): string[] => {
  const names = fs.readdirSync(dir);
  names.sort((a: string, b: string) => a.localeCompare(b));
  return names;
};

const walkDir = (
  root: string,
  relBase: string,
  limits: CaptureLimitsV0,
  out: CaptureEntryV0[],
  issues: string[],
  state: { totalBytes: number; truncated: boolean }
) => {
  const abs = path.join(root, relBase);
  const entries = listDir(abs);
  for (const name of entries) {
    if (state.truncated) break;
    const rel = relBase ? `${relBase}/${name}` : name;
    const absPath = path.join(root, rel);
    let stat;
    try {
      stat = fs.lstatSync(absPath);
    } catch {
      issues.push("CAPTURE_STAT_FAILED");
      continue;
    }
    if (stat.isSymbolicLink()) {
      issues.push("CAPTURE_SYMLINK_SKIPPED");
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(root, rel, limits, out, issues, state);
      continue;
    }
    if (!stat.isFile()) continue;

    if (out.length >= limits.maxFiles) {
      issues.push("CAPTURE_LIMIT_FILES");
      state.truncated = true;
      break;
    }
    if (state.totalBytes + stat.size > limits.maxTotalBytes) {
      issues.push("CAPTURE_LIMIT_BYTES");
      state.truncated = true;
      break;
    }

    const normalized = normalizePath(rel);
    if (hasTraversal(normalized) || normalized.length === 0) {
      issues.push("CAPTURE_PATH_INVALID");
      continue;
    }
    if (normalized.length > limits.maxPathBytes) {
      issues.push("CAPTURE_PATH_TOO_LONG");
      continue;
    }

    const { digest, size } = computeFileDigest(absPath);
    out.push({ path: normalized, size, digest });
    state.totalBytes += size;
  }
};

const parseZipEntries = (buf: Uint8Array, issues: string[]): CaptureEntryV0[] => {
  const entries: CaptureEntryV0[] = [];
  const view = Buffer.from(buf);
  const sigEOCD = 0x06054b50;
  const sigCD = 0x02014b50;
  const maxSearch = Math.min(view.length, 0x10000 + 22);
  let eocdOffset = -1;
  for (let i = view.length - 22; i >= view.length - maxSearch; i -= 1) {
    if (i < 0) break;
    if (view.readUInt32LE(i) === sigEOCD) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    issues.push("ZIP_EOCD_MISSING");
    return entries;
  }
  const cdCount = view.readUInt16LE(eocdOffset + 10);
  const cdSize = view.readUInt32LE(eocdOffset + 12);
  const cdOffset = view.readUInt32LE(eocdOffset + 16);
  let offset = cdOffset;
  for (let i = 0; i < cdCount; i += 1) {
    if (offset + 46 > view.length) break;
    if (view.readUInt32LE(offset) !== sigCD) {
      issues.push("ZIP_CD_CORRUPT");
      break;
    }
    const compSize = view.readUInt32LE(offset + 20);
    const uncompSize = view.readUInt32LE(offset + 24);
    const nameLen = view.readUInt16LE(offset + 28);
    const extraLen = view.readUInt16LE(offset + 30);
    const commentLen = view.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = view.slice(nameStart, nameStart + nameLen).toString("utf8");
    offset = nameStart + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const normalized = normalizePath(name);
    if (hasTraversal(normalized) || normalized.length === 0) {
      issues.push("ZIP_PATH_INVALID");
      continue;
    }
    entries.push({
      path: normalized,
      size: Math.max(uncompSize || 0, 0),
      digest: `fnv1a32:${fnv1a32(`${normalized}\u0000${compSize}\u0000${uncompSize}`)}`,
    });
  }
  if (cdSize === 0 || cdOffset === 0) {
    issues.push("ZIP_CD_EMPTY");
  }
  return entries;
};

export const captureTreeV0 = (inputPath: string, limits: CaptureLimitsV0): CaptureTreeV0 => {
  const issues: string[] = [];
  const entries: CaptureEntryV0[] = [];
  const stat = fs.existsSync(inputPath) ? fs.lstatSync(inputPath) : null;
  if (!stat) {
    return {
      kind: "file",
      basePath: inputPath,
      rootDigest: "fnv1a32:00000000",
      captureDigest: "fnv1a32:00000000",
      fileCount: 0,
      totalBytes: 0,
      entries: [],
      pathsSample: [],
      issues: ["CAPTURE_INPUT_MISSING"],
      truncated: true,
    };
  }

  if (stat.isDirectory()) {
    const state = { totalBytes: 0, truncated: false };
    walkDir(inputPath, "", limits, entries, issues, state);
    const listing = canonicalizeListing(entries);
    const digests = canonicalizeDigests(entries);
    const rootDigest = `fnv1a32:${fnv1a32(digests)}`;
    const captureDigest = `fnv1a32:${fnv1a32(listing)}`;
    const sample = entries.map((e) => e.path).slice(0, limits.maxFiles);
    return {
      kind: "dir",
      basePath: inputPath,
      rootDigest,
      captureDigest,
      fileCount: entries.length,
      totalBytes: state.totalBytes,
      entries,
      pathsSample: sample,
      issues,
      truncated: state.truncated,
    };
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (stat.isFile() && ext === ".zip") {
    const buf = fs.readFileSync(inputPath);
    const rootDigest = `fnv1a32:${fnv1a32Bytes(buf)}`;
    const zipEntries = parseZipEntries(buf, issues);
    zipEntries.sort((a, b) => a.path.localeCompare(b.path));
    let totalBytes = 0;
    let truncated = false;
    for (const entry of zipEntries) {
      if (entries.length >= limits.maxFiles) {
        issues.push("CAPTURE_LIMIT_FILES");
        truncated = true;
        break;
      }
      if (totalBytes + entry.size > limits.maxTotalBytes) {
        issues.push("CAPTURE_LIMIT_BYTES");
        truncated = true;
        break;
      }
      if (entry.path.length > limits.maxPathBytes) {
        issues.push("CAPTURE_PATH_TOO_LONG");
        continue;
      }
      entries.push(entry);
      totalBytes += entry.size;
    }
    const listing = canonicalizeListing(entries);
    const captureDigest = `fnv1a32:${fnv1a32(listing)}`;
    const sample = entries.map((e) => e.path).slice(0, limits.maxFiles);
    return {
      kind: "zip",
      basePath: inputPath,
      rootDigest,
      captureDigest,
      fileCount: entries.length,
      totalBytes,
      entries,
      pathsSample: sample,
      issues,
      truncated,
    };
  }

  if (stat.isFile()) {
    const { digest, size } = computeFileDigest(inputPath);
    const base = path.basename(inputPath);
    const normalized = normalizePath(base);
    const entry: CaptureEntryV0 = { path: normalized, size, digest };
    const listing = canonicalizeListing([entry]);
    return {
      kind: "file",
      basePath: inputPath,
      rootDigest: digest,
      captureDigest: `fnv1a32:${fnv1a32(listing)}`,
      fileCount: 1,
      totalBytes: size,
      entries: [entry],
      pathsSample: [normalized],
      issues,
      truncated: false,
    };
  }

  return {
    kind: "file",
    basePath: inputPath,
    rootDigest: "fnv1a32:00000000",
    captureDigest: "fnv1a32:00000000",
    fileCount: 0,
    totalBytes: 0,
    entries: [],
    pathsSample: [],
    issues: ["CAPTURE_INPUT_INVALID"],
    truncated: true,
  };
};

