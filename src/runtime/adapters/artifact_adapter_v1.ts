/* src/runtime/adapters/artifact_adapter_v1.ts */
// Universal artifact adapter lane (v1): deterministic, bounded, analysis-only.

import { cmpStrV0 } from "../../core/order";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";
import type { CaptureTreeV0 } from "../examiner/capture_tree_v0";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const zlib = require("zlib");

const MAX_LIST_ITEMS = 20000;
const MAX_FINDING_CODES = 128;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_AR_SCAN_BYTES = 8 * 1024 * 1024;
const KNOWN_PLUGIN_NAMES = new Set<string>(["tar", "7z"]);

const ARCHIVE_EXTS = new Set([".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz", ".txz", ".7z"]);
const PACKAGE_EXTS = new Set([".msi", ".msix", ".exe", ".nupkg", ".whl", ".jar", ".tar.gz", ".tgz", ".tar.xz", ".txz", ".deb", ".rpm", ".appimage", ".pkg", ".dmg"]);
const EXTENSION_EXTS = new Set([".crx", ".vsix", ".xpi"]);
const IAC_EXTS = new Set([".tf", ".tfvars", ".hcl", ".yaml", ".yml", ".json", ".bicep", ".template"]);
const DOCUMENT_EXTS = new Set([".pdf", ".docm", ".xlsm", ".rtf", ".chm"]);
const IMAGE_EXTS = new Set([".iso", ".vhd", ".vhdx", ".vmdk", ".qcow2"]);
const SIGNATURE_EXTS = new Set([".cer", ".crt", ".pem", ".p7b", ".sig"]);

const normalizeExtV1 = (inputPath: string): string => {
  const base = path.basename(String(inputPath || "")).toLowerCase();
  if (base.endsWith(".tar.gz")) return ".tar.gz";
  if (base.endsWith(".tar.bz2")) return ".tar.bz2";
  if (base.endsWith(".tar.xz")) return ".tar.xz";
  if (base.endsWith(".tgz")) return ".tgz";
  if (base.endsWith(".txz")) return ".txz";
  return path.extname(base).toLowerCase();
};

export type AdapterSelectionV1 =
  | "auto"
  | "none"
  | "archive"
  | "package"
  | "extension"
  | "iac"
  | "cicd"
  | "document"
  | "container"
  | "image"
  | "scm"
  | "signature";
export type AdapterClassV1 =
  | "archive"
  | "package"
  | "extension"
  | "iac"
  | "cicd"
  | "document"
  | "container"
  | "image"
  | "scm"
  | "signature";

export type AdapterModeV1 = "built_in" | "plugin";

export interface SafeRunAdapterMetaV1 {
  adapterId: string;
  sourceFormat: string;
  mode: AdapterModeV1;
  reasonCodes: string[];
}

export interface ContentAdapterSignalsV1 {
  class: string;
  counts: Record<string, number>;
  markers: string[];
}

export interface AdapterSummaryV1 {
  schema: "weftend.adapterSummary/0";
  schemaVersion: 0;
  adapterId: string;
  sourceClass: AdapterClassV1;
  sourceFormat: string;
  mode: AdapterModeV1;
  counts: Record<string, number>;
  markers: string[];
  reasonCodes: string[];
}

export interface AdapterFindingsV1 {
  schema: "weftend.adapterFindings/0";
  schemaVersion: 0;
  adapterId: string;
  sourceClass: AdapterClassV1;
  findings: Array<{ code: string; count: number }>;
  markers: string[];
}

export interface AdapterRunOptionsV1 {
  selection: AdapterSelectionV1;
  enabledPlugins: string[];
  inputPath: string;
  capture: CaptureTreeV0;
}

export interface AdapterRunResultV1 {
  ok: boolean;
  reasonCodes: string[];
  failCode?: string;
  failMessage?: string;
  adapter?: SafeRunAdapterMetaV1;
  summary?: AdapterSummaryV1;
  findings?: AdapterFindingsV1;
  adapterSignals?: ContentAdapterSignalsV1;
}

export interface AdapterListItemV1 {
  adapter: string;
  mode: "built_in" | "mixed";
  plugins: Array<{ name: string; available: boolean }>;
  formats: string[];
}

export interface AdapterListReportV1 {
  schema: "weftend.adapterList/0";
  schemaVersion: 0;
  adapters: AdapterListItemV1[];
}

type AnalyzeCtx = {
  inputPath: string;
  ext: string;
  capture: CaptureTreeV0;
  enabledPlugins: Set<string>;
};

type AnalyzeOk = {
  ok: true;
  sourceClass: AdapterClassV1;
  sourceFormat: string;
  mode: AdapterModeV1;
  adapterId: string;
  counts: Record<string, number>;
  markers: string[];
  reasonCodes: string[];
  findingCodes: string[];
};

type AnalyzeFail = {
  ok: false;
  failCode: string;
  failMessage: string;
  reasonCodes: string[];
};

type AnalyzeResult = AnalyzeOk | AnalyzeFail;

