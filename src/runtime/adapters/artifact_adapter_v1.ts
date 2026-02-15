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

const MAX_LIST_ITEMS = 20000;
const MAX_FINDING_CODES = 128;
const MAX_TEXT_BYTES = 256 * 1024;

const ARCHIVE_EXTS = new Set([".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".7z"]);
const PACKAGE_EXTS = new Set([".msi", ".msix", ".exe", ".nupkg", ".whl", ".jar", ".tar.gz", ".tgz"]);
const EXTENSION_EXTS = new Set([".crx", ".vsix"]);
const IAC_EXTS = new Set([".tf", ".tfvars", ".hcl", ".yaml", ".yml", ".json", ".bicep", ".template"]);
const DOCUMENT_EXTS = new Set([".pdf", ".docm", ".xlsm", ".rtf", ".chm"]);
const IMAGE_EXTS = new Set([".iso", ".vhd", ".vhdx", ".vmdk", ".qcow2"]);
const SIGNATURE_EXTS = new Set([".cer", ".crt", ".pem", ".p7b", ".sig"]);

const normalizeExtV1 = (inputPath: string): string => {
  const base = path.basename(String(inputPath || "")).toLowerCase();
  if (base.endsWith(".tar.gz")) return ".tar.gz";
  if (base.endsWith(".tar.bz2")) return ".tar.bz2";
  if (base.endsWith(".tgz")) return ".tgz";
  return path.extname(base).toLowerCase();
};

export type AdapterSelectionV1 = "auto" | "none" | "archive" | "package" | "extension" | "iac" | "image";
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

const readZipEntriesFromBuffer = (buffer: Uint8Array): { entries: string[]; markers: string[] } => {
  const view = Buffer.from(buffer);
  const markers: string[] = [];
  const entries: string[] = [];
  if (view.length < 22) return { entries, markers: ["ARCHIVE_METADATA_PARTIAL"] };

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
  if (eocdOffset < 0) return { entries, markers: ["ARCHIVE_METADATA_PARTIAL"] };

  const cdCount = view.readUInt16LE(eocdOffset + 10);
  const cdOffsetRaw = view.readUInt32LE(eocdOffset + 16);
  const cdOffsetCandidate = cdOffsetRaw;
  const cdOffsetAlt = firstLocalOffset + cdOffsetRaw;
  let cdOffset = cdOffsetCandidate;
  if (cdOffset + 4 > view.length || view.readUInt32LE(cdOffset) !== sigCD) {
    if (cdOffsetAlt + 4 <= view.length && view.readUInt32LE(cdOffsetAlt) === sigCD) {
      cdOffset = cdOffsetAlt;
    } else {
      return { entries, markers: ["ARCHIVE_METADATA_PARTIAL"] };
    }
  }

  let offset = cdOffset;
  for (let i = 0; i < cdCount; i += 1) {
    if (entries.length >= MAX_LIST_ITEMS) {
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
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > view.length) {
      markers.push("ARCHIVE_METADATA_PARTIAL");
      break;
    }
    const name = view.slice(nameStart, nameEnd).toString("utf8").replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (name && !name.endsWith("/")) entries.push(name);
    offset = nameStart + nameLen + extraLen + commentLen;
  }

  entries.sort((a, b) => cmpStrV0(a, b));
  return { entries: stableSortUniqueStringsV0(entries), markers: stableSortUniqueStringsV0(markers) };
};

const readZipEntries = (inputPath: string): { entries: string[]; markers: string[] } => {
  try {
    const buf = fs.readFileSync(inputPath);
    return readZipEntriesFromBuffer(buf);
  } catch {
    return { entries: [], markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
};

const readTarEntries = (inputPath: string): { entries: string[]; markers: string[] } => {
  const markers: string[] = [];
  const entries: string[] = [];
  let buf: Uint8Array;
  try {
    buf = fs.readFileSync(inputPath);
  } catch {
    return { entries, markers: ["ARCHIVE_METADATA_PARTIAL"] };
  }
  let offset = 0;
  while (offset + 512 <= buf.length) {
    if (entries.length >= MAX_LIST_ITEMS) {
      markers.push("ARCHIVE_TRUNCATED");
      break;
    }
    const block = Buffer.from(buf.subarray(offset, offset + 512));
    const empty = block.every((b: number) => b === 0);
    if (empty) break;
    const nameRaw = block.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefixRaw = block.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const sizeRaw = block.slice(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeRaw || "0", 8);
    const fullName = `${prefixRaw ? `${prefixRaw}/` : ""}${nameRaw}`.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (fullName && !fullName.endsWith("/")) entries.push(fullName);
    const dataSize = Number.isFinite(size) && size > 0 ? size : 0;
    const advance = 512 + Math.ceil(dataSize / 512) * 512;
    offset += advance;
  }
  if (offset < buf.length && entries.length === 0) markers.push("ARCHIVE_METADATA_PARTIAL");
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
const analyzeArchive = (ctx: AnalyzeCtx): AnalyzeResult => {
  const reasonCodes = ["ARCHIVE_ADAPTER_V1"];
  const markers: string[] = [];
  const ext = ctx.ext;
  let mode: AdapterModeV1 = "built_in";
  let entries: string[] = [];

  if (ext === ".zip") {
    if (ctx.capture.kind === "zip") {
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
  } else if (ext === ".tar.gz" || ext === ".tgz" || ext === ".tar.bz2") {
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

const analyzePackage = (ctx: AnalyzeCtx): AnalyzeResult => {
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

  const installerExt = ext === ".msi" || ext === ".msix" || ext === ".exe";
  if (installerExt) {
    reasonCodes.push("EXECUTION_WITHHELD_INSTALLER");
    markers.push("PACKAGE_SIGNING_INFO_UNAVAILABLE");
  }

  let entryNames: string[] = [];
  if (ext === ".nupkg" || ext === ".whl" || ext === ".jar") {
    const zip = readZipEntries(ctx.inputPath);
    entryNames = zip.entries;
    markers.push(...zip.markers);
    if (entryNames.length === 0) reasonCodes.push("PACKAGE_METADATA_PARTIAL");
  } else if (ext === ".tar.gz" || ext === ".tgz") {
    if (ctx.enabledPlugins.has("tar") && commandAvailable("tar")) {
      mode = "plugin";
      const tarList = runCommandLines("tar", ["-tf", ctx.inputPath]);
      if (tarList.ok) {
        entryNames = stableSortUniqueStringsV0(tarList.lines);
      } else {
        reasonCodes.push("PACKAGE_METADATA_PARTIAL");
      }
    } else {
      reasonCodes.push("PACKAGE_METADATA_PARTIAL");
      markers.push("PACKAGE_PLUGIN_TAR_NOT_ENABLED");
    }
  }

  const manifestNames = new Set([
    "package.json",
    "manifest.json",
    "appxmanifest.xml",
    "nuspec",
    "metadata",
    "pkg-info",
    "pom.xml",
    "setup.py",
  ]);
  const scriptIndicators = new Set(["preinstall", "postinstall", "install.ps1", "setup.py", "scripts/"]);
  const permissionIndicators = new Set(["permission", "capability", "policy"]);
  let manifestCount = 0;
  let scriptCount = 0;
  let permissionCount = 0;

  entryNames.forEach((entry) => {
    const lower = entry.toLowerCase();
    const base = path.basename(lower);
    if (manifestNames.has(base)) manifestCount += 1;
    if (Array.from(scriptIndicators).some((hint) => lower.includes(hint))) scriptCount += 1;
    if (Array.from(permissionIndicators).some((hint) => lower.includes(hint))) permissionCount += 1;
  });

  if (manifestCount > 0) findingCodes.push("PACKAGE_MANIFEST_PRESENT");
  if (scriptCount > 0) findingCodes.push("PACKAGE_SCRIPT_HINT_PRESENT");
  if (permissionCount > 0) findingCodes.push("PACKAGE_PERMISSION_HINT_PRESENT");
  if (markers.length > 0) reasonCodes.push("PACKAGE_METADATA_PARTIAL");
  if (markers.includes("PACKAGE_SIGNING_INFO_UNAVAILABLE")) reasonCodes.push("PACKAGE_SIGNING_INFO_UNAVAILABLE");

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
    };
  }
  const permissions = Array.isArray(parsed?.permissions) ? parsed.permissions : [];
  const hostPermissions = Array.isArray(parsed?.host_permissions) ? parsed.host_permissions : [];
  const contentScripts = Array.isArray(parsed?.content_scripts) ? parsed.content_scripts : [];
  const updateDomain = parsed?.update_url ? toDomain(String(parsed.update_url)) : null;
  return {
    manifestFound: true,
    manifestInvalid: false,
    permissionCount: permissions.length + hostPermissions.length,
    contentScriptCount: contentScripts.length,
    hostMatchCount: hostPermissions.filter((value: unknown) => typeof value === "string").length,
    updateDomains: updateDomain ? [updateDomain] : [],
  };
};

const analyzeExtension = (ctx: AnalyzeCtx): AnalyzeResult => {
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

  if (isDir) {
    const dir = analyzeExtensionDir(ctx.inputPath);
    manifestFound = dir.manifestFound;
    manifestInvalid = dir.manifestInvalid;
    permissionCount = dir.permissionCount;
    contentScriptCount = dir.contentScriptCount;
    hostMatchCount = dir.hostMatchCount;
    updateDomains = dir.updateDomains;
  } else {
    const zip = readZipEntries(ctx.inputPath);
    manifestFound = zip.entries.some((entry) => path.basename(entry).toLowerCase() === "manifest.json");
    if (!manifestFound) markers.push("EXTENSION_MANIFEST_MISSING");
    else markers.push("EXTENSION_MANIFEST_PARTIAL");
  }

  if (!manifestFound) reasonCodes.push("EXTENSION_MANIFEST_MISSING");
  if (manifestInvalid) reasonCodes.push("EXTENSION_MANIFEST_INVALID");
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
const analyzeIacCicd = (ctx: AnalyzeCtx): AnalyzeResult => {
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
  let privileged = 0;
  let secretRefs = 0;
  let remoteModuleRefs = 0;
  let unpinnedActionRefs = 0;
  let cicdSecretUsage = 0;
  let externalRunnerRefs = 0;

  const scanText = (text: string) => {
    if (/\bprivileged\s*:\s*true\b/i.test(text) || /\bhostnetwork\s*:\s*true\b/i.test(text)) privileged += 1;
    if (/\b(secret|secrets|password|token)\b/i.test(text)) secretRefs += 1;
    if (/\b(source|module)\s*=\s*["'](?:https?:\/\/|git::)/i.test(text)) remoteModuleRefs += 1;
    if (/uses\s*:\s*[^@\s]+@(main|master|latest)\b/i.test(text)) unpinnedActionRefs += 1;
    if (/\$\{\{\s*secrets\./i.test(text) || /\bCI_[A-Z0-9_]+\b/.test(text)) cicdSecretUsage += 1;
    if (/docker:\/\/|runs-on:\s*self-hosted/i.test(text)) externalRunnerRefs += 1;
  };

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

  const sourceClass: AdapterClassV1 =
    unpinnedActionRefs + cicdSecretUsage + externalRunnerRefs > 0 ? "cicd" : "iac";

  return {
    ok: true,
    sourceClass,
    sourceFormat: ctx.capture.kind === "dir" ? "dir" : ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: sourceClass === "cicd" ? "cicd_adapter_v1" : "iac_adapter_v1",
    counts: {
      filesScanned: files.length,
      privilegedPatternCount: privileged,
      secretPatternCount: secretRefs,
      remoteModulePatternCount: remoteModuleRefs,
      cicdUnpinnedActionCount: unpinnedActionRefs,
      cicdSecretUsageCount: cicdSecretUsage,
      cicdExternalRunnerCount: externalRunnerRefs,
    },
    markers: [],
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findings),
  };
};

const analyzeDocument = (ctx: AnalyzeCtx): AnalyzeResult => {
  if (!DOCUMENT_EXTS.has(ctx.ext)) {
    return {
      ok: false,
      failCode: "DOC_UNSUPPORTED_FORMAT",
      failMessage: "document adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["DOC_ADAPTER_V1", "DOC_UNSUPPORTED_FORMAT"]),
    };
  }
  const text = readTextBounded(ctx.inputPath);
  const reasons = ["DOC_ADAPTER_V1"];
  const findings: string[] = [];
  let activeContent = 0;
  let embeddedObject = 0;
  let externalLink = 0;
  if (/\b(vba|macro|autoopen|autorun|javascript)\b/i.test(text)) activeContent += 1;
  if (/EmbeddedFile|ObjStm|\/Object|Ole/i.test(text)) embeddedObject += 1;
  if (extractDomains(text).length > 0) externalLink += 1;
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
    markers: [],
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findings),
  };
};

const analyzeContainer = (ctx: AnalyzeCtx): AnalyzeResult => {
  const lower = path.basename(ctx.inputPath).toLowerCase();
  const isOciLayout =
    isDirectory(ctx.inputPath) && fs.existsSync(path.join(ctx.inputPath, "oci-layout")) && fs.existsSync(path.join(ctx.inputPath, "index.json"));
  const isCompose =
    lower === "docker-compose.yml" ||
    lower === "docker-compose.yaml" ||
    lower === "compose.yml" ||
    lower === "compose.yaml" ||
    hasAnyPath(ctx.capture, ["docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"]);
  const isSbom = /sbom|spdx|cyclonedx|bom/i.test(lower);
  const isContainerTar = ctx.ext === ".tar" && hasAnyPath(ctx.capture, ["manifest.json", "repositories"]);
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
  if (isOciLayout) {
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
      ociLayoutPresent: isOciLayout ? 1 : 0,
      tarballScanPresent: isContainerTar ? 1 : 0,
      sbomPresent: isSbom ? 1 : 0,
      composeHintPresent: isCompose ? 1 : 0,
    },
    markers: [],
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(findings),
  };
};

const analyzeImage = (ctx: AnalyzeCtx): AnalyzeResult => {
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
  return {
    ok: true,
    sourceClass: "image",
    sourceFormat: ctx.ext.replace(/^\./, "") || "unknown",
    mode: "built_in",
    adapterId: "image_adapter_v1",
    counts: {
      fileBytesBounded: fileBytes,
      imageTableEntries: 0,
    },
    markers: ["IMAGE_TABLE_TRUNCATED"],
    reasonCodes: stableSortUniqueReasonsV0(["IMAGE_ADAPTER_V1", "IMAGE_TABLE_TRUNCATED"]),
    findingCodes: stableSortUniqueReasonsV0(["IMAGE_TABLE_TRUNCATED"]),
  };
};

const analyzeScm = (ctx: AnalyzeCtx): AnalyzeResult => {
  if (!isDirectory(ctx.inputPath) || !fs.existsSync(path.join(ctx.inputPath, ".git"))) {
    return {
      ok: false,
      failCode: "SCM_UNSUPPORTED_FORMAT",
      failMessage: "scm adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_UNSUPPORTED_FORMAT"]),
    };
  }
  const rev = runCommandLines("git", ["-C", ctx.inputPath, "rev-parse", "HEAD"]);
  if (!rev.ok || rev.lines.length === 0) {
    return {
      ok: true,
      sourceClass: "scm",
      sourceFormat: "git",
      mode: "built_in",
      adapterId: "scm_adapter_v1",
      counts: {
        commitResolved: 0,
      },
      markers: [],
      reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_REF_UNRESOLVED"]),
      findingCodes: stableSortUniqueReasonsV0(["SCM_REF_UNRESOLVED"]),
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
    },
    markers: [],
    reasonCodes: stableSortUniqueReasonsV0(["SCM_ADAPTER_V1", "SCM_TREE_CAPTURED"]),
    findingCodes: stableSortUniqueReasonsV0(["SCM_TREE_CAPTURED"]),
  };
};

const analyzeSignature = (ctx: AnalyzeCtx): AnalyzeResult => {
  if (!SIGNATURE_EXTS.has(ctx.ext)) {
    return {
      ok: false,
      failCode: "SIGNATURE_UNSUPPORTED_FORMAT",
      failMessage: "signature adapter does not support this input format.",
      reasonCodes: stableSortUniqueReasonsV0(["SIGNATURE_ADAPTER_V1", "SIGNATURE_UNSUPPORTED_FORMAT"]),
    };
  }
  const text = readTextBounded(ctx.inputPath);
  const signerPresent = /BEGIN CERTIFICATE|BEGIN PKCS7|BEGIN SIGNATURE/i.test(text);
  const chainPresent = /BEGIN CERTIFICATE[\s\S]*BEGIN CERTIFICATE/i.test(text);
  const timestampPresent = /timestamp|tsa/i.test(text);
  const reasons = ["SIGNATURE_EVIDENCE_V1"];
  if (signerPresent) reasons.push("SIGNER_PRESENT");
  if (chainPresent) reasons.push("CHAIN_PRESENT");
  if (timestampPresent) reasons.push("TIMESTAMP_PRESENT");
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
    },
    markers: [],
    reasonCodes: stableSortUniqueReasonsV0(reasons),
    findingCodes: stableSortUniqueReasonsV0(reasons.filter((code) => code !== "SIGNATURE_EVIDENCE_V1")),
  };
};

const autoSelectClass = (ctx: AnalyzeCtx): AdapterClassV1 | null => {
  const ext = ctx.ext;
  if (EXTENSION_EXTS.has(ext) || (isDirectory(ctx.inputPath) && fs.existsSync(path.join(ctx.inputPath, "manifest.json")))) return "extension";
  if (PACKAGE_EXTS.has(ext)) return "package";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  if (IAC_EXTS.has(ext) || hasAnyPath(ctx.capture, [".github/workflows/", ".gitlab-ci", "azure-pipelines"])) return "iac";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  if (SIGNATURE_EXTS.has(ext)) return "signature";
  if (isDirectory(ctx.inputPath) && fs.existsSync(path.join(ctx.inputPath, ".git"))) return "scm";
  const base = path.basename(ctx.inputPath).toLowerCase();
  if (/sbom|spdx|cyclonedx|bom/.test(base) || hasAnyPath(ctx.capture, ["oci-layout", "docker-compose", "compose.yaml"])) return "container";
  if (IMAGE_EXTS.has(ext)) return "image";
  return null;
};

const analyzeByClass = (adapterClass: AdapterClassV1, ctx: AnalyzeCtx): AnalyzeResult => {
  if (adapterClass === "archive") return analyzeArchive(ctx);
  if (adapterClass === "package") return analyzePackage(ctx);
  if (adapterClass === "extension") return analyzeExtension(ctx);
  if (adapterClass === "iac" || adapterClass === "cicd") return analyzeIacCicd(ctx);
  if (adapterClass === "document") return analyzeDocument(ctx);
  if (adapterClass === "container") return analyzeContainer(ctx);
  if (adapterClass === "image") return analyzeImage(ctx);
  if (adapterClass === "scm") return analyzeScm(ctx);
  if (adapterClass === "signature") return analyzeSignature(ctx);
  return {
    ok: false,
    failCode: "ADAPTER_UNSUPPORTED",
    failMessage: "adapter class unsupported.",
    reasonCodes: ["ADAPTER_UNSUPPORTED"],
  };
};

export const runArtifactAdapterV1 = (options: AdapterRunOptionsV1): AdapterRunResultV1 => {
  const selection = options.selection;
  if (selection === "none") return { ok: true, reasonCodes: [] };
  const enabledPlugins = new Set(
    (options.enabledPlugins || [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter((name) => name.length > 0)
  );
  const inputPath = path.resolve(process.cwd(), options.inputPath || "");
  const ctx: AnalyzeCtx = {
    inputPath,
    ext: normalizeExtV1(inputPath),
    capture: options.capture,
    enabledPlugins,
  };

  const adapterClass: AdapterClassV1 | null =
    selection === "auto" ? autoSelectClass(ctx) : (selection as AdapterClassV1);
  if (!adapterClass) return { ok: true, reasonCodes: [] };

  const analyzed = analyzeByClass(adapterClass, ctx);
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
      formats: [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".7z"],
    },
    {
      adapter: "package",
      mode: "built_in",
      plugins: [],
      formats: [".msi", ".msix", ".exe", ".nupkg", ".whl", ".jar", ".tar.gz", ".tgz"],
    },
    {
      adapter: "extension",
      mode: "built_in",
      plugins: [],
      formats: [".crx", ".vsix", "manifest.json (directory)"],
    },
    {
      adapter: "iac",
      mode: "built_in",
      plugins: [],
      formats: [".tf", ".tfvars", ".hcl", ".yaml", ".yml", ".json", ".bicep"],
    },
    {
      adapter: "image",
      mode: "built_in",
      plugins: [],
      formats: [".iso", ".vhd", ".vhdx", ".vmdk", ".qcow2"],
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