const sortCountRecord = (input: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  Object.keys(input)
    .sort((a, b) => cmpStrV0(a, b))
    .forEach((key) => {
      const value = Number(input[key] ?? 0);
      out[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    });
  return out;
};

const toSummary = (res: AnalyzeOk): AdapterSummaryV1 => ({
  schema: "weftend.adapterSummary/0",
  schemaVersion: 0,
  adapterId: res.adapterId,
  sourceClass: res.sourceClass,
  sourceFormat: res.sourceFormat,
  mode: res.mode,
  counts: sortCountRecord(res.counts),
  markers: stableSortUniqueStringsV0(res.markers),
  reasonCodes: stableSortUniqueReasonsV0(res.reasonCodes),
});

const findingHistogram = (codes: string[]): Array<{ code: string; count: number }> => {
  const map = new Map<string, number>();
  codes.forEach((code) => {
    if (typeof code !== "string" || code.length === 0) return;
    map.set(code, (map.get(code) ?? 0) + 1);
  });
  const items = Array.from(map.entries()).map(([code, count]) => ({ code, count }));
  items.sort((a, b) => {
    const c0 = cmpStrV0(a.code, b.code);
    if (c0 !== 0) return c0;
    return a.count - b.count;
  });
  return items.slice(0, MAX_FINDING_CODES);
};

const toFindings = (res: AnalyzeOk): AdapterFindingsV1 => ({
  schema: "weftend.adapterFindings/0",
  schemaVersion: 0,
  adapterId: res.adapterId,
  sourceClass: res.sourceClass,
  findings: findingHistogram(res.findingCodes),
  markers: stableSortUniqueStringsV0(res.markers),
});

const commandAvailable = (cmd: string): boolean => {
  const probe = childProcess.spawnSync(cmd, ["--help"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000,
  });
  if (probe?.error?.code === "ENOENT") return false;
  if (probe?.error?.code === "ENOTFOUND") return false;
  if (probe?.error?.code === "UNKNOWN") return false;
  return true;
};

const readTextBounded = (filePath: string, maxBytes: number = MAX_TEXT_BYTES): string => {
  try {
    const stat = fs.statSync(filePath);
    if (!Number.isFinite(stat.size) || stat.size <= 0) return "";
    const bytes = Math.min(Math.floor(stat.size), Math.floor(maxBytes));
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    if (read <= 0) return "";
    return Buffer.from(buf.subarray(0, read)).toString("utf8");
  } catch {
    return "";
  }
};

const toDomain = (raw: string): string | null => {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = String(url.host || "").trim().toLowerCase();
    if (!host) return null;
    if (!/^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
};

const extractDomains = (text: string): string[] => {
  const out = new Set<string>();
  const re = /\bhttps?:\/\/[^\s"'<>]+/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text)) !== null) {
    const domain = toDomain(match[0]);
    if (domain) out.add(domain);
  }
  return Array.from(out).sort((a, b) => cmpStrV0(a, b));
};

type ZipCatalogEntryV1 = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  flags: number;
  localOffset: number;
};

const parseZipCatalogFromBuffer = (buffer: Uint8Array): { entries: ZipCatalogEntryV1[]; markers: string[] } => {
  const view = Buffer.from(buffer);
  const markers: string[] = [];
  const catalog: ZipCatalogEntryV1[] = [];
  if (view.length < 22) return { entries: catalog, markers: ["ARCHIVE_METADATA_PARTIAL"] };

  const sigEOCD = 0x06054b50;
  const sigCD = 0x02014b50;
  const sigLFH = 0x04034b50;
  const firstLocalOffset = (() => {
    for (let i = 0; i <= Math.max(0, view.length - 4); i += 1) {
      if (view.readUInt32LE(i) === sigLFH) return i;
    }
    return 0;
  })();

  const maxSearch = Math.min(view.length, 0x10000 + 22);
  let eocdOffset = -1;
  for (let i = view.length - 22; i >= view.length - maxSearch; i -= 1) {
    if (i < 0) break;
    if (view.readUInt32LE(i) === sigEOCD) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return { entries: catalog, markers: ["ARCHIVE_METADATA_PARTIAL"] };

  const cdCount = view.readUInt16LE(eocdOffset + 10);
  const cdOffsetRaw = view.readUInt32LE(eocdOffset + 16);
  const cdOffsetCandidate = cdOffsetRaw;
  const cdOffsetAlt = firstLocalOffset + cdOffsetRaw;
  let cdOffset = cdOffsetCandidate;
  if (cdOffset + 4 > view.length || view.readUInt32LE(cdOffset) !== sigCD) {
    if (cdOffsetAlt + 4 <= view.length && view.readUInt32LE(cdOffsetAlt) === sigCD) {
      cdOffset = cdOffsetAlt;
    } else {
      return { entries: catalog, markers: ["ARCHIVE_METADATA_PARTIAL"] };
    }
  }

  let offset = cdOffset;
  for (let i = 0; i < cdCount; i += 1) {
    if (catalog.length >= MAX_LIST_ITEMS) {
      markers.push("ARCHIVE_TRUNCATED");
      break;
    }
    if (offset + 46 > view.length) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    if (view.readUInt32LE(offset) !== sigCD) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const nameLen = view.readUInt16LE(offset + 28);
    const extraLen = view.readUInt16LE(offset + 30);
    const commentLen = view.readUInt16LE(offset + 32);
    const flags = view.readUInt16LE(offset + 8);
    const compressionMethod = view.readUInt16LE(offset + 10);
    const compressedSize = view.readUInt32LE(offset + 20);
    const uncompressedSize = view.readUInt32LE(offset + 24);
    const localOffsetRaw = view.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > view.length) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const name = view.slice(nameStart, nameEnd).toString("utf8").replace(/\\/g, "/").replace(/^\.\/+/, "");
    let localOffset = localOffsetRaw;
    if (localOffset + 4 > view.length || view.readUInt32LE(localOffset) !== sigLFH) {
      const alt = firstLocalOffset + localOffsetRaw;
      if (alt + 4 <= view.length && view.readUInt32LE(alt) === sigLFH) localOffset = alt;
      else markers.push("ARCHIVE_METADATA_PARTIAL");
    }
    if (name && !name.endsWith("/")) {
      catalog.push({
        name,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        flags,
        localOffset,
      });
    }
    offset = nameStart + nameLen + extraLen + commentLen;
  }

  const dedup = new Map<string, ZipCatalogEntryV1>();
  catalog
    .slice()
    .sort((a, b) => {
      const c0 = cmpStrV0(a.name, b.name);
      if (c0 !== 0) return c0;
      return a.localOffset - b.localOffset;
    })
    .forEach((entry) => {
      if (!dedup.has(entry.name)) dedup.set(entry.name, entry);
    });
  return { entries: Array.from(dedup.values()), markers: stableSortUniqueStringsV0(markers) };
};

const readZipEntriesFromBuffer = (buffer: Uint8Array): { entries: string[]; markers: string[] } => {
  const catalog = parseZipCatalogFromBuffer(buffer);
  return {
    entries: catalog.entries.map((entry) => entry.name),
    markers: catalog.markers,
  };
};

const readZipEntries = (inputPath: string): { entries: string[]; markers: string[] } => {
  try {
    const buf = fs.readFileSync(inputPath);
    return readZipEntriesFromBuffer(buf);
  } catch {
    return { entries: [], markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
};

const extractZipEntryText = (archiveBytes: any, entry: ZipCatalogEntryV1): { ok: boolean; text?: string; markers: string[] } => {
  const markers: string[] = [];
  if ((entry.flags & 0x0001) !== 0) return { ok: false, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  if (entry.localOffset + 30 > archiveBytes.length) return { ok: false, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  if (archiveBytes.readUInt32LE(entry.localOffset) !== 0x04034b50) return { ok: false, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  const localNameLen = archiveBytes.readUInt16LE(entry.localOffset + 26);
  const localExtraLen = archiveBytes.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLen + localExtraLen;
  const dataEnd = dataStart + Math.max(0, entry.compressedSize);
  if (dataStart < 0 || dataEnd > archiveBytes.length || dataStart > dataEnd) return { ok: false, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  const compressed = archiveBytes.subarray(dataStart, dataEnd);
  let decoded: any;
  if (entry.compressionMethod === 0) decoded = Buffer.from(compressed);
  else if (entry.compressionMethod === 8) {
    try {
      decoded = zlib.inflateRawSync(compressed);
    } catch {
      return { ok: false, markers: ["ARCHIVE_METADATA_PARTIAL"] };
    }
  } else {
    return { ok: false, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
  const bounded = decoded.subarray(0, MAX_TEXT_BYTES);
  if (decoded.length > MAX_TEXT_BYTES) markers.push("ARCHIVE_TRUNCATED");
  return { ok: true, text: bounded.toString("utf8"), markers: stableSortUniqueStringsV0(markers) };
};

const readZipTextEntriesByBaseName = (inputPath: string, baseNames: string[]): { entries: Array<{ name: string; text: string }>; markers: string[] } => {
  const wanted = new Set(baseNames.map((name) => String(name || "").trim().toLowerCase()).filter((name) => name.length > 0));
  if (wanted.size === 0) return { entries: [], markers: [] };
  let archiveBytes: any;
  try {
    archiveBytes = fs.readFileSync(inputPath);
  } catch {
    return { entries: [], markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
  const { entries: catalog, markers } = parseZipCatalogFromBuffer(archiveBytes);
  const out: Array<{ name: string; text: string }> = [];
  const outMarkers = [...markers];
  for (const entry of catalog) {
    if (out.length >= 32) {
      outMarkers.push("ARCHIVE_TRUNCATED");
      break;
    }
    const base = path.basename(entry.name).toLowerCase();
    if (!wanted.has(base)) continue;
    const extracted = extractZipEntryText(archiveBytes, entry);
    outMarkers.push(...extracted.markers);
    if (!extracted.ok || typeof extracted.text !== "string") continue;
    out.push({ name: entry.name, text: extracted.text });
  }
  out.sort((a, b) => cmpStrV0(a.name, b.name));
  return { entries: out, markers: stableSortUniqueStringsV0(outMarkers) };
};

const readZipTextEntriesByBaseNameFromBuffer = (
  archiveBytes: Uint8Array,
  baseNames: string[]
): { entries: Array<{ name: string; text: string }>; markers: string[] } => {
  const wanted = new Set(baseNames.map((name) => String(name || "").trim().toLowerCase()).filter((name) => name.length > 0));
  if (wanted.size === 0) return { entries: [], markers: [] };
  const { entries: catalog, markers } = parseZipCatalogFromBuffer(archiveBytes);
  const out: Array<{ name: string; text: string }> = [];
  const outMarkers = [...markers];
  for (const entry of catalog) {
    if (out.length >= 32) {
      outMarkers.push("ARCHIVE_TRUNCATED");
      break;
    }
    const base = path.basename(entry.name).toLowerCase();
    if (!wanted.has(base)) continue;
    const extracted = extractZipEntryText(Buffer.from(archiveBytes), entry);
    outMarkers.push(...extracted.markers);
    if (!extracted.ok || typeof extracted.text !== "string") continue;
    out.push({ name: entry.name, text: extracted.text });
  }
  out.sort((a, b) => cmpStrV0(a.name, b.name));
  return { entries: out, markers: stableSortUniqueStringsV0(outMarkers) };
};

const extractCrxZipPayload = (inputPath: string): { ok: boolean; payload: any; markers: string[] } => {
  let bytes: any;
  try {
    bytes = fs.readFileSync(inputPath);
  } catch {
    return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
  }
  if (!bytes || bytes.length < 12) return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
  if (!(bytes[0] === 0x43 && bytes[1] === 0x72 && bytes[2] === 0x32 && bytes[3] === 0x34)) {
    return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
  }
  const version = bytes.readUInt32LE(4);
  let zipOffset = -1;
  if (version === 2) {
    if (bytes.length < 16) return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
    const pubKeyLen = bytes.readUInt32LE(8);
    const sigLen = bytes.readUInt32LE(12);
    zipOffset = 16 + pubKeyLen + sigLen;
  } else if (version === 3) {
    const headerSize = bytes.readUInt32LE(8);
    zipOffset = 12 + headerSize;
  } else {
    return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
  }
  if (!Number.isFinite(zipOffset) || zipOffset < 0 || zipOffset + 4 > bytes.length) {
    return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
  }
  const zipBytes = bytes.subarray(zipOffset);
  if (!(zipBytes[0] === 0x50 && zipBytes[1] === 0x4b && zipBytes[2] === 0x03 && zipBytes[3] === 0x04)) {
    return { ok: false, payload: Buffer.alloc(0), markers: ["EXTENSION_CRX_HEADER_INVALID"] };
  }
  return { ok: true, payload: Buffer.from(zipBytes), markers: [] };
};

const readZipTextEntriesByFilter = (
  inputPath: string,
  predicate: (entryNameLower: string) => boolean
): { entries: Array<{ name: string; text: string }>; markers: string[] } => {
  let archiveBytes: any;
  try {
    archiveBytes = fs.readFileSync(inputPath);
  } catch {
    return { entries: [], markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
  const { entries: catalog, markers } = parseZipCatalogFromBuffer(archiveBytes);
  const out: Array<{ name: string; text: string }> = [];
  const outMarkers = [...markers];
  for (const entry of catalog) {
    if (out.length >= 64) {
      outMarkers.push("ARCHIVE_TRUNCATED");
      break;
    }
    const lower = String(entry.name || "").toLowerCase();
    if (!predicate(lower)) continue;
    const extracted = extractZipEntryText(archiveBytes, entry);
    outMarkers.push(...extracted.markers);
    if (!extracted.ok || typeof extracted.text !== "string") continue;
    out.push({ name: entry.name, text: extracted.text });
  }
  out.sort((a, b) => cmpStrV0(a.name, b.name));
  return { entries: out, markers: stableSortUniqueStringsV0(outMarkers) };
};

const readTarEntries = (inputPath: string): { entries: string[]; markers: string[] } => {
  const parseTarOctal = (raw: string): number | null => {
    const text = raw.replace(/\0.*$/, "").trim();
    if (text.length === 0) return 0;
    if (!/^[0-7]+$/.test(text)) return null;
    const parsed = Number.parseInt(text, 8);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const tarHeaderChecksum = (block: any): number => {
    let sum = 0;
    for (let i = 0; i < 512; i += 1) {
      sum += i >= 148 && i < 156 ? 0x20 : block[i] ?? 0;
    }
    return sum;
  };
  const markers: string[] = [];
  const entries: string[] = [];
  let buf: Uint8Array;
  try {
    buf = fs.readFileSync(inputPath);
  } catch {
    return { entries, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
  let offset = 0;
  let terminatedByZeroBlock = false;
  while (offset + 512 <= buf.length) {
    if (entries.length >= MAX_LIST_ITEMS) {
      markers.push("ARCHIVE_TRUNCATED");
      break;
    }
    const block = Buffer.from(buf.subarray(offset, offset + 512));
    const empty = block.every((b: number) => b === 0);
    if (empty) {
      terminatedByZeroBlock = true;
      break;
    }
    const recordedChecksum = parseTarOctal(block.slice(148, 156).toString("ascii"));
    if (recordedChecksum === null || tarHeaderChecksum(block) !== recordedChecksum) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const nameRaw = block.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefixRaw = block.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const size = parseTarOctal(block.slice(124, 136).toString("ascii"));
    if (size === null) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const fullName = `${prefixRaw ? `${prefixRaw}/` : ""}${nameRaw}`.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (fullName && !fullName.endsWith("/")) entries.push(fullName);
    const dataSize = size > 0 ? size : 0;
    const advance = 512 + Math.ceil(dataSize / 512) * 512;
    if (!Number.isFinite(advance) || advance <= 0 || offset + advance > buf.length) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    offset += advance;
  }
  if (offset < buf.length && !markers.includes("ARCHIVE_TRUNCATED")) {
    const remaining = Buffer.from(buf.subarray(offset));
    const allRemainingZero = remaining.every((b: number) => b === 0);
    if (!(terminatedByZeroBlock && allRemainingZero)) markers.push("ARCHIVE_METADATA_PARTIAL");
  }
  return { entries: stableSortUniqueStringsV0(entries), markers: stableSortUniqueStringsV0(markers) };
};

const readTarTextEntriesByBaseName = (inputPath: string, baseNames: string[]): { entries: Array<{ name: string; text: string }>; markers: string[] } => {
  const parseTarOctal = (raw: string): number | null => {
    const text = raw.replace(/\0.*$/, "").trim();
    if (text.length === 0) return 0;
    if (!/^[0-7]+$/.test(text)) return null;
    const parsed = Number.parseInt(text, 8);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const tarHeaderChecksum = (block: any): number => {
    let sum = 0;
    for (let i = 0; i < 512; i += 1) {
      sum += i >= 148 && i < 156 ? 0x20 : block[i] ?? 0;
    }
    return sum;
  };
  const wanted = new Set(baseNames.map((name) => String(name || "").trim().toLowerCase()).filter((name) => name.length > 0));
  if (wanted.size === 0) return { entries: [], markers: [] };
  let buf: Uint8Array;
  try {
    buf = fs.readFileSync(inputPath);
  } catch {
    return { entries: [], markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
  const markers: string[] = [];
  const out: Array<{ name: string; text: string }> = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const block = Buffer.from(buf.subarray(offset, offset + 512));
    const empty = block.every((b: number) => b === 0);
    if (empty) break;
    const recordedChecksum = parseTarOctal(block.slice(148, 156).toString("ascii"));
    if (recordedChecksum === null || tarHeaderChecksum(block) !== recordedChecksum) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const nameRaw = block.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefixRaw = block.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const size = parseTarOctal(block.slice(124, 136).toString("ascii"));
    if (size === null) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const fullName = `${prefixRaw ? `${prefixRaw}/` : ""}${nameRaw}`.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const dataSize = size > 0 ? size : 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + dataSize;
    const advance = 512 + Math.ceil(dataSize / 512) * 512;
    if (!Number.isFinite(advance) || advance <= 0 || offset + advance > buf.length || dataEnd > buf.length) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    if (fullName && !fullName.endsWith("/") && wanted.has(path.basename(fullName).toLowerCase())) {
      const bounded = Buffer.from(buf.subarray(dataStart, Math.min(dataEnd, dataStart + MAX_TEXT_BYTES)));
      if (dataSize > MAX_TEXT_BYTES) markers.push("ARCHIVE_TRUNCATED");
      out.push({ name: fullName, text: bounded.toString("utf8") });
      if (out.length >= 32) {
        markers.push("ARCHIVE_TRUNCATED");
        break;
      }
    }
    offset += advance;
  }
  out.sort((a, b) => cmpStrV0(a.name, b.name));
  return { entries: out, markers: stableSortUniqueStringsV0(markers) };
};

const readArEntriesV1 = (inputPath: string): { entries: string[]; markers: string[] } => {
  const markers: string[] = [];
  const entries: string[] = [];
  const buf = readBytesBounded(inputPath, MAX_AR_SCAN_BYTES);
  if (!buf || buf.length < 8) return { entries, markers: ["PACKAGE_METADATA_PARTIAL"] };
  if (Buffer.from(buf.subarray(0, 8)).toString("ascii") !== "!<arch>\n") {
    return { entries, markers: ["PACKAGE_METADATA_PARTIAL"] };
  }
  let offset = 8;
  while (offset + 60 <= buf.length) {
    if (entries.length >= MAX_LIST_ITEMS) {
      markers.push("PACKAGE_TRUNCATED");
      break;
    }
    const header = Buffer.from(buf.subarray(offset, offset + 60));
    if (header[58] !== 0x60 || header[59] !== 0x0a) {
      markers.push("PACKAGE_METADATA_PARTIAL");
      break;
    }
    const nameRaw = header.slice(0, 16).toString("utf8").trim();
    const sizeRaw = header.slice(48, 58).toString("utf8").trim();
    const size = Number.parseInt(sizeRaw || "0", 10);
    const name = nameRaw.replace(/\/+$/, "");
    if (name.length > 0) entries.push(name);
    if (!Number.isFinite(size) || size < 0) {
      markers.push("PACKAGE_METADATA_PARTIAL");
      break;
    }
    offset += 60;
    const fileSize = Math.max(0, Math.floor(size));
    const padded = fileSize + (fileSize % 2 === 0 ? 0 : 1);
    if (offset + padded > buf.length) {
      markers.push("PACKAGE_METADATA_PARTIAL");
      break;
    }
    offset += padded;
  }
  if (offset < buf.length && entries.length === 0) markers.push("PACKAGE_METADATA_PARTIAL");
  return { entries: stableSortUniqueStringsV0(entries), markers: stableSortUniqueStringsV0(markers) };
};

const runCommandLines = (cmd: string, args: string[]): { ok: boolean; lines: string[] } => {
  const res = childProcess.spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  if (res?.error?.code === "ENOENT") return { ok: false, lines: [] };
  if (typeof res.status !== "number" || res.status !== 0) return { ok: false, lines: [] };
  const lines = String(res.stdout || "")
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);
  return { ok: true, lines };
};

const runCommandLinesRaw = (cmd: string, args: string[]): { ok: boolean; lines: string[] } => {
  const res = childProcess.spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  if (res?.error?.code === "ENOENT") return { ok: false, lines: [] };
  if (typeof res.status !== "number" || res.status !== 0) return { ok: false, lines: [] };
  const lines = String(res.stdout || "")
    .split(/\r?\n/)
    .filter((line: string) => line.length > 0);
  return { ok: true, lines };
};

const isLikelyGitHashV1 = (value: string): boolean => /^[A-Fa-f0-9]{40}$/.test(value) || /^[A-Fa-f0-9]{64}$/.test(value);

const resolveGitDirV1 = (repoPath: string): string | null => {
  const dotGit = path.join(repoPath, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
  } catch {
    // continue
  }
  try {
    if (!fs.statSync(dotGit).isFile()) return null;
    const text = readTextBounded(dotGit, 4096);
    const match = /^gitdir:\s*(.+)\s*$/im.exec(text);
    if (!match) return null;
    const rel = String(match[1] || "").trim();
    if (!rel) return null;
    const resolved = path.resolve(repoPath, rel);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    return null;
  } catch {
    return null;
  }
};

const parsePackedRefsV1 = (gitDir: string): { map: Map<string, string>; branchRefs: Set<string>; tagRefs: Set<string> } => {
  const map = new Map<string, string>();
  const branchRefs = new Set<string>();
  const tagRefs = new Set<string>();
  const packedPath = path.join(gitDir, "packed-refs");
  const text = readTextBounded(packedPath, MAX_TEXT_BYTES);
  if (!text) return { map, branchRefs, tagRefs };
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) return;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return;
    const hash = String(parts[0] || "").trim();
    const ref = String(parts[1] || "").trim();
    if (!isLikelyGitHashV1(hash) || !ref.startsWith("refs/")) return;
    map.set(ref, hash.toLowerCase());
    if (ref.startsWith("refs/heads/")) branchRefs.add(ref);
    if (ref.startsWith("refs/tags/")) tagRefs.add(ref);
  });
  return { map, branchRefs, tagRefs };
};

const collectLooseRefsV1 = (rootPath: string, prefixRef: string): Set<string> => {
  const out = new Set<string>();
  const walk = (dirPath: string, refPrefix: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true }) as any;
    } catch {
      return;
    }
    entries.sort((a: any, b: any) => cmpStrV0(String(a.name), String(b.name)));
    entries.forEach((entry) => {
      const name = String(entry.name || "");
      if (!name) return;
      const full = path.join(dirPath, name);
      const ref = `${refPrefix}/${name}`.replace(/\\/g, "/");
      if (entry.isDirectory && entry.isDirectory()) {
        walk(full, ref);
        return;
      }
      const value = readTextBounded(full, 256).trim();
      if (!isLikelyGitHashV1(value)) return;
      out.add(ref);
    });
  };
  walk(rootPath, prefixRef);
  return out;
};

const readLooseRefHashV1 = (gitDir: string, refName: string): string | null => {
  const refPath = path.join(gitDir, ...refName.split("/"));
  const value = readTextBounded(refPath, 256).trim();
  return isLikelyGitHashV1(value) ? value.toLowerCase() : null;
};

const readNativeScmFallbackV1 = (repoPath: string): {
  commitResolved: number;
  detachedHead: number;
  branchRefCount: number;
  tagRefCount: number;
  partial: boolean;
} => {
  const gitDir = resolveGitDirV1(repoPath);
  if (!gitDir) return { commitResolved: 0, detachedHead: 0, branchRefCount: 0, tagRefCount: 0, partial: true };

  const packed = parsePackedRefsV1(gitDir);
  const looseHeads = collectLooseRefsV1(path.join(gitDir, "refs", "heads"), "refs/heads");
  const looseTags = collectLooseRefsV1(path.join(gitDir, "refs", "tags"), "refs/tags");
  const allHeads = new Set<string>([...Array.from(looseHeads), ...Array.from(packed.branchRefs)]);
  const allTags = new Set<string>([...Array.from(looseTags), ...Array.from(packed.tagRefs)]);

  let partial = false;
  const headRaw = readTextBounded(path.join(gitDir, "HEAD"), 256).trim();
  let commitResolved = 0;
  let detachedHead = 0;
  if (!headRaw) {
    partial = true;
  } else if (/^ref:\s+/i.test(headRaw)) {
    const refName = headRaw.replace(/^ref:\s+/i, "").trim();
    const loose = readLooseRefHashV1(gitDir, refName);
    const packedHash = packed.map.get(refName) ?? null;
    if (loose || packedHash) commitResolved = 1;
    else partial = true;
  } else if (isLikelyGitHashV1(headRaw)) {
    commitResolved = 1;
    detachedHead = 1;
  } else {
    partial = true;
  }

  return {
    commitResolved,
    detachedHead,
    branchRefCount: allHeads.size,
    tagRefCount: allTags.size,
    partial,
  };
};

const summarizePaths = (paths: string[]): { entryCount: number; nestedArchiveCount: number; maxDepth: number } => {
  const nested = paths.filter((entry) => {
    const ext = normalizeExtV1(entry);
    return ARCHIVE_EXTS.has(ext);
  }).length;
  const maxDepth = paths.reduce((acc, item) => {
    const depth = item.split("/").filter((part) => part.length > 0).length;
    return Math.max(acc, depth);
  }, 0);
  return {
    entryCount: paths.length,
    nestedArchiveCount: nested,
    maxDepth,
  };
};

const isDirectory = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const hasAnyPath = (capture: CaptureTreeV0, patterns: string[]): boolean => {
  const normalized = capture.entries.map((entry) => entry.path.toLowerCase());
  return patterns.some((pattern) => normalized.some((name) => name.includes(pattern)));
};

const collectTextFiles = (inputPath: string, capture: CaptureTreeV0, exts: Set<string>): string[] => {
  if (capture.kind !== "dir") return [];
  const out: string[] = [];
  capture.entries.forEach((entry) => {
    const ext = normalizeExtV1(entry.path);
    if (!exts.has(ext)) return;
    out.push(path.join(inputPath, entry.path));
  });
  out.sort((a, b) => cmpStrV0(a, b));
  return out.slice(0, 256);
};

const readJsonBounded = (filePath: string): unknown | null => {
  const text = readTextBounded(filePath, MAX_TEXT_BYTES);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parsePeSigningEvidenceV1 = (filePath: string): {
  parsed: boolean;
  isPe: boolean;
  signaturePresent: boolean;
  certTableSize: number;
} => {
  const bytes = readBytesBounded(filePath, 128 * 1024);
  if (!bytes || bytes.length < 0x40) return { parsed: false, isPe: false, signaturePresent: false, certTableSize: 0 };
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) return { parsed: true, isPe: false, signaturePresent: false, certTableSize: 0 }; // MZ
  if (bytes.length < 0x40) return { parsed: false, isPe: true, signaturePresent: false, certTableSize: 0 };
  const peOffset = bytes.readUInt32LE(0x3c);
  if (!Number.isFinite(peOffset) || peOffset < 0 || peOffset + 24 > bytes.length) {
    return { parsed: false, isPe: true, signaturePresent: false, certTableSize: 0 };
  }
  if (bytes[peOffset] !== 0x50 || bytes[peOffset + 1] !== 0x45 || bytes[peOffset + 2] !== 0x00 || bytes[peOffset + 3] !== 0x00) {
    return { parsed: false, isPe: true, signaturePresent: false, certTableSize: 0 };
  }
  const optHeaderSize = bytes.readUInt16LE(peOffset + 20);
  const optionalStart = peOffset + 24;
  if (optionalStart + optHeaderSize > bytes.length || optHeaderSize < 96) {
    return { parsed: false, isPe: true, signaturePresent: false, certTableSize: 0 };
  }
  const magic = bytes.readUInt16LE(optionalStart);
  const dataDirStart = magic === 0x10b ? optionalStart + 96 : magic === 0x20b ? optionalStart + 112 : 0;
  if (dataDirStart === 0 || dataDirStart + 8 * 5 > bytes.length) {
    return { parsed: false, isPe: true, signaturePresent: false, certTableSize: 0 };
  }
  const certEntryOffset = dataDirStart + 8 * 4;
  const certTableSize = bytes.readUInt32LE(certEntryOffset + 4);
  return {
    parsed: true,
    isPe: true,
    signaturePresent: certTableSize > 0,
    certTableSize: Math.max(0, certTableSize),
  };
};

const readBytesBounded = (filePath: string, maxBytes: number = MAX_TEXT_BYTES): any => {
  try {
    const stat = fs.statSync(filePath);
    if (!Number.isFinite(stat.size) || stat.size <= 0) return Buffer.alloc(0);
    const bytes = Math.min(Math.floor(stat.size), Math.floor(maxBytes));
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    if (read <= 0) return Buffer.alloc(0);
    return Buffer.from(buf.subarray(0, read));
  } catch {
    return Buffer.alloc(0);
  }
};

const readFileHeadTailBounded = (filePath: string, headBytes: number, tailBytes: number): { head: any; tail: any; size: number } => {
  try {
    const stat = fs.statSync(filePath);
    const size = Math.max(0, Number(stat.size || 0));
    const headLen = Math.max(0, Math.min(headBytes, size));
    const tailLen = Math.max(0, Math.min(tailBytes, size));
    const fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(headLen);
    const tail = Buffer.alloc(tailLen);
    if (headLen > 0) fs.readSync(fd, head, 0, headLen, 0);
    if (tailLen > 0) fs.readSync(fd, tail, 0, tailLen, Math.max(0, size - tailLen));
    fs.closeSync(fd);
    return { head, tail, size };
  } catch {
    return { head: Buffer.alloc(0), tail: Buffer.alloc(0), size: 0 };
  }
};

const countBufferPatternV1 = (haystack: any, needle: any): number => {
  if (!haystack || !needle) return 0;
  if (needle.length <= 0 || haystack.length < needle.length) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, offset);
    if (idx < 0) break;
    count += 1;
    offset = idx + 1;
    if (count >= 100000) break;
  }
  return count;
};

const pemEnvelopeEvidenceV1 = (text: string, label: string): { valid: number; invalid: number } => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`-----BEGIN\\s+${escaped}-----([\\s\\S]*?)-----END\\s+${escaped}-----`, "g");
  let valid = 0;
  let invalid = 0;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text)) !== null) {
    const payloadRaw = String(match[1] || "");
    const payload = payloadRaw.replace(/[\r\n\t ]+/g, "");
    if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
      invalid += 1;
      continue;
    }
    let decoded: any = null;
    try {
      decoded = Buffer.from(payload, "base64");
    } catch {
      decoded = null;
    }
    if (!decoded || decoded.length < 3 || decoded[0] !== 0x30) {
      invalid += 1;
      continue;
    }
    valid += 1;
  }
  return { valid, invalid };
};

const countMatchesV1 = (text: string, pattern: RegExp): number => {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let count = 0;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text)) !== null) {
    count += 1;
    if (match[0].length === 0) re.lastIndex += 1;
    if (count >= 100000) break;
  }
  return count;
};

type ComposeHintsV1 = {
  imageRefCount: number;
  serviceEntryCount: number;
  serviceWithImageOrBuildCount: number;
  buildHintCount: number;
  servicesBlockCount: number;
};

const analyzeComposeHintsV1 = (text: string): ComposeHintsV1 => {
  const lines = text.split(/\r?\n/);
  let imageRefCount = 0;
  let serviceEntryCount = 0;
  let serviceWithImageOrBuildCount = 0;
  let buildHintCount = 0;
  let servicesBlockCount = 0;
  let inServices = false;
  let servicesIndent = -1;
  let currentServiceIndent = -1;
  let currentServiceOpen = false;
  let currentServiceHasImageOrBuild = false;
  const flushService = (): void => {
    if (currentServiceOpen && currentServiceHasImageOrBuild) serviceWithImageOrBuildCount += 1;
    currentServiceOpen = false;
    currentServiceHasImageOrBuild = false;
    currentServiceIndent = -1;
  };
  for (const raw of lines) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/\t/g, "  ");
    if (/^\s*$/.test(line)) continue;
    const indentMatch = /^ */.exec(line);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const trimmed = line.trim();
    if (/^services\s*:\s*$/.test(trimmed)) {
      if (inServices) flushService();
      inServices = true;
      servicesIndent = indent;
      servicesBlockCount += 1;
      continue;
    }
    if (!inServices) continue;
    if (indent <= servicesIndent && /^[A-Za-z0-9._-]+\s*:\s*$/.test(trimmed)) {
      flushService();
      inServices = false;
      servicesIndent = -1;
      continue;
    }
    const serviceMatch = /^([A-Za-z0-9._-]+)\s*:\s*$/.exec(trimmed);
    if (serviceMatch && indent === servicesIndent + 2) {
      flushService();
      currentServiceOpen = true;
      currentServiceIndent = indent;
      serviceEntryCount += 1;
      continue;
    }
    if (currentServiceOpen && indent > currentServiceIndent) {
      if (/^image\s*:\s*[^\s#]+/.test(trimmed)) {
        imageRefCount += 1;
        currentServiceHasImageOrBuild = true;
      } else if (/^build\s*:\s*[^\s#]+/.test(trimmed) || /^build\s*:\s*$/.test(trimmed)) {
        buildHintCount += 1;
        currentServiceHasImageOrBuild = true;
      }
    }
  }
  if (inServices) flushService();
  return {
    imageRefCount,
    serviceEntryCount,
    serviceWithImageOrBuildCount,
    buildHintCount,
    servicesBlockCount,
  };
};

const isLikelyDerSequenceV1 = (bytes: any): boolean => {
  if (!bytes || bytes.length < 4) return false;
  if (bytes[0] !== 0x30) return false;
  const lenByte = bytes[1];
  let contentLen = 0;
  let lengthOfLength = 0;
  if ((lenByte & 0x80) === 0) {
    contentLen = lenByte;
  } else {
    lengthOfLength = lenByte & 0x7f;
    if (lengthOfLength === 0 || lengthOfLength > 4) return false;
    if (bytes.length < 2 + lengthOfLength) return false;
    for (let i = 0; i < lengthOfLength; i += 1) {
      contentLen = (contentLen << 8) | bytes[2 + i];
    }
    // DER long-form length must not encode values that fit in short form.
    if (contentLen < 128) return false;
  }
  const headerLen = 2 + lengthOfLength;
  if (contentLen <= 0) return false;
  return headerLen + contentLen <= bytes.length;
};

const extractActionUsesRefsV1 = (text: string): string[] => {
  const refs: string[] = [];
  const re = /\buses\s*:\s*([^\s#"'`]+|["'][^"']+["'])/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text)) !== null) {
    let value = String(match[1] || "").trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
    value = value.trim();
    if (!value) continue;
    refs.push(value);
  }
  refs.sort((a, b) => cmpStrV0(a, b));
  return refs;
};

const isPinnedActionRefV1 = (ref: string): boolean => {
  const at = ref.lastIndexOf("@");
  if (at < 0) return false;
  const suffix = ref.slice(at + 1).trim();
  if (/^[A-Fa-f0-9]{40}$/.test(suffix)) return true;
  if (/^sha256:[A-Fa-f0-9]{64}$/.test(suffix)) return true;
  return false;
};

const containsExternalRunnerV1 = (text: string): number => {
  const runsOnMatches = countMatchesV1(text, /\bruns-on\s*:\s*(\[[^\]]*self-hosted[^\]]*\]|[^\n\r#]*self-hosted)/gi);
  const dockerRefMatches = countMatchesV1(text, /docker:\/\//gi);
  return runsOnMatches + dockerRefMatches;
};
const analyzeArchive = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  const reasonCodes = ["ARCHIVE_ADAPTER_V1"];
  const markers: string[] = [];
  const ext = ctx.ext;
  let mode: AdapterModeV1 = "built_in";
  let entries: string[] = [];

  if (ext === ".zip") {
    if (strictRoute) {
      const bytes = readBytesBounded(ctx.inputPath, 4);
      const zipMagicOk =
        bytes.length >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
          (bytes[2] === 0x05 && bytes[3] === 0x06) ||
          (bytes[2] === 0x07 && bytes[3] === 0x08));
      if (!zipMagicOk) {
        return {
          ok: false,
          failCode: "ARCHIVE_FORMAT_MISMATCH",
          failMessage: "archive adapter expected ZIP signature bytes for explicit zip route analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_FORMAT_MISMATCH"]),
        };
      }
    }
    if (strictRoute) {
      const zip = readZipEntries(ctx.inputPath);
      entries = zip.entries;
      markers.push(...zip.markers);
    } else if (ctx.capture.kind === "zip") {
      entries = ctx.capture.entries.map((entry) => entry.path);
    } else {
      const zip = readZipEntries(ctx.inputPath);
      entries = zip.entries;
      markers.push(...zip.markers);
    }
  } else if (ext === ".tar") {
    const tar = readTarEntries(ctx.inputPath);
    entries = tar.entries;
    markers.push(...tar.markers);
  } else if (ext === ".tar.gz" || ext === ".tgz" || ext === ".tar.bz2" || ext === ".tar.xz" || ext === ".txz") {
    if (!ctx.enabledPlugins.has("tar")) {
      return {
        ok: false,
        failCode: "ARCHIVE_PLUGIN_REQUIRED",
        failMessage: "archive adapter requires --enable-plugin tar for compressed tar formats.",
        reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_PLUGIN_REQUIRED"]),
      };
    }
    if (!commandAvailable("tar")) {
      return {
        ok: false,
        failCode: "ARCHIVE_PLUGIN_UNAVAILABLE",
        failMessage: "tar plugin was enabled but tar command is unavailable.",
        reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_PLUGIN_UNAVAILABLE"]),
      };
    }
    mode = "plugin";
    const tarList = runCommandLines("tar", ["-tf", ctx.inputPath]);
    if (!tarList.ok) {
      return {
        ok: false,
        failCode: "ARCHIVE_PLUGIN_UNAVAILABLE",
        failMessage: "tar plugin command failed while listing archive entries.",
        reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_PLUGIN_UNAVAILABLE"]),
      };
    }
    entries = stableSortUniqueStringsV0(tarList.lines.map((line) => line.replace(/\\/g, "/").replace(/^\.\/+/, "")));
    reasonCodes.push("ARCHIVE_PLUGIN_USED");
  } else if (ext === ".7z") {
    if (!ctx.enabledPlugins.has("7z")) {
      return {
        ok: false,
        failCode: "ARCHIVE_PLUGIN_REQUIRED",
        failMessage: "archive adapter requires --enable-plugin 7z for .7z artifacts.",
        reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_PLUGIN_REQUIRED"]),
      };
    }
    if (!commandAvailable("7z")) {
      return {
        ok: false,
        failCode: "ARCHIVE_PLUGIN_UNAVAILABLE",
        failMessage: "7z plugin was enabled but 7z command is unavailable.",
        reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_PLUGIN_UNAVAILABLE"]),
      };
    }
    mode = "plugin";
    const sevenList = runCommandLines("7z", ["l", "-slt", ctx.inputPath]);
    if (!sevenList.ok) {
      return {
        ok: false,
        failCode: "ARCHIVE_PLUGIN_UNAVAILABLE",
        failMessage: "7z plugin command failed while listing archive entries.",
        reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_PLUGIN_UNAVAILABLE"]),
      };
    }
    entries = stableSortUniqueStringsV0(
      sevenList.lines
        .filter((line) => line.startsWith("Path = "))
        .map((line) => line.slice("Path = ".length).trim())
        .filter((line) => line.length > 0 && !line.endsWith("/"))
    );
    reasonCodes.push("ARCHIVE_PLUGIN_USED");
  } else {
    return {
      ok: false,
      failCode: "ARCHIVE_UNSUPPORTED_FORMAT",
      failMessage: "archive adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_UNSUPPORTED_FORMAT"]),
    };
  }
  if (strictRoute && ext === ".zip" && markers.includes("ARCHIVE_METADATA_PARTIAL")) {
    return {
      ok: false,
      failCode: "ARCHIVE_FORMAT_MISMATCH",
      failMessage: "archive adapter expected a valid ZIP central directory for explicit route analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_FORMAT_MISMATCH"]),
    };
  }
  if (strictRoute && ext === ".tar" && markers.includes("ARCHIVE_METADATA_PARTIAL")) {
    return {
      ok: false,
      failCode: "ARCHIVE_FORMAT_MISMATCH",
      failMessage: "archive adapter expected a valid archive structure for explicit route analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["ARCHIVE_ADAPTER_V1", "ARCHIVE_FORMAT_MISMATCH"]),
    };
  }

  if (ctx.capture.truncated || entries.length > MAX_LIST_ITEMS) markers.push("ARCHIVE_TRUNCATED");
  const boundedEntries = entries.slice(0, MAX_LIST_ITEMS);
  const summary = summarizePaths(boundedEntries);
  return {
    ok: true,
    sourceClass: "archive",
    sourceFormat: ext.replace(/^\./, "") || "unknown",
    mode,
    adapterId: "archive_adapter_v1",
    counts: {
      entryCount: summary.entryCount,
      nestedArchiveCount: summary.nestedArchiveCount,
      maxDepth: summary.maxDepth,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes.concat(markers.includes("ARCHIVE_TRUNCATED") ? ["ARCHIVE_TRUNCATED"] : [])),
    findingCodes: stableSortUniqueReasonsV0(summary.nestedArchiveCount > 0 ? ["ARCHIVE_NESTED_ENTRY"] : []),
  };
};

const analyzePackage = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  const ext = ctx.ext;
  if (!PACKAGE_EXTS.has(ext)) {
    return {
      ok: false,
      failCode: "PACKAGE_UNSUPPORTED_FORMAT",
      failMessage: "package adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_UNSUPPORTED_FORMAT"]),
    };
  }
  const reasonCodes: string[] = ["PACKAGE_ADAPTER_V1"];
  const markers: string[] = [];
  const findingCodes: string[] = [];
  let mode: AdapterModeV1 = "built_in";
  let signingEvidenceCount = 0;
  let peSignaturePresent = 0;
  let signatureEntryCount = 0;
  let signingParsePartial = 0;
  let packageFileBytes = 0;
  try {
    packageFileBytes = Math.max(0, Number(fs.statSync(ctx.inputPath).size || 0));
  } catch {
    packageFileBytes = 0;
  }

  const installerExt =
    ext === ".msi" ||
    ext === ".msix" ||
    ext === ".exe" ||
    ext === ".deb" ||
    ext === ".rpm" ||
    ext === ".appimage" ||
    ext === ".pkg" ||
    ext === ".dmg";
  if (installerExt) {
    reasonCodes.push("EXECUTION_WITHHELD_INSTALLER");
  }

  let entryNames: string[] = [];
  const manifestTextDomainSet = new Set<string>();
  let textScriptHints = 0;
  let textPermissionHints = 0;
  let debArEntryCount = 0;
  let rpmLeadPresent = 0;
  let rpmHeaderPresent = 0;
  let appImageElfPresent = 0;
  let appImageMarkerPresent = 0;
  let appImageType = 0;
  let pkgXarHeaderPresent = 0;
  let dmgKolyTrailerPresent = 0;
  if (ext === ".nupkg" || ext === ".whl" || ext === ".jar" || ext === ".msix") {
    const zip = readZipEntries(ctx.inputPath);
    entryNames = zip.entries;
    if (strictRoute && entryNames.length === 0) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter detected extension/container mismatch for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
    if (strictRoute) {
      const namesLower = entryNames.map((entry) => String(entry || "").replace(/\\/g, "/").toLowerCase());
      let hasPackageStructure = true;
      if (ext === ".msix") {
        const hasManifest = namesLower.some((name) => {
          const base = path.basename(name);
          return base === "appxmanifest.xml" || base === "appxbundlemanifest.xml";
        });
        const hasContentTypes = namesLower.some((name) => path.basename(name) === "[content_types].xml");
        hasPackageStructure = hasManifest && hasContentTypes;
      } else if (ext === ".nupkg") {
        hasPackageStructure = namesLower.some((name) => path.basename(name).endsWith(".nuspec"));
      } else if (ext === ".whl") {
        const hasMetadata = namesLower.some((name) => name.includes(".dist-info/metadata"));
        const hasWheel = namesLower.some((name) => name.includes(".dist-info/wheel"));
        const hasRecord = namesLower.some((name) => name.includes(".dist-info/record"));
        hasPackageStructure = hasMetadata && hasWheel && hasRecord;
      } else if (ext === ".jar") {
        hasPackageStructure = namesLower.some((name) => name === "meta-inf/manifest.mf");
      }
      if (!hasPackageStructure) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter expected package-specific archive structure for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      if (ext === ".msix" && hasPackageStructure && packageFileBytes < 512) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter requires minimum msix structural size for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      if (ext === ".nupkg" && hasPackageStructure && packageFileBytes < 256) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter requires minimum nupkg structural size for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      if (ext === ".jar" && hasPackageStructure && packageFileBytes < 256) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter requires minimum jar structural size for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
    }
    markers.push(...zip.markers);
    if (entryNames.length === 0) reasonCodes.push("PACKAGE_METADATA_PARTIAL");
    signatureEntryCount += entryNames.filter((entry) => {
      const base = path.basename(String(entry || "")).toLowerCase();
      return (
        base.endsWith(".sig") ||
        base.endsWith(".asc") ||
        base.endsWith(".p7s") ||
        base.endsWith(".p7x") ||
        base === "appxsignature.p7x"
      );
    }).length;
    const zipManifestTexts = readZipTextEntriesByBaseName(ctx.inputPath, [
      "package.json",
      "manifest.json",
      "appxmanifest.xml",
      "nuspec",
      "metadata",
      "pkg-info",
      "pom.xml",
      "setup.py",
    ]);
    markers.push(...zipManifestTexts.markers);
    zipManifestTexts.entries.forEach((entry) => {
      const text = String(entry.text || "");
      if (/\b(preinstall|postinstall|scripts|powershell|cmd\.exe|bash|\/bin\/sh)\b/i.test(text)) textScriptHints += 1;
      if (/\b(permission|capabilit(?:y|ies)|allowe?d?capabilities|requestedexecutionlevel)\b/i.test(text)) textPermissionHints += 1;
      extractDomains(text).forEach((domain) => manifestTextDomainSet.add(domain));
    });
  } else if (ext === ".tar.gz" || ext === ".tgz" || ext === ".tar.xz" || ext === ".txz") {
    if (ctx.enabledPlugins.has("tar") && commandAvailable("tar")) {
      mode = "plugin";
      const tarList = runCommandLines("tar", ["-tf", ctx.inputPath]);
      if (tarList.ok) {
        entryNames = stableSortUniqueStringsV0(tarList.lines);
      } else {
        if (strictRoute) {
          return {
            ok: false,
            failCode: "PACKAGE_PLUGIN_UNAVAILABLE",
            failMessage: "package adapter tar plugin command failed for explicit package analysis.",
            reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_PLUGIN_UNAVAILABLE"]),
          };
        }
        reasonCodes.push("PACKAGE_METADATA_PARTIAL");
      }
    } else if (ctx.enabledPlugins.has("tar") && !commandAvailable("tar")) {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "PACKAGE_PLUGIN_UNAVAILABLE",
          failMessage: "package adapter requires local tar command when tar plugin is enabled.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_PLUGIN_UNAVAILABLE"]),
        };
      }
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
      markers.push("PACKAGE_PLUGIN_TAR_NOT_ENABLED");
    } else {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "PACKAGE_PLUGIN_REQUIRED",
          failMessage: "package adapter requires --enable-plugin tar for compressed tar package formats.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_PLUGIN_REQUIRED"]),
        };
      }
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
      markers.push("PACKAGE_PLUGIN_TAR_NOT_ENABLED");
    }
  } else if (ext === ".deb") {
    const ar = readArEntriesV1(ctx.inputPath);
    entryNames = ar.entries;
    debArEntryCount = entryNames.length;
    if (strictRoute && entryNames.length === 0) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter detected extension/container mismatch for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
    if (strictRoute) {
      const namesLower = entryNames.map((entry) => String(entry || "").toLowerCase());
      const hasDebianBinary = namesLower.includes("debian-binary");
      const hasControl = namesLower.some((name) => name === "control.tar" || name.startsWith("control.tar."));
      const hasData = namesLower.some((name) => name === "data.tar" || name.startsWith("data.tar."));
      if (!hasDebianBinary || !hasControl || !hasData) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter expected Debian package structure entries for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      if (hasDebianBinary && hasControl && hasData && packageFileBytes < 256) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter requires minimum deb structural size for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
    }
    markers.push(...ar.markers);
    if (entryNames.length === 0) reasonCodes.push("PACKAGE_METADATA_PARTIAL");
  } else if (ext === ".rpm") {
    const bytes = readBytesBounded(ctx.inputPath, 128 * 1024);
    rpmLeadPresent = bytes.length >= 4 && bytes[0] === 0xed && bytes[1] === 0xab && bytes[2] === 0xee && bytes[3] === 0xdb ? 1 : 0;
    rpmHeaderPresent = bytes.length >= 99 && bytes[96] === 0x8e && bytes[97] === 0xad && bytes[98] === 0xe8 ? 1 : 0;
    const text = Buffer.from(bytes).toString("latin1");
    if (/\b(preinstall|postinstall|%pre|%post|\/bin\/sh|bash)\b/i.test(text)) textScriptHints += 1;
    if (/\b(capability|permission|policy|selinux)\b/i.test(text)) textPermissionHints += 1;
    if (/\b(gpgsig|pgp[ -]?signature|rpmsig)\b/i.test(text)) {
      signingEvidenceCount += 1;
      signatureEntryCount += 1;
    }
    if (rpmLeadPresent === 0 || rpmHeaderPresent === 0) {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter detected extension/header mismatch for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      if (rpmLeadPresent === 0) markers.push("PACKAGE_RPM_LEAD_MISSING");
      if (rpmHeaderPresent === 0) markers.push("PACKAGE_RPM_HEADER_MISSING");
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
    }
    if (strictRoute && rpmLeadPresent > 0 && rpmHeaderPresent > 0 && packageFileBytes < 256) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter requires minimum rpm structural size for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
  } else if (ext === ".appimage") {
    const bytes = readBytesBounded(ctx.inputPath, 256 * 1024);
    appImageElfPresent = bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46 ? 1 : 0;
    const hasRuntimeMagic = bytes.length >= 11 && bytes[8] === 0x41 && bytes[9] === 0x49 && (bytes[10] === 0x01 || bytes[10] === 0x02);
    appImageMarkerPresent = hasRuntimeMagic ? 1 : 0;
    appImageType = hasRuntimeMagic ? bytes[10] : 0;
    const headText = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString("latin1");
    if (/AppRun|\.desktop|squashfs/i.test(headText)) textScriptHints += 1;
    if (appImageElfPresent === 0 || appImageMarkerPresent === 0) {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter detected extension/header mismatch for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      if (appImageElfPresent === 0) markers.push("PACKAGE_APPIMAGE_HEADER_MISSING");
      if (appImageMarkerPresent === 0) markers.push(headText.includes("AppImage") ? "PACKAGE_APPIMAGE_MARKER_PARTIAL" : "PACKAGE_APPIMAGE_MARKER_MISSING");
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
    }
    if (strictRoute && appImageElfPresent > 0 && appImageMarkerPresent > 0 && packageFileBytes < 512) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter requires minimum appimage structural size for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
  } else if (ext === ".pkg") {
    const io = readFileHeadTailBounded(ctx.inputPath, 256 * 1024, 0);
    const bytes = Buffer.from(io.head);
    const hasXarMagic = bytes.length >= 4 && bytes[0] === 0x78 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21; // xar!
    const bytesBuf = Buffer.from(bytes);
    const xarHeaderSize = bytes.length >= 6 ? bytesBuf.readUInt16BE(4) : 0;
    const xarVersion = bytes.length >= 8 ? bytesBuf.readUInt16BE(6) : 0;
    const xarHeaderValid = hasXarMagic && bytes.length >= 28 && xarHeaderSize >= 28 && xarHeaderSize <= 4096 && xarVersion >= 1 && xarVersion <= 2;
    pkgXarHeaderPresent = xarHeaderValid ? 1 : 0;
    const text = Buffer.from(bytes).toString("latin1");
    if (/\b(scripts|preinstall|postinstall|payload)\b/i.test(text)) textScriptHints += 1;
    if (/\b(permission|authorization|entitlement)\b/i.test(text)) textPermissionHints += 1;
    if (!xarHeaderValid) {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter detected extension/header mismatch for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      markers.push("PACKAGE_PKG_HEADER_MISSING");
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
    }
    if (strictRoute && xarHeaderValid && io.size < 512) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter requires minimum pkg structural size for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
  } else if (ext === ".dmg") {
    const io = readFileHeadTailBounded(ctx.inputPath, 4096, 4096);
    const tail = Buffer.from(io.tail);
    const kolyOffset = tail.length - 512;
    const kolyAtTrailer =
      kolyOffset >= 0 &&
      tail[kolyOffset] === 0x6b &&
      tail[kolyOffset + 1] === 0x6f &&
      tail[kolyOffset + 2] === 0x6c &&
      tail[kolyOffset + 3] === 0x79;
    const kolyLoose = tail.includes(Buffer.from("koly", "ascii"));
    dmgKolyTrailerPresent = kolyAtTrailer ? 1 : 0;
    if (dmgKolyTrailerPresent === 0) {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "PACKAGE_FORMAT_MISMATCH",
          failMessage: "package adapter detected extension/header mismatch for explicit package analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
        };
      }
      markers.push(kolyLoose ? "PACKAGE_DMG_TRAILER_PARTIAL" : "PACKAGE_DMG_TRAILER_MISSING");
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
    }
    if (strictRoute && dmgKolyTrailerPresent > 0 && io.size < 4096) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter requires minimum dmg structural size for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
  }

  if (ext === ".exe") {
    const pe = parsePeSigningEvidenceV1(ctx.inputPath);
    if ((!pe.parsed || !pe.isPe) && strictRoute) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter detected extension/header mismatch for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    } else if (!pe.parsed) {
      signingParsePartial = 1;
    } else if (!pe.isPe) {
      markers.push("PACKAGE_PE_HEADER_MISSING");
    } else if (pe.signaturePresent) {
      peSignaturePresent = 1;
      signingEvidenceCount += 1;
    }
    if (strictRoute && pe.parsed && pe.isPe && packageFileBytes < 512) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter requires minimum exe structural size for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
  }
  if (ext === ".msix" && signatureEntryCount > 0) {
    signingEvidenceCount += 1;
  }
  if (ext === ".msi") {
    const bytes = readBytesBounded(ctx.inputPath, 64);
    const hasCfbMagic =
      bytes.length >= 8 &&
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0 &&
      bytes[4] === 0xa1 &&
      bytes[5] === 0xb1 &&
      bytes[6] === 0x1a &&
      bytes[7] === 0xe1;
    const majorVersion = bytes.length >= 28 ? Buffer.from(bytes).readUInt16LE(26) : 0;
    const byteOrder = bytes.length >= 30 ? Buffer.from(bytes).readUInt16LE(28) : 0;
    const sectorShift = bytes.length >= 32 ? Buffer.from(bytes).readUInt16LE(30) : 0;
    const miniSectorShift = bytes.length >= 34 ? Buffer.from(bytes).readUInt16LE(32) : 0;
    const cfbStructureValid =
      byteOrder === 0xfffe &&
      (majorVersion === 3 || majorVersion === 4) &&
      ((majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12)) &&
      miniSectorShift === 6;
    const isMsiHeader = hasCfbMagic && cfbStructureValid;
    if (strictRoute && !isMsiHeader) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter detected extension/header mismatch for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
    if (strictRoute && isMsiHeader && packageFileBytes < 512) {
      return {
        ok: false,
        failCode: "PACKAGE_FORMAT_MISMATCH",
        failMessage: "package adapter requires minimum msi structural size for explicit package analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
      };
    }
    signingParsePartial = 1;
  }
  if (strictRoute && (markers.includes("ARCHIVE_METADATA_PARTIAL") || markers.includes("PACKAGE_METADATA_PARTIAL"))) {
    return {
      ok: false,
      failCode: "PACKAGE_FORMAT_MISMATCH",
      failMessage: "package adapter expected complete package metadata for explicit package analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["PACKAGE_ADAPTER_V1", "PACKAGE_FORMAT_MISMATCH"]),
    };
  }

  const manifestNames = new Set([
    "package.json",
    "manifest.json",
    "appxmanifest.xml",
    "nuspec",
    "metadata",
    "pkg-info",
    "manifest.mf",
    "pom.xml",
    "setup.py",
    "debian-binary",
    "control.tar",
    "control.tar.gz",
    "control.tar.xz",
    "control.tar.bz2",
    "control.tar.zst",
    "data.tar",
    "data.tar.gz",
    "data.tar.xz",
    "data.tar.bz2",
    "data.tar.zst",
  ]);
  const scriptIndicators = new Set(["preinstall", "postinstall", "install.ps1", "setup.py", "scripts/", "preinst", "postinst", "prerm", "postrm"]);
  const permissionIndicators = new Set(["permission", "capability", "policy", "selinux", "apparmor"]);
  let manifestCount = 0;
  let scriptCount = 0;
  let permissionCount = 0;

  entryNames.forEach((entry) => {
    const lower = entry.toLowerCase();
    const base = path.basename(lower);
    if (manifestNames.has(base) || base.endsWith(".nuspec")) manifestCount += 1;
    if (Array.from(scriptIndicators).some((hint) => lower.includes(hint))) scriptCount += 1;
    if (Array.from(permissionIndicators).some((hint) => lower.includes(hint))) permissionCount += 1;
  });
  scriptCount += textScriptHints;
  permissionCount += textPermissionHints;
  const externalDomainCount = manifestTextDomainSet.size;

  if (manifestCount > 0) findingCodes.push("PACKAGE_MANIFEST_PRESENT");
  if (scriptCount > 0) findingCodes.push("PACKAGE_SCRIPT_HINT_PRESENT");
  if (permissionCount > 0) findingCodes.push("PACKAGE_PERMISSION_HINT_PRESENT");
  if (externalDomainCount > 0) findingCodes.push("PACKAGE_EXTERNAL_REF_PRESENT");
  if (signingEvidenceCount > 0 || peSignaturePresent > 0 || signatureEntryCount > 0) {
    reasonCodes.push("PACKAGE_SIGNING_INFO_PRESENT");
    findingCodes.push("PACKAGE_SIGNING_INFO_PRESENT");
  } else if (installerExt || signingParsePartial > 0) {
    reasonCodes.push("PACKAGE_SIGNING_INFO_UNAVAILABLE");
  }
  if (signingParsePartial > 0) markers.push("PACKAGE_SIGNING_PARSE_PARTIAL");
  if (markers.length > 0) reasonCodes.push("PACKAGE_METADATA_PARTIAL");

  return {
    ok: true,
    sourceClass: "package",
    sourceFormat: ext.replace(/^\./, "") || "unknown",
    mode,
    adapterId: "package_adapter_v1",
    counts: {
      manifestCount,
      scriptHintCount: scriptCount,
      permissionHintCount: permissionCount,
      externalDomainCount,
      signingEvidenceCount,
      peSignaturePresent,
      signatureEntryCount,
      signingParsePartial,
      debArEntryCount,
      rpmLeadPresent,
      rpmHeaderPresent,
      appImageElfPresent,
      appImageMarkerPresent,
      appImageType,
      pkgXarHeaderPresent,
      dmgKolyTrailerPresent,
      signerCountBounded: 0,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
    findingCodes: stableSortUniqueReasonsV0(findingCodes),
  };
};

const analyzeExtensionDir = (inputPath: string): {
  manifestFound: boolean;
  permissionCount: number;
  contentScriptCount: number;
  hostMatchCount: number;
  updateDomains: string[];
  manifestInvalid: boolean;
  manifestCoreValid: boolean;
} => {
  const manifestPath = path.join(inputPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      manifestFound: false,
      permissionCount: 0,
      contentScriptCount: 0,
      hostMatchCount: 0,
      updateDomains: [],
      manifestInvalid: false,
      manifestCoreValid: false,
    };
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return {
      manifestFound: true,
      manifestInvalid: true,
      permissionCount: 0,
      contentScriptCount: 0,
      hostMatchCount: 0,
      updateDomains: [],
      manifestCoreValid: false,
    };
  }
  const manifestVersion = Number(parsed?.manifest_version ?? 0);
  const hasManifestVersion = Number.isInteger(manifestVersion) && manifestVersion >= 2 && manifestVersion <= 3;
  const hasName = typeof parsed?.name === "string" && parsed.name.trim().length > 0;
  const hasVersion = typeof parsed?.version === "string" && parsed.version.trim().length > 0;
  const manifestCoreValid = hasManifestVersion && hasName && hasVersion;
  const permissions = Array.isArray(parsed?.permissions) ? parsed.permissions : [];
  const hostPermissions = Array.isArray(parsed?.host_permissions) ? parsed.host_permissions : [];
  const contentScripts = Array.isArray(parsed?.content_scripts) ? parsed.content_scripts : [];
  const matchCount = contentScripts
    .map((item: any) => (Array.isArray(item?.matches) ? item.matches.length : 0))
    .reduce((sum: number, n: number) => sum + n, 0);
  const updateDomain = parsed?.update_url ? toDomain(String(parsed.update_url)) : null;
  return {
    manifestFound: true,
    manifestInvalid: false,
    permissionCount: permissions.length + hostPermissions.length,
    contentScriptCount: contentScripts.length,
    hostMatchCount: hostPermissions.filter((value: unknown) => typeof value === "string").length + matchCount,
    updateDomains: updateDomain ? [updateDomain] : [],
    manifestCoreValid,
  };
};

const analyzeExtension = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  const ext = ctx.ext;
  const isDir = isDirectory(ctx.inputPath);
  if (!(EXTENSION_EXTS.has(ext) || isDir)) {
    return {
      ok: false,
      failCode: "EXTENSION_UNSUPPORTED_FORMAT",
      failMessage: "extension adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["EXTENSION_ADAPTER_V1", "EXTENSION_UNSUPPORTED_FORMAT"]),
    };
  }
  const reasonCodes: string[] = ["EXTENSION_ADAPTER_V1"];
  const markers: string[] = [];
  const findingCodes: string[] = [];
  const mode: AdapterModeV1 = "built_in";

  let manifestFound = false;
  let manifestInvalid = false;
  let permissionCount = 0;
  let contentScriptCount = 0;
  let hostMatchCount = 0;
  let updateDomains: string[] = [];
  let manifestCoreValid = false;

  if (isDir) {
    const dir = analyzeExtensionDir(ctx.inputPath);
    manifestFound = dir.manifestFound;
    manifestInvalid = dir.manifestInvalid;
    permissionCount = dir.permissionCount;
    contentScriptCount = dir.contentScriptCount;
    hostMatchCount = dir.hostMatchCount;
    updateDomains = dir.updateDomains;
    manifestCoreValid = dir.manifestCoreValid;
  } else {
    const isCrx = ext === ".crx";
    const zipEntries = isCrx ? { entries: [] as string[], markers: [] as string[] } : readZipEntries(ctx.inputPath);
    let zipBuffer: any = null;
    if (isCrx) {
      const crx = extractCrxZipPayload(ctx.inputPath);
      markers.push(...crx.markers);
      if (crx.ok) {
        zipBuffer = crx.payload;
        const zip = readZipEntriesFromBuffer(zipBuffer);
        zipEntries.entries = zip.entries;
        zipEntries.markers = zip.markers;
      } else if (strictRoute) {
        return {
          ok: false,
          failCode: "EXTENSION_FORMAT_MISMATCH",
          failMessage: "extension adapter expected a valid CRX header and ZIP payload for explicit route analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["EXTENSION_ADAPTER_V1", "EXTENSION_FORMAT_MISMATCH"]),
        };
      }
    }
    manifestFound = zipEntries.entries.some((entry) => path.basename(entry).toLowerCase() === "manifest.json");
    markers.push(...zipEntries.markers);
    if (strictRoute && zipEntries.markers.includes("ARCHIVE_METADATA_PARTIAL")) {
      return {
        ok: false,
        failCode: "EXTENSION_FORMAT_MISMATCH",
        failMessage: "extension adapter expected a valid extension package structure for explicit route analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["EXTENSION_ADAPTER_V1", "EXTENSION_FORMAT_MISMATCH"]),
      };
    }
    if (!manifestFound) markers.push("EXTENSION_MANIFEST_MISSING");
    else {
      const manifestTexts = isCrx && zipBuffer
        ? readZipTextEntriesByBaseNameFromBuffer(zipBuffer, ["manifest.json"])
        : readZipTextEntriesByBaseName(ctx.inputPath, ["manifest.json"]);
      markers.push(...manifestTexts.markers);
      if (manifestTexts.entries.length === 0) {
        markers.push("EXTENSION_MANIFEST_PARTIAL");
        manifestInvalid = true;
      } else {
        try {
          const parsed = JSON.parse(manifestTexts.entries[0].text);
          const manifestVersion = Number(parsed?.manifest_version ?? 0);
          const hasManifestVersion = Number.isInteger(manifestVersion) && manifestVersion >= 2 && manifestVersion <= 3;
          const hasName = typeof parsed?.name === "string" && parsed.name.trim().length > 0;
          const hasVersion = typeof parsed?.version === "string" && parsed.version.trim().length > 0;
          manifestCoreValid = hasManifestVersion && hasName && hasVersion;
          const permissions = Array.isArray(parsed?.permissions) ? parsed.permissions : [];
          const hostPermissions = Array.isArray(parsed?.host_permissions) ? parsed.host_permissions : [];
          const contentScripts = Array.isArray(parsed?.content_scripts) ? parsed.content_scripts : [];
          const matchCount = contentScripts
            .map((item: any) => (Array.isArray(item?.matches) ? item.matches.length : 0))
            .reduce((sum: number, n: number) => sum + n, 0);
          const updateDomain = parsed?.update_url ? toDomain(String(parsed.update_url)) : null;
          permissionCount = permissions.length + hostPermissions.length;
          contentScriptCount = contentScripts.length;
          hostMatchCount = hostPermissions.filter((value: unknown) => typeof value === "string").length + matchCount;
          updateDomains = updateDomain ? [updateDomain] : [];
        } catch {
          manifestInvalid = true;
          manifestCoreValid = false;
        }
      }
    }
  }

  if (!manifestFound) {
    return {
      ok: false,
      failCode: "EXTENSION_MANIFEST_MISSING",
      failMessage: "extension adapter requires manifest.json for explicit extension analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["EXTENSION_ADAPTER_V1", "EXTENSION_MANIFEST_MISSING"]),
    };
  }
  if (manifestInvalid) {
    return {
      ok: false,
      failCode: "EXTENSION_MANIFEST_INVALID",
      failMessage: "extension adapter requires a valid manifest.json for explicit extension analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["EXTENSION_ADAPTER_V1", "EXTENSION_MANIFEST_INVALID"]),
    };
  }
  if (strictRoute && !manifestCoreValid) {
    return {
      ok: false,
      failCode: "EXTENSION_MANIFEST_INVALID",
      failMessage: "extension adapter requires manifest core fields (manifest_version/name/version) for explicit extension analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["EXTENSION_ADAPTER_V1", "EXTENSION_MANIFEST_INVALID"]),
    };
  }
  if (updateDomains.length > 0) reasonCodes.push("EXTENSION_EXTERNAL_REF_PRESENT");
  if (permissionCount > 0) findingCodes.push("EXTENSION_PERMISSION_PRESENT");
  if (contentScriptCount > 0) findingCodes.push("EXTENSION_CONTENT_SCRIPT_PRESENT");
  if (hostMatchCount > 0) findingCodes.push("EXTENSION_HOST_MATCH_PRESENT");

  return {
    ok: true,
    sourceClass: "extension",
    sourceFormat: isDir ? "dir" : ext.replace(/^\./, "") || "unknown",
    mode,
    adapterId: "extension_adapter_v1",
    counts: {
      manifestFound: manifestFound ? 1 : 0,
      permissionCount,
      contentScriptCount,
      hostMatchCount,
      externalDomainCount: updateDomains.length,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
    findingCodes: stableSortUniqueReasonsV0(findingCodes.concat(updateDomains.length > 0 ? ["EXTENSION_EXTERNAL_REF_PRESENT"] : [])),
  };
};
const analyzeIacCicd = (ctx: AnalyzeCtx, forcedClass?: "iac" | "cicd"): AnalyzeResult => {
  const textExts = new Set([".tf", ".tfvars", ".hcl", ".yaml", ".yml", ".json", ".bicep", ".template"]);
  const files = collectTextFiles(ctx.inputPath, ctx.capture, textExts);
  const inputLooksIac =
    IAC_EXTS.has(ctx.ext) ||
    hasAnyPath(ctx.capture, [".github/workflows/", ".gitlab-ci", "azure-pipelines", "docker-compose", "compose.yaml"]);
  if (!inputLooksIac && files.length === 0) {
    return {
      ok: false,
      failCode: "IAC_UNSUPPORTED_FORMAT",
      failMessage: "iac adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["IAC_ADAPTER_V1", "IAC_UNSUPPORTED_FORMAT"]),
    };
  }
  const reasons = ["IAC_ADAPTER_V1"];
  const findings: string[] = [];
  let iacStructuralPatterns = 0;
  let privileged = 0;
  let secretRefs = 0;
  let remoteModuleRefs = 0;
  let actionRefCount = 0;
  let cicdStructuralPatterns = 0;
  let unpinnedActionRefs = 0;
  let cicdSecretUsage = 0;
  let externalRunnerRefs = 0;
  const externalDomains = new Set<string>();

  const scanText = (text: string) => {
    iacStructuralPatterns += countMatchesV1(text, /^\s*(terraform|provider|resource|module|variable|output)\b/mgi);
    iacStructuralPatterns += countMatchesV1(text, /^\s*(apiVersion|kind)\s*:/mgi);
    iacStructuralPatterns += countMatchesV1(text, /\bAWSTemplateFormatVersion\b/gi);
    iacStructuralPatterns += countMatchesV1(text, /"resources"\s*:/gi);
    iacStructuralPatterns += countMatchesV1(text, /^\s*services\s*:\s*$/mgi);

    privileged += countMatchesV1(text, /\bprivileged\s*:\s*true\b/gi);
    privileged += countMatchesV1(text, /\ballowprivilegeescalation\s*:\s*true\b/gi);
    privileged += countMatchesV1(text, /\bhost(network|pid|ipc)\s*:\s*true\b/gi);
    privileged += countMatchesV1(text, /\brunasuser\s*:\s*0\b/gi);
    privileged += countMatchesV1(text, /\b(sys_admin|net_admin)\b/gi);

    secretRefs += countMatchesV1(text, /\b(secret|secrets|password|passwd|token|api[_-]?key|client[_-]?secret)\b/gi);
    secretRefs += countMatchesV1(text, /\b(secret|password|token|api[_-]?key|client[_-]?secret)\s*[:=]/gi);

    remoteModuleRefs += countMatchesV1(text, /\bsource\s*=\s*["'](?:git::|https?:\/\/|github\.com\/|git@)/gi);
    remoteModuleRefs += countMatchesV1(text, /\b(?:chart|repository|module)\s*:\s*(?:https?:\/\/|oci:\/\/)/gi);
    cicdStructuralPatterns += countMatchesV1(text, /^\s*(on|jobs|steps|runs-on|stages|script)\s*:/mgi);
    cicdStructuralPatterns += countMatchesV1(text, /^\s*-\s*(uses|run)\s*:/mgi);

    const actionRefs = extractActionUsesRefsV1(text).filter((ref) => !ref.startsWith("./") && !ref.startsWith("../"));
    actionRefCount += actionRefs.length;
    unpinnedActionRefs += actionRefs.filter((ref) => ref.includes("@") && !isPinnedActionRefV1(ref)).length;

    cicdSecretUsage += countMatchesV1(text, /\$\{\{\s*secrets\./gi);
    cicdSecretUsage += countMatchesV1(text, /\bCI_[A-Z0-9_]+\b/g);

    externalRunnerRefs += containsExternalRunnerV1(text);
    extractDomains(text).forEach((domain) => externalDomains.add(domain));
  };

  const filesScanned = ctx.capture.kind === "file" ? 1 : files.length;
  if (ctx.capture.kind === "file") {
    scanText(readTextBounded(ctx.inputPath));
  } else {
    files.forEach((filePath) => scanText(readTextBounded(filePath)));
  }

  if (privileged > 0) {
    reasons.push("IAC_PRIVILEGED_PATTERN");
    findings.push("IAC_PRIVILEGED_PATTERN");
  }
  if (secretRefs > 0) {
    reasons.push("IAC_SECRET_REFERENCE_PATTERN");
    findings.push("IAC_SECRET_REFERENCE_PATTERN");
  }
  if (remoteModuleRefs > 0) {
    reasons.push("IAC_REMOTE_MODULE_REFERENCE");
    findings.push("IAC_REMOTE_MODULE_REFERENCE");
  }
  if (unpinnedActionRefs > 0) {
    reasons.push("CICD_UNPINNED_ACTION");
    findings.push("CICD_UNPINNED_ACTION");
  }
  if (cicdSecretUsage > 0) {
    reasons.push("CICD_SECRET_CONTEXT_USAGE");
    findings.push("CICD_SECRET_CONTEXT_USAGE");
  }
  if (externalRunnerRefs > 0) {
    reasons.push("CICD_EXTERNAL_RUNNER_REF");
    findings.push("CICD_EXTERNAL_RUNNER_REF");
  }
  if (
    forcedClass === "cicd" &&
    cicdStructuralPatterns === 0 &&
    actionRefCount === 0 &&
    unpinnedActionRefs === 0 &&
    cicdSecretUsage === 0 &&
    externalRunnerRefs === 0
  ) {
    return {
      ok: false,
      failCode: "CICD_UNSUPPORTED_FORMAT",
      failMessage: "cicd adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["CICD_ADAPTER_V1", "CICD_UNSUPPORTED_FORMAT"]),
    };
  }
  if (
    forcedClass === "iac" &&
    iacStructuralPatterns === 0 &&
    privileged === 0 &&
    remoteModuleRefs === 0
  ) {
    return {
      ok: false,
      failCode: "IAC_UNSUPPORTED_FORMAT",
      failMessage: "iac adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["IAC_ADAPTER_V1", "IAC_UNSUPPORTED_FORMAT"]),
    };
  }

  const hasCicdSignals = cicdStructuralPatterns + actionRefCount + unpinnedActionRefs + cicdSecretUsage + externalRunnerRefs > 0;
  const sourceClass: AdapterClassV1 = forcedClass ?? (hasCicdSignals ? "cicd" : "iac");
  if (sourceClass === "cicd") reasons.push("CICD_ADAPTER_V1");

  return {
    ok: true,
    sourceClass,
    sourceFormat: ctx.capture.kind === "dir" ? "dir" : ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: sourceClass === "cicd" ? "cicd_adapter_v1" : "iac_adapter_v1",
    counts: {
      filesScanned,
      iacStructuralPatternCount: iacStructuralPatterns,
      privilegedPatternCount: privileged,
      secretPatternCount: secretRefs,
      remoteModulePatternCount: remoteModuleRefs,
      cicdActionRefCount: actionRefCount,
      cicdStructuralPatternCount: cicdStructuralPatterns,
      cicdUnpinnedActionCount: unpinnedActionRefs,
      cicdSecretUsageCount: cicdSecretUsage,
      cicdExternalRunnerCount: externalRunnerRefs,
      externalDomainCount: externalDomains.size,
    },
    markers: [],
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findings),
  };
};

const analyzeDocument = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  if (!DOCUMENT_EXTS.has(ctx.ext)) {
    return {
      ok: false,
      failCode: "DOC_UNSUPPORTED_FORMAT",
      failMessage: "document adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_UNSUPPORTED_FORMAT"]),
    };
  }
  if (strictRoute) {
    if (ctx.ext === ".pdf") {
      const window = readFileHeadTailBounded(ctx.inputPath, 64, 2048);
      const head = Buffer.from(window.head).toString("latin1");
      const pdfIdx = head.indexOf("%PDF-");
      const pdfHeaderOk = pdfIdx >= 0 && pdfIdx <= 8;
      if (!pdfHeaderOk) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter detected extension/header mismatch for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      const tail = Buffer.from(window.tail).toString("latin1");
      const pdfEofOk = /%%EOF(?:\s|$)/.test(tail);
      if (!pdfEofOk) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter expected PDF EOF marker for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      const pdfWindow = `${head}\n${tail}`;
      const pdfObjectSyntaxOk = /\b\d+\s+\d+\s+obj\b/.test(pdfWindow);
      const pdfStructureHintOk = /\/Type\s*\/Catalog\b|\bxref\b|\btrailer\b/i.test(pdfWindow);
      if (!pdfObjectSyntaxOk || !pdfStructureHintOk) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter expected PDF object and structural marker evidence for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      const pdfStartXrefOk = /\bstartxref\b/i.test(tail);
      if (!pdfStartXrefOk) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter expected PDF startxref marker for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
    } else if (ctx.ext === ".rtf") {
      const window = readFileHeadTailBounded(ctx.inputPath, 64, 512);
      const head = Buffer.from(window.head).toString("latin1");
      if (!/^\s*\{\\rtf1\b/i.test(head)) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter detected extension/header mismatch for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      const rtfControlWordOk = /\\ansi\b|\\deff\d+\b/i.test(head);
      if (!rtfControlWordOk) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter expected baseline RTF control-word evidence for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      const tail = Buffer.from(window.tail).toString("latin1");
      if (!/\}\s*$/.test(tail)) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter expected RTF closing brace for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
    } else if (ctx.ext === ".chm") {
      const window = readFileHeadTailBounded(ctx.inputPath, 96, 0);
      const bytes = Buffer.from(window.head);
      const chmHeaderOk =
        bytes.length >= 4 && bytes[0] === 0x49 && bytes[1] === 0x54 && bytes[2] === 0x53 && bytes[3] === 0x46;
      if (!chmHeaderOk) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter detected extension/header mismatch for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      const minChmHeaderBytes = 0x60;
      if (window.size < minChmHeaderBytes) {
        return {
          ok: false,
          failCode: "DOC_FORMAT_MISMATCH",
          failMessage: "document adapter expected minimum CHM header bytes for explicit document analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
        };
      }
      if (bytes.length >= 12) {
        const declaredHeaderBytes = bytes.readUInt32LE(8);
        if (declaredHeaderBytes > 0 && (declaredHeaderBytes < minChmHeaderBytes || declaredHeaderBytes > window.size)) {
          return {
            ok: false,
            failCode: "DOC_FORMAT_MISMATCH",
            failMessage: "document adapter detected invalid CHM header length for explicit document analysis.",
            reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
          };
        }
      }
    }
  }
  const text = readTextBounded(ctx.inputPath);
  const reasons = ["DOC_ADAPTER_V1"];
  const markers: string[] = [];
  const findings: string[] = [];
  let activeContent = 0;
  let embeddedObject = 0;
  let externalLink = 0;
  if (/\b(vba|macro|autoopen|autorun|javascript)\b/i.test(text)) activeContent += 1;
  if (/EmbeddedFile|ObjStm|\/Object|Ole/i.test(text)) embeddedObject += 1;
  if (extractDomains(text).length > 0) externalLink += 1;

  if (ctx.ext === ".docm" || ctx.ext === ".xlsm") {
    const zip = readZipEntries(ctx.inputPath);
    if (strictRoute && zip.entries.length === 0) {
      return {
        ok: false,
        failCode: "DOC_FORMAT_MISMATCH",
        failMessage: "document adapter detected extension/container mismatch for explicit office-document analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
      };
    }
    markers.push(...zip.markers);
    const namesLower = zip.entries.map((name) => String(name || "").toLowerCase());
    const hasContentTypes = namesLower.includes("[content_types].xml");
    const hasRelationshipPart =
      namesLower.includes("_rels/.rels") ||
      namesLower.includes("word/_rels/document.xml.rels") ||
      namesLower.includes("xl/_rels/workbook.xml.rels");
    const hasPrimaryPart =
      (ctx.ext === ".docm" && namesLower.includes("word/document.xml")) ||
      (ctx.ext === ".xlsm" && namesLower.includes("xl/workbook.xml"));
    if (strictRoute && (!hasContentTypes || !hasRelationshipPart)) {
      return {
        ok: false,
        failCode: "DOC_FORMAT_MISMATCH",
        failMessage: "document adapter expected OOXML document structure for explicit office-document analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
      };
    }
    if (strictRoute && !hasPrimaryPart) {
      return {
        ok: false,
        failCode: "DOC_FORMAT_MISMATCH",
        failMessage: "document adapter expected OOXML primary document part for explicit office-document analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
      };
    }
    if (namesLower.some((name) => name.includes("vbaproject") || name.includes("macros"))) activeContent += 1;
    if (namesLower.some((name) => name.includes("/embeddings/") || name.includes("oleobject"))) embeddedObject += 1;
    if (namesLower.some((name) => name.includes("externallinks/"))) externalLink += 1;
    const relTexts = readZipTextEntriesByFilter(
      ctx.inputPath,
      (name) => name.endsWith(".rels") || name.endsWith("document.xml") || name.endsWith("workbook.xml")
    );
    markers.push(...relTexts.markers);
    relTexts.entries.forEach((entry) => {
      const rel = String(entry.text || "");
      if (/TargetMode\s*=\s*["']External["']/i.test(rel) || /https?:\/\//i.test(rel)) externalLink += 1;
    });
    if (strictRoute && markers.includes("ARCHIVE_METADATA_PARTIAL")) {
      return {
        ok: false,
        failCode: "DOC_FORMAT_MISMATCH",
        failMessage: "document adapter expected complete OOXML ZIP metadata for explicit office-document analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_FORMAT_MISMATCH"]),
      };
    }
  }

  if (activeContent > 0) {
    reasons.push("DOC_ACTIVE_CONTENT_PRESENT");
    findings.push("DOC_ACTIVE_CONTENT_PRESENT");
  }
  if (embeddedObject > 0) {
    reasons.push("DOC_EMBEDDED_OBJECT_PRESENT");
    findings.push("DOC_EMBEDDED_OBJECT_PRESENT");
  }
  if (externalLink > 0) {
    reasons.push("DOC_EXTERNAL_LINK_PRESENT");
    findings.push("DOC_EXTERNAL_LINK_PRESENT");
  }
  return {
    ok: true,
    sourceClass: "document",
    sourceFormat: ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: "document_adapter_v1",
    counts: {
      activeContentCount: activeContent,
      embeddedObjectCount: embeddedObject,
      externalLinkCount: externalLink,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findings),
  };
};

const analyzeContainer = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  const lower = path.basename(ctx.inputPath).toLowerCase();
  const isTarInput = ctx.ext === ".tar";
  const isOciLayout =
    isDirectory(ctx.inputPath) && fs.existsSync(path.join(ctx.inputPath, "oci-layout")) && fs.existsSync(path.join(ctx.inputPath, "index.json"));
  const isCompose =
    lower === "docker-compose.yml" ||
    lower === "docker-compose.yaml" ||
    lower === "compose.yml" ||
    lower === "compose.yaml" ||
    hasAnyPath(ctx.capture, ["docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"]);
  const isSbom = /sbom|spdx|cyclonedx|bom/i.test(lower);
  const isContainerTarByHint = isTarInput && hasAnyPath(ctx.capture, ["manifest.json", "repositories"]);
  const tarEntries = isTarInput ? readTarEntries(ctx.inputPath) : { entries: [] as string[], markers: [] as string[] };
  const isContainerTarByEntries =
    isTarInput &&
    tarEntries.entries.some((name) => path.basename(String(name || "")).toLowerCase() === "manifest.json") &&
    tarEntries.entries.some((name) => path.basename(String(name || "")).toLowerCase() === "repositories");
  const isOciTarByEntries =
    isTarInput &&
    tarEntries.entries.some((name) => path.basename(String(name || "")).toLowerCase() === "oci-layout") &&
    tarEntries.entries.some((name) => path.basename(String(name || "")).toLowerCase() === "index.json") &&
    tarEntries.entries.some((name) => String(name || "").replace(/\\/g, "/").toLowerCase().startsWith("blobs/sha256/"));
  const isContainerTar = isContainerTarByHint || isContainerTarByEntries || isOciTarByEntries;
  if (strictRoute && isTarInput && !isContainerTar) {
    return {
      ok: false,
      failCode: "CONTAINER_FORMAT_MISMATCH",
      failMessage: "container adapter expected docker tar markers (manifest/repositories) or OCI tar markers (oci-layout/index/blobs) for explicit tar analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
    };
  }
  if (!isOciLayout && !isCompose && !isSbom && !isContainerTar) {
    return {
      ok: false,
      failCode: "CONTAINER_UNSUPPORTED_FORMAT",
      failMessage: "container adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_UNSUPPORTED_FORMAT"]),
    };
  }
  const reasons = ["CONTAINER_ADAPTER_V1"];
  const findings: string[] = [];
  const markers: string[] = [];
  let ociManifestCount = 0;
  let ociBlobCount = 0;
  let tarEntryCount = 0;
  let dockerLayerEntryCount = 0;
  let dockerManifestMarkerPresent = 0;
  let dockerRepositoriesMarkerPresent = 0;
  let dockerManifestJsonValid = 0;
  let dockerRepositoriesJsonValid = 0;
  let dockerRepositoriesTagMapCount = 0;
  let dockerManifestConfigRefCount = 0;
  let dockerManifestConfigResolvedCount = 0;
  let dockerManifestLayerRefCount = 0;
  let dockerManifestLayerResolvedCount = 0;
  let composeImageRefCount = 0;
  let composeServiceHintCount = 0;
  let composeServiceChildHintCount = 0;
  let composeServiceWithImageOrBuildCount = 0;
  let composeBuildHintCount = 0;
  let composeServicesBlockCount = 0;
  let sbomPackageCount = 0;
  let ociManifestDigestRefCount = 0;
  let ociManifestDigestResolvedCount = 0;

  if (isOciLayout) {
    const capturePathSet = new Set<string>(
      ctx.capture.entries.map((entry) => String(entry.path || "").replace(/\\/g, "/").toLowerCase())
    );
    const layout = readJsonBounded(path.join(ctx.inputPath, "oci-layout"));
    const layoutOk = layout && typeof layout === "object" && typeof (layout as any).imageLayoutVersion === "string";
    if (!layoutOk) {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "CONTAINER_LAYOUT_INVALID",
          failMessage: "container adapter requires valid oci-layout metadata for explicit OCI layout analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_LAYOUT_INVALID"]),
        };
      }
      markers.push("CONTAINER_LAYOUT_PARTIAL");
    }
    const index = readJsonBounded(path.join(ctx.inputPath, "index.json"));
    let indexManifests: unknown[] = [];
    if (index && typeof index === "object") {
      if (Array.isArray((index as any).manifests)) {
        indexManifests = (index as any).manifests;
        ociManifestCount = indexManifests.length;
        if (strictRoute && ociManifestCount === 0) {
          return {
            ok: false,
            failCode: "CONTAINER_INDEX_INVALID",
            failMessage: "container adapter requires non-empty OCI index manifests for explicit OCI layout analysis.",
            reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_INDEX_INVALID"]),
          };
        }
      } else {
        if (strictRoute) {
          return {
            ok: false,
            failCode: "CONTAINER_INDEX_INVALID",
            failMessage: "container adapter requires OCI index manifests array for explicit OCI layout analysis.",
            reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_INDEX_INVALID"]),
          };
        }
        markers.push("CONTAINER_INDEX_PARTIAL");
      }
    } else {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "CONTAINER_INDEX_INVALID",
          failMessage: "container adapter requires valid OCI index.json for explicit OCI layout analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_INDEX_INVALID"]),
        };
      }
      markers.push("CONTAINER_INDEX_PARTIAL");
    }
    ociBlobCount = ctx.capture.entries
      .map((entry) => String(entry.path || "").replace(/\\/g, "/").toLowerCase())
      .filter((name) => name.startsWith("blobs/sha256/"))
      .length;
    indexManifests.forEach((manifest) => {
      if (!manifest || typeof manifest !== "object") return;
      const digestRaw = typeof (manifest as any).digest === "string" ? String((manifest as any).digest || "") : "";
      const digestMatch = /^sha256:([a-f0-9]{6,128})$/i.exec(digestRaw.trim());
      if (!digestMatch) return;
      const digestHex = digestMatch[1].toLowerCase();
      ociManifestDigestRefCount += 1;
      if (capturePathSet.has(`blobs/sha256/${digestHex}`)) ociManifestDigestResolvedCount += 1;
    });
    if (strictRoute && ociManifestCount > 0 && ociBlobCount === 0) {
      return {
        ok: false,
        failCode: "CONTAINER_LAYOUT_INVALID",
        failMessage: "container adapter requires OCI blob evidence for explicit OCI layout analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_LAYOUT_INVALID"]),
      };
    }
    if (strictRoute && ociManifestCount > 0 && ociManifestDigestRefCount === 0) {
      return {
        ok: false,
        failCode: "CONTAINER_LAYOUT_INVALID",
        failMessage: "container adapter requires OCI manifest digest references for explicit OCI layout analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_LAYOUT_INVALID"]),
      };
    }
    if (strictRoute && ociManifestDigestRefCount > 0 && ociManifestDigestResolvedCount < ociManifestDigestRefCount) {
      return {
        ok: false,
        failCode: "CONTAINER_LAYOUT_INVALID",
        failMessage: "container adapter requires OCI manifest digest references to resolve to blob entries for explicit OCI layout analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_LAYOUT_INVALID"]),
      };
    }
  }
  if (isContainerTar) {
    tarEntryCount = tarEntries.entries.length;
    markers.push(...tarEntries.markers);
    const tarNames = tarEntries.entries.map((name) => String(name || "").replace(/\\/g, "/").toLowerCase());
    const tarNameSet = new Set<string>(tarNames);
    if (isOciTarByEntries) {
      const ociTexts = readTarTextEntriesByBaseName(ctx.inputPath, ["index.json"]);
      markers.push(...ociTexts.markers);
      const ociIndexEntry = ociTexts.entries.find((entry) => path.basename(entry.name).toLowerCase() === "index.json");
      if (ociIndexEntry) {
        try {
          const parsed = JSON.parse(String(ociIndexEntry.text || ""));
          if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).manifests)) {
            const manifests = (parsed as any).manifests as unknown[];
            ociManifestCount = manifests.length;
            manifests.forEach((manifest) => {
              if (!manifest || typeof manifest !== "object") return;
              const digestRaw = typeof (manifest as any).digest === "string" ? String((manifest as any).digest || "") : "";
              const digestMatch = /^sha256:([a-f0-9]{6,128})$/i.exec(digestRaw.trim());
              if (!digestMatch) return;
              const digestHex = digestMatch[1].toLowerCase();
              ociManifestDigestRefCount += 1;
              if (tarNameSet.has(`blobs/sha256/${digestHex}`)) ociManifestDigestResolvedCount += 1;
            });
          }
        } catch {
          // strict route handles invalid/partial OCI tar payload below
        }
      }
      if (strictRoute && ociManifestDigestRefCount > 0 && ociManifestDigestResolvedCount < ociManifestDigestRefCount) {
        return {
          ok: false,
          failCode: "CONTAINER_FORMAT_MISMATCH",
          failMessage: "container adapter expected OCI manifest digest references to resolve to tar blob entries for explicit OCI tar analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
        };
      }
      if (strictRoute && ociManifestCount > 0 && ociManifestDigestRefCount === 0) {
        return {
          ok: false,
          failCode: "CONTAINER_FORMAT_MISMATCH",
          failMessage: "container adapter expected OCI manifest digest references for explicit OCI tar analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
        };
      }
    }
    dockerManifestMarkerPresent = tarNames.some((name) => path.basename(name) === "manifest.json") ? 1 : 0;
    dockerRepositoriesMarkerPresent = tarNames.some((name) => path.basename(name) === "repositories") ? 1 : 0;
    dockerLayerEntryCount = tarNames.filter((name) => name === "layer.tar" || name.endsWith("/layer.tar")).length;
    if (dockerManifestMarkerPresent > 0 && dockerRepositoriesMarkerPresent > 0 && !isOciTarByEntries) {
      const dockerTexts = readTarTextEntriesByBaseName(ctx.inputPath, ["manifest.json", "repositories"]);
      markers.push(...dockerTexts.markers);
      const manifestEntry = dockerTexts.entries.find((entry) => path.basename(entry.name).toLowerCase() === "manifest.json");
      const repositoriesEntry = dockerTexts.entries.find((entry) => path.basename(entry.name).toLowerCase() === "repositories");
      if (manifestEntry) {
        try {
          const parsed = JSON.parse(String(manifestEntry.text || ""));
          if (Array.isArray(parsed) && parsed.length > 0) {
            let refs = 0;
            let resolved = 0;
            parsed.forEach((item: any) => {
              if (!item || typeof item !== "object") return;
              const configRef = typeof item.Config === "string" ? String(item.Config || "") : "";
              if (configRef.trim().length > 0) {
                const normalizedConfig = configRef.replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase();
                dockerManifestConfigRefCount += 1;
                if (normalizedConfig.length > 0 && tarNameSet.has(normalizedConfig)) dockerManifestConfigResolvedCount += 1;
              }
              const layers = Array.isArray(item.Layers) ? item.Layers : [];
              layers.forEach((layer: unknown) => {
                if (typeof layer !== "string") return;
                const normalized = String(layer || "").replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase();
                if (!normalized) return;
                refs += 1;
                if (tarNameSet.has(normalized)) resolved += 1;
              });
            });
            if (refs > 0) {
              dockerManifestJsonValid = 1;
              dockerManifestLayerRefCount = refs;
              dockerManifestLayerResolvedCount = resolved;
            }
          }
        } catch {
          // strict route handles invalid marker payload below
        }
      }
      if (repositoriesEntry) {
        try {
          const parsed = JSON.parse(String(repositoriesEntry.text || ""));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
            let tagMapCount = 0;
            Object.values(parsed as Record<string, unknown>).forEach((repoValue) => {
              if (!repoValue || typeof repoValue !== "object" || Array.isArray(repoValue)) return;
              Object.keys(repoValue as Record<string, unknown>).forEach((tagKey) => {
                if (typeof tagKey === "string" && tagKey.trim().length > 0) tagMapCount += 1;
              });
            });
            if (tagMapCount > 0) {
              dockerRepositoriesJsonValid = 1;
              dockerRepositoriesTagMapCount = tagMapCount;
            }
          }
        } catch {
          // strict route handles invalid marker payload below
        }
      }
      if (strictRoute && (dockerManifestJsonValid === 0 || dockerRepositoriesJsonValid === 0)) {
        return {
          ok: false,
          failCode: "CONTAINER_FORMAT_MISMATCH",
          failMessage: "container adapter expected valid docker manifest/repositories JSON for explicit docker tar analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
        };
      }
      if (strictRoute && dockerManifestLayerRefCount > 0 && dockerManifestLayerResolvedCount === 0) {
        return {
          ok: false,
          failCode: "CONTAINER_FORMAT_MISMATCH",
          failMessage: "container adapter expected docker manifest layer references to resolve to tar entries for explicit docker tar analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
        };
      }
      if (strictRoute && dockerManifestConfigRefCount > 0 && dockerManifestConfigResolvedCount === 0) {
        return {
          ok: false,
          failCode: "CONTAINER_FORMAT_MISMATCH",
          failMessage: "container adapter expected docker manifest config references to resolve to tar entries for explicit docker tar analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
        };
      }
    }
    if (strictRoute && tarEntries.markers.includes("ARCHIVE_METADATA_PARTIAL")) {
      return {
        ok: false,
        failCode: "CONTAINER_FORMAT_MISMATCH",
        failMessage: "container adapter expected complete tar metadata for explicit container tar analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
      };
    }
    if (
      strictRoute &&
      dockerManifestMarkerPresent > 0 &&
      dockerRepositoriesMarkerPresent > 0 &&
      dockerLayerEntryCount === 0 &&
      !isOciTarByEntries
    ) {
      return {
        ok: false,
        failCode: "CONTAINER_FORMAT_MISMATCH",
        failMessage: "container adapter expected docker layer tar evidence for explicit docker tar analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
      };
    }
  }
  if (isCompose) {
    const composeTexts: string[] = [];
    if (ctx.capture.kind === "file") {
      composeTexts.push(readTextBounded(ctx.inputPath));
    } else {
      const composeFiles = ctx.capture.entries
        .map((entry) => entry.path)
        .filter((p) => {
          const base = path.basename(String(p || "")).toLowerCase();
          return base === "docker-compose.yml" || base === "docker-compose.yaml" || base === "compose.yml" || base === "compose.yaml";
        })
        .slice(0, 8);
      composeFiles.forEach((relPath) => composeTexts.push(readTextBounded(path.join(ctx.inputPath, relPath))));
    }
    composeTexts.forEach((text) => {
      const hints = analyzeComposeHintsV1(text);
      composeImageRefCount += hints.imageRefCount;
      composeServiceHintCount += hints.serviceEntryCount;
      composeServiceChildHintCount += hints.serviceEntryCount;
      composeServiceWithImageOrBuildCount += hints.serviceWithImageOrBuildCount;
      composeBuildHintCount += hints.buildHintCount;
      composeServicesBlockCount += hints.servicesBlockCount;
    });
    if (
      strictRoute &&
      (composeServicesBlockCount === 0 || composeServiceHintCount === 0 || composeServiceWithImageOrBuildCount === 0)
    ) {
      return {
        ok: false,
        failCode: "CONTAINER_FORMAT_MISMATCH",
        failMessage: "container adapter expected compose services block with service entries and in-service image/build hints for explicit compose analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_FORMAT_MISMATCH"]),
      };
    }
  }
  if (isSbom) {
    const sbom = readJsonBounded(ctx.inputPath);
    if (sbom && typeof sbom === "object") {
      const pkg = Array.isArray((sbom as any).packages) ? (sbom as any).packages.length : 0;
      const comps = Array.isArray((sbom as any).components) ? (sbom as any).components.length : 0;
      sbomPackageCount = Math.max(pkg, comps);
      if (sbomPackageCount === 0) {
        if (strictRoute) {
          return {
            ok: false,
            failCode: "CONTAINER_SBOM_INVALID",
            failMessage: "container adapter requires non-empty SBOM package/component evidence for explicit SBOM analysis.",
            reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_SBOM_INVALID"]),
          };
        }
        markers.push("CONTAINER_SBOM_PARTIAL");
      }
    } else {
      if (strictRoute) {
        return {
          ok: false,
          failCode: "CONTAINER_SBOM_INVALID",
          failMessage: "container adapter requires valid JSON for explicit SBOM analysis.",
          reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_ADAPTER_V1", "CONTAINER_SBOM_INVALID"]),
        };
      }
      markers.push("CONTAINER_SBOM_PARTIAL");
    }
  }

  if (isOciLayout || isOciTarByEntries) {
    reasons.push("CONTAINER_OCI_LAYOUT");
    findings.push("CONTAINER_OCI_LAYOUT");
  }
  if (isContainerTar) {
    reasons.push("CONTAINER_TARBALL_SCAN");
    findings.push("CONTAINER_TARBALL_SCAN");
  }
  if (isSbom) {
    reasons.push("CONTAINER_SBOM_PRESENT");
    findings.push("CONTAINER_SBOM_PRESENT");
  }
  return {
    ok: true,
    sourceClass: "container",
    sourceFormat: ctx.capture.kind === "dir" ? "dir" : ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: "container_adapter_v1",
    counts: {
      ociLayoutPresent: isOciLayout || isOciTarByEntries ? 1 : 0,
      ociTarballPresent: isOciTarByEntries ? 1 : 0,
      tarballScanPresent: isContainerTar ? 1 : 0,
      sbomPresent: isSbom ? 1 : 0,
      composeHintPresent: isCompose ? 1 : 0,
      ociManifestCount,
      ociBlobCount,
      ociManifestDigestRefCount,
      ociManifestDigestResolvedCount,
      tarEntryCount,
      dockerLayerEntryCount,
      dockerManifestMarkerPresent,
      dockerRepositoriesMarkerPresent,
      dockerManifestJsonValid,
      dockerRepositoriesJsonValid,
      dockerRepositoriesTagMapCount,
      dockerManifestConfigRefCount,
      dockerManifestConfigResolvedCount,
      dockerManifestLayerRefCount,
      dockerManifestLayerResolvedCount,
      composeImageRefCount,
      composeServiceHintCount,
      composeServiceChildHintCount,
      composeServiceWithImageOrBuildCount,
      composeBuildHintCount,
      composeServicesBlockCount,
      sbomPackageCount,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findings),
  };
};

const analyzeImage = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  if (!IMAGE_EXTS.has(ctx.ext)) {
    return {
      ok: false,
      failCode: "IMAGE_UNSUPPORTED_FORMAT",
      failMessage: "image adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_UNSUPPORTED_FORMAT"]),
    };
  }
  let fileBytes = 0;
  try {
    fileBytes = Math.max(0, Number(fs.statSync(ctx.inputPath).size || 0));
  } catch {
    fileBytes = 0;
  }
  const markers: string[] = [];
  const { head, tail } = readFileHeadTailBounded(ctx.inputPath, 64 * 1024, 1024);
  const headerBytesRead = head.length + tail.length;
  if (headerBytesRead === 0 && fileBytes > 0) markers.push("IMAGE_HEADER_PARTIAL");

  let isoPvdPresent = 0;
  let isoPvdVersionPresent = 0;
  let isoTerminatorPresent = 0;
  let vhdFooterPresent = 0;
  let vhdxSignaturePresent = 0;
  let qcowMagicPresent = 0;
  let qcowVersion = 0;
  let qcowVersionSupported = 0;
  let vmdkDescriptorHintCount = 0;
  let vmdkDescriptorStructuralPresent = 0;
  let vmdkSparseMagicCount = 0;

  if (ctx.ext === ".iso") {
    const pvdOffset = 16 * 2048;
    const vdstOffset = 17 * 2048;
    if (head.length >= pvdOffset + 7) {
      const sig = head.subarray(pvdOffset + 1, pvdOffset + 6).toString("ascii");
      const type = head[pvdOffset];
      const version = head[pvdOffset + 6];
      if (version === 1) isoPvdVersionPresent = 1;
      if (sig === "CD001" && (type === 1 || type === 2) && version === 1) isoPvdPresent = 1;
      if (head.length >= vdstOffset + 7) {
        const termSig = head.subarray(vdstOffset + 1, vdstOffset + 6).toString("ascii");
        const termType = head[vdstOffset];
        const termVersion = head[vdstOffset + 6];
        if (termSig === "CD001" && termType === 255 && termVersion === 1) isoTerminatorPresent = 1;
      }
    } else {
      markers.push("IMAGE_HEADER_PARTIAL");
    }
  } else if (ctx.ext === ".vhd") {
    if (tail.length >= 512) {
      const footer = tail.subarray(Math.max(0, tail.length - 512), Math.max(0, tail.length - 504)).toString("ascii");
      if (footer === "conectix") vhdFooterPresent = 1;
    } else {
      markers.push("IMAGE_HEADER_PARTIAL");
    }
  } else if (ctx.ext === ".vhdx") {
    if (head.length >= 8) {
      if (head.subarray(0, 8).toString("ascii").toLowerCase() === "vhdxfile") vhdxSignaturePresent = 1;
    } else {
      markers.push("IMAGE_HEADER_PARTIAL");
    }
  } else if (ctx.ext === ".qcow2") {
    if (head.length >= 8) {
      const magic = head.subarray(0, 4);
      if (magic[0] === 0x51 && magic[1] === 0x46 && magic[2] === 0x49 && magic[3] === 0xfb) qcowMagicPresent = 1;
      qcowVersion = head.readUInt32BE(4);
      if (qcowVersion === 2 || qcowVersion === 3) qcowVersionSupported = 1;
    } else {
      markers.push("IMAGE_HEADER_PARTIAL");
    }
  } else if (ctx.ext === ".vmdk") {
    const text = head.toString("utf8");
    const hasDescriptorBanner = /#\s*disk\s+descriptorfile/i.test(text);
    const hasCreateType = /createType\s*=/i.test(text);
    const hasExtentLine = /\b(RW|RDONLY|NOACCESS)\s+\d+\s+[A-Z0-9_]+\s+/i.test(text);
    vmdkDescriptorHintCount = (hasDescriptorBanner ? 1 : 0) + (hasCreateType ? 1 : 0) + (hasExtentLine ? 1 : 0);
    if (hasDescriptorBanner && hasCreateType && hasExtentLine) vmdkDescriptorStructuralPresent = 1;
    const sparseMagic = Buffer.from("KDMV", "ascii");
    vmdkSparseMagicCount = countBufferPatternV1(head, sparseMagic);
    if (vmdkDescriptorStructuralPresent === 0 && vmdkSparseMagicCount === 0 && fileBytes > 0) markers.push("IMAGE_HEADER_PARTIAL");
  }

  const headerMatchCount =
    isoPvdPresent +
    vhdFooterPresent +
    vhdxSignaturePresent +
    (qcowMagicPresent > 0 && qcowVersionSupported > 0 ? 1 : 0) +
    (vmdkDescriptorStructuralPresent > 0 || vmdkSparseMagicCount > 0 ? 1 : 0);
  if (fileBytes > 0 && headerMatchCount === 0) {
    return {
      ok: false,
      failCode: "IMAGE_FORMAT_MISMATCH",
      failMessage: "image adapter detected extension/header mismatch for explicit image analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_FORMAT_MISMATCH"]),
    };
  }
  if (strictRoute && ctx.ext === ".qcow2" && qcowMagicPresent > 0 && qcowVersionSupported > 0 && fileBytes < 72) {
    return {
      ok: false,
      failCode: "IMAGE_FORMAT_MISMATCH",
      failMessage: "image adapter requires minimum qcow2 header size for explicit image analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_FORMAT_MISMATCH"]),
    };
  }
  if (strictRoute && ctx.ext === ".vhdx" && vhdxSignaturePresent > 0 && fileBytes < 64 * 1024) {
    return {
      ok: false,
      failCode: "IMAGE_FORMAT_MISMATCH",
      failMessage: "image adapter requires minimum vhdx structural size for explicit image analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_FORMAT_MISMATCH"]),
    };
  }
  if (strictRoute && ctx.ext === ".vhd" && vhdFooterPresent > 0 && fileBytes < 1024) {
    return {
      ok: false,
      failCode: "IMAGE_FORMAT_MISMATCH",
      failMessage: "image adapter requires minimum vhd structural size for explicit image analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_FORMAT_MISMATCH"]),
    };
  }
  if (strictRoute && ctx.ext === ".iso" && (isoPvdPresent === 0 || isoTerminatorPresent === 0)) {
    return {
      ok: false,
      failCode: "IMAGE_FORMAT_MISMATCH",
      failMessage: "image adapter requires ISO primary descriptor and terminator evidence for explicit image analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_FORMAT_MISMATCH"]),
    };
  }
  if (
    strictRoute &&
    ctx.ext === ".vmdk" &&
    vmdkDescriptorStructuralPresent > 0 &&
    vmdkSparseMagicCount === 0 &&
    fileBytes < 64
  ) {
    return {
      ok: false,
      failCode: "IMAGE_FORMAT_MISMATCH",
      failMessage: "image adapter requires minimum vmdk descriptor size for explicit image analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_FORMAT_MISMATCH"]),
    };
  }
  markers.push("IMAGE_TABLE_TRUNCATED");

  return {
    ok: true,
    sourceClass: "image",
    sourceFormat: ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: "image_adapter_v1",
    counts: {
      fileBytesBounded: fileBytes,
      headerBytesRead,
      headerMatchCount,
      isoPvdPresent,
      isoPvdVersionPresent,
      isoTerminatorPresent,
      vhdFooterPresent,
      vhdxSignaturePresent,
      qcowMagicPresent,
      qcowVersion,
      qcowVersionSupported,
      vmdkDescriptorHintCount,
      vmdkDescriptorStructuralPresent,
      vmdkSparseMagicCount,
      imageTableEntries: 0,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_TABLE_TRUNCATED"]),
    findingCodes: stableSortUniqueReasonsV0(["IMAGE_TABLE_TRUNCATED"]),
  };
};

const analyzeScm = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  if (!isDirectory(ctx.inputPath) || !fs.existsSync(path.join(ctx.inputPath, ".git"))) {
    return {
      ok: false,
      failCode: "SCM_UNSUPPORTED_FORMAT",
      failMessage: "scm adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_UNSUPPORTED_FORMAT"]),
    };
  }
  const rev = runCommandLines("git", ["-C", ctx.inputPath, "rev-parse", "HEAD"]);
  const markers: string[] = [];
  const countWorkingTreeEntries = () =>
    ctx.capture.entries
      .map((entry) => String(entry.path || "").replace(/\\/g, "/"))
      .filter((p) => p.length > 0 && !p.startsWith(".git/"))
      .length;
  if (!rev.ok || rev.lines.length === 0) {
    const fallback = readNativeScmFallbackV1(ctx.inputPath);
    if (strictRoute && fallback.commitResolved === 0 && fallback.branchRefCount === 0 && fallback.tagRefCount === 0) {
      return {
        ok: false,
        failCode: "SCM_REF_UNRESOLVED",
        failMessage: "scm adapter expected resolvable git reference evidence for explicit scm analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_REF_UNRESOLVED"]),
      };
    }
    if (strictRoute && fallback.partial) {
      return {
        ok: false,
        failCode: "SCM_REF_UNRESOLVED",
        failMessage: "scm adapter expected complete git reference metadata for explicit scm analysis.",
        reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_REF_UNRESOLVED"]),
      };
    }
    if (fallback.partial) markers.push("SCM_NATIVE_REF_PARTIAL");
    return {
      ok: true,
      sourceClass: "scm",
      sourceFormat: "git",
      mode: "built_in",
      adapterId: "scm_adapter_v1",
      counts: {
        commitResolved: fallback.commitResolved,
        detachedHead: fallback.detachedHead,
        treeEntryCount: 0,
        branchRefCount: fallback.branchRefCount,
        tagRefCount: fallback.tagRefCount,
        worktreeDirty: 0,
        stagedPathCount: 0,
        unstagedPathCount: 0,
        untrackedPathCount: 0,
        workingTreeEntryCount: countWorkingTreeEntries(),
      },
      markers: stableSortUniqueStringsV0(markers),
      reasonCodes: stableSortUniqueReasonsV0([
        "SCM_ADAPTER_V1",
        fallback.commitResolved > 0 ? "SCM_TREE_CAPTURED" : "SCM_REF_UNRESOLVED",
      ]),
      findingCodes: stableSortUniqueReasonsV0([
        fallback.commitResolved > 0 ? "SCM_TREE_CAPTURED" : "SCM_REF_UNRESOLVED",
      ]),
    };
  }
  const branch = runCommandLines("git", ["-C", ctx.inputPath, "rev-parse", "--abbrev-ref", "HEAD"]);
  const headDetached = branch.ok && branch.lines[0] === "HEAD" ? 1 : 0;
  if (!branch.ok || branch.lines.length === 0) markers.push("SCM_REF_PARTIAL");

  const tree = runCommandLines("git", ["-C", ctx.inputPath, "ls-tree", "-r", "--name-only", "HEAD"]);
  const treeEntryCount = tree.ok ? tree.lines.length : 0;
  if (!tree.ok) markers.push("SCM_TREE_PARTIAL");

  const branches = runCommandLines("git", ["-C", ctx.inputPath, "for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  const tags = runCommandLines("git", ["-C", ctx.inputPath, "for-each-ref", "--format=%(refname:short)", "refs/tags"]);
  const branchRefCount = branches.ok ? branches.lines.length : 0;
  const tagRefCount = tags.ok ? tags.lines.length : 0;
  if (!branches.ok || !tags.ok) markers.push("SCM_REFS_PARTIAL");

  const status = runCommandLinesRaw("git", ["-C", ctx.inputPath, "status", "--porcelain=1", "--untracked-files=all"]);
  let stagedPathCount = 0;
  let unstagedPathCount = 0;
  let untrackedPathCount = 0;
  if (status.ok) {
    status.lines.forEach((line) => {
      if (line.length < 2) return;
      const x = line[0];
      const y = line[1];
      if (x === "?" && y === "?") {
        untrackedPathCount += 1;
        return;
      }
      if (x !== " " && x !== "?") stagedPathCount += 1;
      if (y !== " " && y !== "?") unstagedPathCount += 1;
    });
  } else {
    markers.push("SCM_STATUS_PARTIAL");
  }
  const worktreeDirty = stagedPathCount + unstagedPathCount + untrackedPathCount > 0 ? 1 : 0;
  const reasonCodes = ["SCM_ADAPTER_V1", "SCM_TREE_CAPTURED"];
  const findingCodes = ["SCM_TREE_CAPTURED"];
  if (worktreeDirty > 0) {
    reasonCodes.push("SCM_WORKTREE_DIRTY");
    findingCodes.push("SCM_WORKTREE_DIRTY");
  }
  if (strictRoute && markers.length > 0) {
    return {
      ok: false,
      failCode: "SCM_REF_UNRESOLVED",
      failMessage: "scm adapter expected complete git reference and status metadata for explicit scm analysis.",
      reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_REF_UNRESOLVED"]),
    };
  }

  return {
    ok: true,
    sourceClass: "scm",
    sourceFormat: "git",
    mode: "built_in",
    adapterId: "scm_adapter_v1",
    counts: {
      commitResolved: 1,
      detachedHead: headDetached,
      treeEntryCount,
      branchRefCount,
      tagRefCount,
      worktreeDirty,
      stagedPathCount,
      unstagedPathCount,
      untrackedPathCount,
      workingTreeEntryCount: countWorkingTreeEntries(),
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
    findingCodes: stableSortUniqueReasonsV0(findingCodes),
  };
};

const analyzeSignature = (ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  if (!SIGNATURE_EXTS.has(ctx.ext)) {
    return {
      ok: false,
      failCode: "SIGNATURE_UNSUPPORTED_FORMAT",
      failMessage: "signature adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["SIGNATURE_ADAPTER_V1", "SIGNATURE_UNSUPPORTED_FORMAT"]),
    };
  }
  const text = readTextBounded(ctx.inputPath);
  const bytes = readBytesBounded(ctx.inputPath);
  const pemCertificateEnvelope = pemEnvelopeEvidenceV1(text, "CERTIFICATE");
  const pemPkcs7Envelope = pemEnvelopeEvidenceV1(text, "PKCS7");
  const pemSignatureEnvelope = pemEnvelopeEvidenceV1(text, "SIGNATURE");
  const pemCertificateCount = pemCertificateEnvelope.valid;
  const pemPkcs7Count = pemPkcs7Envelope.valid;
  const pemSignatureCount = pemSignatureEnvelope.valid;
  const pemEnvelopeInvalidCount = pemCertificateEnvelope.invalid + pemPkcs7Envelope.invalid + pemSignatureEnvelope.invalid;
  const textualTimestampCount = countMatchesV1(text, /\b(timestamp|time[\s_-]?stamp|tsa|countersignature)\b/gi);
  const textualChainHintCount = countMatchesV1(text, /\b(certificate[\s_-]?chain|intermediate|root[\s_-]?ca)\b/gi);

  const OID_CMS_SIGNED_DATA = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]); // 1.2.840.113549.1.7.2
  const OID_TIMESTAMP_EKU = Buffer.from([0x06, 0x08, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x08]); // 1.3.6.1.5.5.7.3.8
  const OID_X509_NAME_ATTR = Buffer.from([0x06, 0x03, 0x55, 0x04]); // 2.5.4.*
  const cmsSignedDataOidCount = countBufferPatternV1(bytes, OID_CMS_SIGNED_DATA);
  const timestampOidCount = countBufferPatternV1(bytes, OID_TIMESTAMP_EKU);
  const x509NameOidCount = countBufferPatternV1(bytes, OID_X509_NAME_ATTR);

  const strongEnvelopeEvidence = pemCertificateCount + pemPkcs7Count + pemSignatureCount + cmsSignedDataOidCount > 0;
  const signerPresent = strongEnvelopeEvidence || /BEGIN CERTIFICATE|BEGIN PKCS7|BEGIN SIGNATURE/i.test(text);
  const chainPresent = pemCertificateCount >= 2 || textualChainHintCount > 0;
  const timestampPresent = textualTimestampCount > 0 || timestampOidCount > 0;
  if (strictRoute) {
    const looksAsn1Der = isLikelyDerSequenceV1(bytes);
    const derEvidenceStrong =
      looksAsn1Der &&
      (cmsSignedDataOidCount > 0 || ((ctx.ext === ".cer" || ctx.ext === ".crt") && bytes.length >= 128 && x509NameOidCount > 0));
    const strictEvidencePresent = strongEnvelopeEvidence || derEvidenceStrong;
    const strictExtEvidenceOk =
      ctx.ext === ".cer" || ctx.ext === ".crt"
        ? pemCertificateCount > 0 || derEvidenceStrong
        : ctx.ext === ".p7b"
          ? pemPkcs7Count > 0 || cmsSignedDataOidCount > 0
          : ctx.ext === ".sig"
            ? pemSignatureCount > 0 || cmsSignedDataOidCount > 0
            : true;
    if (!strictEvidencePresent) {
      return {
        ok: false,
        failCode: "SIGNATURE_FORMAT_MISMATCH",
        failMessage: "signature adapter expected certificate/signature envelope or ASN.1 signature material for explicit route.",
        reasonCodes: stableSortUniqueReasonsV0(["SIGNATURE_ADAPTER_V1", "SIGNATURE_FORMAT_MISMATCH"]),
      };
    }
    if (!strictExtEvidenceOk) {
      return {
        ok: false,
        failCode: "SIGNATURE_FORMAT_MISMATCH",
        failMessage: "signature adapter expected envelope evidence compatible with file extension for explicit route.",
        reasonCodes: stableSortUniqueReasonsV0(["SIGNATURE_ADAPTER_V1", "SIGNATURE_FORMAT_MISMATCH"]),
      };
    }
  }
  const reasons = ["SIGNATURE_EVIDENCE_V1"];
  const markers: string[] = [];
  if (bytes.length >= MAX_TEXT_BYTES) markers.push("SIGNATURE_BOUNDED");
  if (pemEnvelopeInvalidCount > 0) markers.push("SIGNATURE_ENVELOPE_PARTIAL");
  if (!signerPresent && text.length === 0 && bytes.length > 0) markers.push("SIGNATURE_PARSE_PARTIAL");
  if (signerPresent) reasons.push("SIGNER_PRESENT");
  if (chainPresent) reasons.push("CHAIN_PRESENT");
  if (timestampPresent) reasons.push("TIMESTAMP_PRESENT");
  const findingCodes: string[] = [];
  if (signerPresent) findingCodes.push("SIGNER_PRESENT");
  if (chainPresent) findingCodes.push("CHAIN_PRESENT");
  if (timestampPresent) findingCodes.push("TIMESTAMP_PRESENT");
  return {
    ok: true,
    sourceClass: "signature",
    sourceFormat: ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: "signature_adapter_v1",
    counts: {
      signerPresent: signerPresent ? 1 : 0,
      chainPresent: chainPresent ? 1 : 0,
      timestampPresent: timestampPresent ? 1 : 0,
      pemCertificateCount,
      pemPkcs7Count,
      pemSignatureCount,
      cmsSignedDataOidCount,
      x509NameOidCount,
      timestampTokenCount: textualTimestampCount,
      timestampOidCount,
      chainHintCount: textualChainHintCount,
    },
    markers: stableSortUniqueStringsV0(markers),
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findingCodes),
  };
};

const autoSelectClass = (ctx: AnalyzeCtx): AdapterClassV1 | null => {
  const ext = ctx.ext;
  const base = path.basename(ctx.inputPath).toLowerCase();
  const hasCicdPathHint =
    base === ".gitlab-ci.yml" ||
    base.startsWith("azure-pipelines") ||
    hasAnyPath(ctx.capture, [".github/workflows/", ".gitlab-ci", "azure-pipelines"]);
  if (EXTENSION_EXTS.has(ext) || (isDirectory(ctx.inputPath) && fs.existsSync(path.join(ctx.inputPath, "manifest.json")))) return "extension";
  if (PACKAGE_EXTS.has(ext)) return "package";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  if (hasCicdPathHint) return "cicd";
  if (IAC_EXTS.has(ext)) return "iac";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  if (SIGNATURE_EXTS.has(ext)) return "signature";
  if (isDirectory(ctx.inputPath) && fs.existsSync(path.join(ctx.inputPath, ".git"))) return "scm";
  if (/sbom|spdx|cyclonedx|bom/.test(base) || hasAnyPath(ctx.capture, ["oci-layout", "docker-compose", "compose.yaml"])) return "container";
  if (IMAGE_EXTS.has(ext)) return "image";
  return null;
};

const analyzeByClass = (adapterClass: AdapterClassV1, ctx: AnalyzeCtx, strictRoute: boolean): AnalyzeResult => {
  if (adapterClass === "archive") return analyzeArchive(ctx, strictRoute);
  if (adapterClass === "package") return analyzePackage(ctx, strictRoute);
  if (adapterClass === "extension") return analyzeExtension(ctx, strictRoute);
  if (adapterClass === "iac" || adapterClass === "cicd") return analyzeIacCicd(ctx, adapterClass);
  if (adapterClass === "document") return analyzeDocument(ctx, strictRoute);
  if (adapterClass === "container") return analyzeContainer(ctx, strictRoute);
  if (adapterClass === "image") return analyzeImage(ctx, strictRoute);
  if (adapterClass === "scm") return analyzeScm(ctx, strictRoute);
  if (adapterClass === "signature") return analyzeSignature(ctx, strictRoute);
  return {
    ok: false,
    failCode: "ADAPTER_UNSUPPORTED",
    failMessage: "adapter class unsupported.",
    reasonCodes: ["ADAPTER_UNSUPPORTED"],
  };
};

const adapterSupportsPlugins = (adapterClass: AdapterClassV1): boolean => adapterClass === "archive";

const allowedArchivePluginsForExt = (ext: string): Set<string> | null => {
  if (ext === ".zip" || ext === ".tar") return new Set<string>();
  if (ext === ".tar.gz" || ext === ".tgz" || ext === ".tar.bz2" || ext === ".tar.xz" || ext === ".txz") {
    return new Set<string>(["tar"]);
  }
  if (ext === ".7z") return new Set<string>(["7z"]);
  return null;
};

export const runArtifactAdapterV1 = (options: AdapterRunOptionsV1): AdapterRunResultV1 => {
  const selection = options.selection;
  const normalizedPlugins = (options.enabledPlugins || [])
    .map((name) => String(name || "").trim().toLowerCase())
    .filter((name) => name.length > 0);
  const duplicatePlugins = Array.from(
    normalizedPlugins.reduce((acc, name) => {
      acc.set(name, (acc.get(name) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  )
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort((a, b) => cmpStrV0(a, b));
  const requestedPlugins = stableSortUniqueStringsV0(normalizedPlugins);
  const unknownPlugins = requestedPlugins.filter((name) => !KNOWN_PLUGIN_NAMES.has(name));
  if (unknownPlugins.length > 0) {
    return {
      ok: false,
      failCode: "ADAPTER_PLUGIN_UNKNOWN",
      failMessage: `unknown plugin name(s): ${unknownPlugins.join(", ")}`,
      reasonCodes: stableSortUniqueReasonsV0(["ADAPTER_PLUGIN_UNKNOWN"]),
    };
  }
  if (duplicatePlugins.length > 0) {
    return {
      ok: false,
      failCode: "ADAPTER_PLUGIN_DUPLICATE",
      failMessage: `duplicate plugin name(s): ${duplicatePlugins.join(", ")}`,
      reasonCodes: stableSortUniqueReasonsV0(["ADAPTER_PLUGIN_DUPLICATE"]),
    };
  }
  if (selection === "none") {
    if (requestedPlugins.length > 0) {
      return {
        ok: false,
        failCode: "ADAPTER_PLUGIN_UNUSED",
        failMessage: "plugins are not allowed when --adapter none is selected.",
        reasonCodes: stableSortUniqueReasonsV0(["ADAPTER_PLUGIN_UNUSED"]),
      };
    }
    return { ok: true, reasonCodes: [] };
  }
  const enabledPlugins = new Set(requestedPlugins);
  const inputPath = path.resolve(process.cwd(), options.inputPath || "");
  const ctx: AnalyzeCtx = {
    inputPath,
    ext: normalizeExtV1(inputPath),
    capture: options.capture,
    enabledPlugins,
  };

  const adapterClass: AdapterClassV1 | null =
    selection === "auto" ? autoSelectClass(ctx) : (selection as AdapterClassV1);
  if (!adapterClass) {
    if (requestedPlugins.length > 0) {
      return {
        ok: false,
        failCode: "ADAPTER_PLUGIN_UNUSED",
        failMessage: "plugins are not allowed when --adapter auto has no matching adapter class.",
        reasonCodes: stableSortUniqueReasonsV0(["ADAPTER_PLUGIN_UNUSED"]),
      };
    }
    return { ok: true, reasonCodes: [] };
  }
  if (requestedPlugins.length > 0 && !adapterSupportsPlugins(adapterClass)) {
    return {
      ok: false,
      failCode: "ADAPTER_PLUGIN_UNUSED",
      failMessage: `plugins are not supported when --adapter ${adapterClass} is selected.`,
      reasonCodes: stableSortUniqueReasonsV0(["ADAPTER_PLUGIN_UNUSED"]),
    };
  }
  if (requestedPlugins.length > 0 && adapterClass === "archive") {
    const allowedPlugins = allowedArchivePluginsForExt(ctx.ext);
    if (allowedPlugins !== null) {
      const unusedPlugins = requestedPlugins.filter((name) => !allowedPlugins.has(name));
      if (unusedPlugins.length > 0) {
        return {
          ok: false,
          failCode: "ADAPTER_PLUGIN_UNUSED",
          failMessage: `plugin name(s) are not applicable for this archive format: ${unusedPlugins.join(", ")}`,
          reasonCodes: stableSortUniqueReasonsV0(["ADAPTER_PLUGIN_UNUSED"]),
        };
      }
    }
  }

  const analyzed = analyzeByClass(adapterClass, ctx, selection !== "auto");
  if (!analyzed.ok) {
    return {
      ok: false,
      failCode: analyzed.failCode,
      failMessage: analyzed.failMessage,
      reasonCodes: stableSortUniqueReasonsV0(analyzed.reasonCodes),
    };
  }

  const summary = toSummary(analyzed);
  const findings = toFindings(analyzed);
  const reasonCodes = stableSortUniqueReasonsV0(analyzed.reasonCodes);
  return {
    ok: true,
    reasonCodes,
    adapter: {
      adapterId: analyzed.adapterId,
      sourceFormat: analyzed.sourceFormat,
      mode: analyzed.mode,
      reasonCodes,
    },
    summary,
    findings,
    adapterSignals: {
      class: analyzed.sourceClass,
      counts: sortCountRecord(analyzed.counts),
      markers: stableSortUniqueStringsV0(analyzed.markers),
    },
  };
};

export const listAdaptersV1 = (): AdapterListReportV1 => {
  const tarAvailable = commandAvailable("tar");
  const sevenAvailable = commandAvailable("7z");
  const adapters: AdapterListItemV1[] = [
    {
      adapter: "archive",
      mode: "mixed",
      plugins: [
        { name: "tar", available: tarAvailable },
        { name: "7z", available: sevenAvailable },
      ],
      formats: [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz", ".txz", ".7z"],
    },
    {
      adapter: "package",
      mode: "mixed",
      plugins: [{ name: "tar", available: tarAvailable }],
      formats: [".msi", ".msix", ".exe", ".nupkg", ".whl", ".jar", ".tar.gz", ".tgz", ".tar.xz", ".txz", ".deb", ".rpm", ".appimage", ".pkg", ".dmg"],
    },
    {
      adapter: "extension",
      mode: "built_in",
      plugins: [],
      formats: [".crx", ".vsix", ".xpi", "manifest.json (directory)"],
    },
    {
      adapter: "iac",
      mode: "built_in",
      plugins: [],
      formats: [".tf", ".tfvars", ".hcl", ".yaml", ".yml", ".json", ".bicep"],
    },
    {
      adapter: "cicd",
      mode: "built_in",
      plugins: [],
      formats: [".github/workflows/*.yml", ".gitlab-ci.yml", "azure-pipelines*.yml"],
    },
    {
      adapter: "document",
      mode: "built_in",
      plugins: [],
      formats: [".pdf", ".docm", ".xlsm", ".rtf", ".chm"],
    },
    {
      adapter: "container",
      mode: "built_in",
      plugins: [],
      formats: ["oci-layout dir", "compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml", "sbom/spdx/cyclonedx"],
    },
    {
      adapter: "image",
      mode: "built_in",
      plugins: [],
      formats: [".iso", ".vhd", ".vhdx", ".vmdk", ".qcow2"],
    },
    {
      adapter: "scm",
      mode: "built_in",
      plugins: [],
      formats: ["git working tree (.git)"],
    },
    {
      adapter: "signature",
      mode: "built_in",
      plugins: [],
      formats: [".cer", ".crt", ".pem", ".p7b", ".sig"],
    },
  ];
  adapters.sort((a, b) => cmpStrV0(a.adapter, b.adapter));
  adapters.forEach((item) => {
    item.formats = item.formats.slice().sort((a, b) => cmpStrV0(a, b));
    item.plugins = item.plugins.slice().sort((a, b) => cmpStrV0(a.name, b.name));
  });
  return {
    schema: "weftend.adapterList/0",
    schemaVersion: 0,
    adapters,
  };
};
