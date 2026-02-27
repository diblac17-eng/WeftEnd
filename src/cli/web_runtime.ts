/* src/cli/web_runtime.ts */
// Deterministic web runtime inventory capture (analysis-only, local, no network).

import { canonicalJSON } from "../core/canon";
import { sha256HexBytesV0, sha256HexV0 } from "../core/hash_v0";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");

type CaptureModeV0 = "strict_replay" | "live_observe";
type SourceKindV0 = "inline" | "external" | "blob" | "eval" | "function_ctor" | "timer_string";
type OriginClassV0 = "self" | "third_party" | "unknown";

type DynamicSinkFlagsV0 = {
  evalCount: number;
  functionCtorCount: number;
  setTimeoutStringCount: number;
  setIntervalStringCount: number;
  documentWriteCount: number;
  domScriptInjectionCount: number;
};

type RuntimeScriptRecordV0 = {
  scriptId: string;
  sourceKind: SourceKindV0;
  originClass: OriginClassV0;
  sourceDigest: string;
  locatorDigest: string;
  integrityPresent: 0 | 1;
  integrityValid: 0 | 1;
  executedCount: number;
  mutationObserved: 0 | 1;
  dynamicSinkFlags: DynamicSinkFlagsV0;
};

type RuntimeSurfaceV0 = {
  cspPresent: 0 | 1;
  cspStrictEnough: 0 | 1;
  sriCoveragePercent: number;
  trustedTypesEnforced: 0 | 1;
  remoteScriptCount: number;
  inlineScriptCount: number;
  dynamicExecutionCount: number;
  mutatingScriptCount: number;
};

type RuntimeSummaryV0 = {
  scriptTotal: number;
  scriptUniqueDigestCount: number;
  thirdPartyScriptCount: number;
  sriMissingCount: number;
  integrityMismatchCount: number;
  mutationObservedCount: number;
  dynamicSinkTotal: number;
  boundedScriptCount: number;
};

type RuntimeTruncationV0 = {
  status: "NONE" | "TRUNCATED";
  markers: string[];
};

type WebRuntimeInventoryV0 = {
  schema: "weftend.webRuntimeInventory/0";
  schemaVersion: 0;
  captureMode: CaptureModeV0;
  targetDigest: string;
  runtimeSurface: RuntimeSurfaceV0;
  scripts: RuntimeScriptRecordV0[];
  summary: RuntimeSummaryV0;
  reasonCodes: string[];
  truncation: RuntimeTruncationV0;
};

type ParseResult = {
  rest: string[];
  flags: Record<string, string | boolean>;
};

type CandidateFileV0 = {
  absPath: string;
  relPath: string;
  kind: "html" | "script";
};

type ScriptExtractionContextV0 = {
  inputRoot: string;
  mode: CaptureModeV0;
  scriptCap: number;
  sourceByteCap: number;
};

type ScriptExtractionResultV0 = {
  scripts: RuntimeScriptRecordV0[];
  truncationMarkers: string[];
  reasonCodes: string[];
  cspValues: string[];
  filesScanned: number;
};

const MAX_SCRIPTS = 2048;
const MAX_CANDIDATE_FILES = 4096;
const MAX_REASON_CODES = 64;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_TOKEN_BYTES = 128;

const WEB_RUNTIME_SCHEMA = "weftend.webRuntimeInventory/0" as const;
const POLICY_GENERIC = path.join(process.cwd(), "policies", "generic_default.json");

const SCRIPT_FILE_EXTENSIONS = new Set<string>([".js", ".mjs", ".cjs", ".html", ".htm"]);
const HTML_FILE_EXTENSIONS = new Set<string>([".html", ".htm"]);

const printUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend web-runtime capture <input> --out <dir> [--mode strict_replay|live_observe]");
};

const parseArgs = (argv: string[]): ParseResult => {
  const args = [...argv];
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = args.length > 0 ? String(args[0] || "") : "";
      if (!value || value.startsWith("--")) {
        flags[key] = "";
        continue;
      }
      args.shift();
      flags[key] = value;
      continue;
    }
    rest.push(token);
  }
  return { rest, flags };
};

const pathsOverlap = (aPath: string, bPath: string): boolean => {
  const a = path.resolve(process.cwd(), aPath || "");
  const b = path.resolve(process.cwd(), bPath || "");
  if (a === b) return true;
  const aPrefix = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  const bPrefix = b.endsWith(path.sep) ? b : `${b}${path.sep}`;
  return a.startsWith(bPrefix) || b.startsWith(aPrefix);
};

const digestText = (text: string): string => `sha256:${sha256HexV0(String(text || ""))}`;
const digestBytes = (bytes: Uint8Array): string => `sha256:${sha256HexBytesV0(bytes)}`;

const normalizeLineEndings = (text: string): string => String(text || "").replace(/\r\n?/g, "\n");

const utf8Slice = (text: string, maxBytes: number): string => {
  let out = "";
  let count = 0;
  for (const ch of String(text || "")) {
    const code = ch.codePointAt(0) ?? 0;
    const bytes = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (count + bytes > maxBytes) break;
    out += ch;
    count += bytes;
  }
  return out;
};

const normalizeToken = (text: string): string => {
  const collapsed = normalizeLineEndings(text).replace(/\s+/g, " ").trim();
  if (!collapsed) return "NONE";
  return utf8Slice(collapsed, MAX_TOKEN_BYTES);
};

const makeScriptId = (locatorToken: string, sourceDigest: string, sourceKind: SourceKindV0): string =>
  `script_${sha256HexV0(`${locatorToken}|${sourceDigest}|${sourceKind}`).slice(0, 24)}`;

const countMatches = (text: string, re: RegExp): number => {
  const source = String(text || "");
  const regex = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let count = 0;
  while (regex.exec(source)) count += 1;
  return count;
};

const analyzeDynamicSinks = (text: string): DynamicSinkFlagsV0 => ({
  evalCount: countMatches(text, /\beval\s*\(/gi),
  functionCtorCount: countMatches(text, /\bnew\s+Function\s*\(/gi),
  setTimeoutStringCount: countMatches(text, /\bsetTimeout\s*\(\s*["'`]/gi),
  setIntervalStringCount: countMatches(text, /\bsetInterval\s*\(\s*["'`]/gi),
  documentWriteCount: countMatches(text, /\bdocument\s*\.\s*write\s*\(/gi),
  domScriptInjectionCount: countMatches(text, /\bcreateElement\s*\(\s*["']script["']\s*\)/gi),
});

const dynamicSinkTotal = (flags: DynamicSinkFlagsV0): number =>
  flags.evalCount +
  flags.functionCtorCount +
  flags.setTimeoutStringCount +
  flags.setIntervalStringCount +
  flags.documentWriteCount +
  flags.domScriptInjectionCount;

const hasMutationSignal = (flags: DynamicSinkFlagsV0): 0 | 1 => (dynamicSinkTotal(flags) > 0 ? 1 : 0);

const isUrlLike = (value: string): boolean => /^(https?:)?\/\//i.test(String(value || ""));
const isBlobLike = (value: string): boolean => /^blob:/i.test(String(value || ""));
const isDataLike = (value: string): boolean => /^data:/i.test(String(value || ""));

const normalizeSrcLocator = (srcRaw: string): string => {
  const trimmed = String(srcRaw || "").trim();
  const noQuery = trimmed.split("?")[0].split("#")[0];
  return normalizeToken(noQuery);
};

const pathWithin = (rootPath: string, childPath: string): boolean => {
  const root = path.resolve(rootPath);
  const child = path.resolve(childPath);
  if (root === child) return true;
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return child.startsWith(rootPrefix);
};

const resolveLocalExternalScript = (
  srcRaw: string,
  htmlPath: string,
  inputRoot: string
): { ok: true; absPath: string } | { ok: false } => {
  const src = String(srcRaw || "").trim();
  if (!src || isUrlLike(src) || isBlobLike(src) || isDataLike(src)) return { ok: false };
  const noQuery = src.split("?")[0].split("#")[0];
  if (!noQuery) return { ok: false };
  const candidate = noQuery.startsWith("/")
    ? path.join(inputRoot, noQuery.replace(/^[/\\]+/, ""))
    : path.resolve(path.dirname(htmlPath), noQuery);
  if (!pathWithin(inputRoot, candidate)) return { ok: false };
  try {
    if (!fs.statSync(candidate).isFile()) return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true, absPath: candidate };
};

const readFileBounded = (
  filePath: string,
  maxBytes: number
): { ok: true; bytes: Uint8Array; truncated: boolean } | { ok: false } => {
  try {
    const bytes: Uint8Array = fs.readFileSync(filePath);
    if (bytes.length <= maxBytes) return { ok: true, bytes, truncated: false };
    return { ok: true, bytes: bytes.slice(0, maxBytes), truncated: true };
  } catch {
    return { ok: false };
  }
};

const fileKindFromPath = (filePath: string): "html" | "script" | "other" => {
  const ext = String(path.extname(filePath) || "").toLowerCase();
  if (HTML_FILE_EXTENSIONS.has(ext)) return "html";
  if (SCRIPT_FILE_EXTENSIONS.has(ext)) return "script";
  return "other";
};

const listCandidateFiles = (
  inputPath: string
): { files: CandidateFileV0[]; truncationMarkers: string[]; reasonCodes: string[]; inputRoot: string } => {
  const truncationMarkers: string[] = [];
  const reasonCodes: string[] = [];
  const files: CandidateFileV0[] = [];
  const resolvedInput = path.resolve(inputPath);
  let stat: any = null;
  try {
    stat = fs.statSync(resolvedInput);
  } catch {
    return {
      files: [],
      truncationMarkers,
      reasonCodes: ["WEB_RUNTIME_CAPTURE_UNSUPPORTED"],
      inputRoot: path.dirname(resolvedInput),
    };
  }

  if (stat.isFile()) {
    const kind = fileKindFromPath(resolvedInput);
    if (kind === "other") {
      return {
        files: [],
        truncationMarkers,
        reasonCodes: ["WEB_RUNTIME_CAPTURE_UNSUPPORTED"],
        inputRoot: path.dirname(resolvedInput),
      };
    }
    files.push({
      absPath: resolvedInput,
      relPath: path.basename(resolvedInput),
      kind,
    });
    return { files, truncationMarkers, reasonCodes, inputRoot: path.dirname(resolvedInput) };
  }

  if (!stat.isDirectory()) {
    return {
      files: [],
      truncationMarkers,
      reasonCodes: ["WEB_RUNTIME_CAPTURE_UNSUPPORTED"],
      inputRoot: path.dirname(resolvedInput),
    };
  }

  const stack: string[] = [resolvedInput];
  while (stack.length > 0) {
    const current = String(stack.pop() || "");
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
      continue;
    }
    entries.sort((a, b) => cmpStrV0(a.name, b.name));
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = fileKindFromPath(abs);
      if (kind === "other") continue;
      const rel = path.relative(resolvedInput, abs).split(path.sep).join("/");
      files.push({ absPath: abs, relPath: rel, kind });
      if (files.length > MAX_CANDIDATE_FILES) {
        truncationMarkers.push("WEB_RUNTIME_CANDIDATE_FILE_TRUNCATED");
        reasonCodes.push("WEB_RUNTIME_BOUNDS_EXCEEDED");
        break;
      }
    }
    if (files.length > MAX_CANDIDATE_FILES) break;
  }
  files.sort((a, b) => {
    const relCmp = cmpStrV0(a.relPath, b.relPath);
    if (relCmp !== 0) return relCmp;
    return cmpStrV0(a.kind, b.kind);
  });
  const boundedFiles = files.length > MAX_CANDIDATE_FILES ? files.slice(0, MAX_CANDIDATE_FILES) : files;
  return {
    files: boundedFiles,
    truncationMarkers: stableSortUniqueReasonsV0(truncationMarkers),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
    inputRoot: resolvedInput,
  };
};

const extractHtmlScriptTags = (html: string): Array<{ attrs: string; body: string }> => {
  const out: Array<{ attrs: string; body: string }> = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    out.push({
      attrs: String(match[1] || ""),
      body: String(match[2] || ""),
    });
  }
  return out;
};

const parseHtmlAttributes = (rawAttrs: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const regex = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(String(rawAttrs || ""))) !== null) {
    const key = String(match[1] || "").toLowerCase();
    if (!key) continue;
    const value = String(match[2] || match[3] || match[4] || "");
    attrs[key] = value;
  }
  return attrs;
};

const parseCspMetaValues = (html: string): string[] => {
  const values: string[] = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = metaRe.exec(html)) !== null) {
    const attrs = parseHtmlAttributes(String(match[0] || ""));
    const httpEquiv = String(attrs["http-equiv"] || "").toLowerCase();
    if (httpEquiv !== "content-security-policy") continue;
    const content = String(attrs["content"] || "").trim();
    if (content.length > 0) values.push(normalizeLineEndings(content));
  }
  return values;
};

const cspStrictEnough = (values: string[]): 0 | 1 => {
  for (const value of values) {
    const csp = String(value || "").toLowerCase();
    if (!csp.includes("script-src")) continue;
    if (csp.includes("'unsafe-inline'")) continue;
    if (csp.includes("'unsafe-eval'")) continue;
    return 1;
  }
  return 0;
};

const trustedTypesEnforced = (values: string[]): 0 | 1 => {
  for (const value of values) {
    const csp = String(value || "").toLowerCase();
    if (csp.includes("require-trusted-types-for") && csp.includes("script")) return 1;
  }
  return 0;
};

const buildScriptRecord = (input: {
  sourceKind: SourceKindV0;
  originClass: OriginClassV0;
  sourceText?: string;
  sourceBytes?: Uint8Array;
  locatorToken: string;
  integrityPresent: 0 | 1;
  integrityValid: 0 | 1;
}): RuntimeScriptRecordV0 => {
  const sourceDigest = input.sourceBytes
    ? digestBytes(input.sourceBytes)
    : typeof input.sourceText === "string"
      ? digestText(normalizeLineEndings(input.sourceText))
      : "NOT_AVAILABLE";
  const locatorDigest = digestText(normalizeToken(input.locatorToken));
  const flags = analyzeDynamicSinks(typeof input.sourceText === "string" ? normalizeLineEndings(input.sourceText) : "");
  return {
    scriptId: makeScriptId(locatorDigest, sourceDigest, input.sourceKind),
    sourceKind: input.sourceKind,
    originClass: input.originClass,
    sourceDigest,
    locatorDigest,
    integrityPresent: input.integrityPresent,
    integrityValid: input.integrityValid,
    executedCount: 1,
    mutationObserved: hasMutationSignal(flags),
    dynamicSinkFlags: flags,
  };
};

const extractScriptsFromCandidates = (
  candidates: CandidateFileV0[],
  context: ScriptExtractionContextV0
): ScriptExtractionResultV0 => {
  const scripts: RuntimeScriptRecordV0[] = [];
  const truncationMarkers: string[] = [];
  const reasonCodes: string[] = [];
  const cspValues: string[] = [];
  let filesScanned = 0;

  for (const file of candidates) {
    filesScanned += 1;
    const read = readFileBounded(file.absPath, context.sourceByteCap);
    if (!read.ok) {
      reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
      continue;
    }
    if (read.truncated) {
      truncationMarkers.push("WEB_RUNTIME_SOURCE_BOUNDED");
      reasonCodes.push("WEB_RUNTIME_BOUNDS_EXCEEDED");
      reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
    }

    const text = normalizeLineEndings(Buffer.from(read.bytes).toString("utf8"));
    if (file.kind === "script") {
      scripts.push(
        buildScriptRecord({
          sourceKind: "external",
          originClass: "self",
          sourceBytes: read.bytes,
          sourceText: text,
          locatorToken: `file:${file.relPath}`,
          integrityPresent: 0,
          integrityValid: 0,
        })
      );
      continue;
    }

    cspValues.push(...parseCspMetaValues(text));
    const tags = extractHtmlScriptTags(text);
    tags.forEach((tag, idx) => {
      const attrs = parseHtmlAttributes(tag.attrs);
      const srcRaw = String(attrs.src || "");
      const integrityPresent = attrs.integrity ? 1 : 0;
      if (srcRaw.length === 0) {
        scripts.push(
          buildScriptRecord({
            sourceKind: "inline",
            originClass: "self",
            sourceText: tag.body,
            locatorToken: `html:${file.relPath}:inline:${idx + 1}`,
            integrityPresent: 0,
            integrityValid: 0,
          })
        );
        return;
      }

      const sourceKind: SourceKindV0 = isBlobLike(srcRaw) ? "blob" : "external";
      const originClass: OriginClassV0 = isUrlLike(srcRaw)
        ? "third_party"
        : isDataLike(srcRaw) || isBlobLike(srcRaw)
          ? "unknown"
          : "self";
      const srcLocator = normalizeSrcLocator(srcRaw);
      const localResolved = resolveLocalExternalScript(srcRaw, file.absPath, context.inputRoot);
      if (localResolved.ok) {
        const localRead = readFileBounded(localResolved.absPath, context.sourceByteCap);
        if (!localRead.ok) {
          reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
          scripts.push(
            buildScriptRecord({
              sourceKind,
              originClass,
              locatorToken: `html:${file.relPath}:src:${srcLocator}:${idx + 1}`,
              integrityPresent,
              integrityValid: integrityPresent,
            })
          );
          return;
        }
        if (localRead.truncated) {
          truncationMarkers.push("WEB_RUNTIME_SOURCE_BOUNDED");
          reasonCodes.push("WEB_RUNTIME_BOUNDS_EXCEEDED");
          reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
        }
        const localText = normalizeLineEndings(Buffer.from(localRead.bytes).toString("utf8"));
        scripts.push(
          buildScriptRecord({
            sourceKind,
            originClass,
            sourceBytes: localRead.bytes,
            sourceText: localText,
            locatorToken: `html:${file.relPath}:src:${srcLocator}:${idx + 1}`,
            integrityPresent,
            integrityValid: integrityPresent,
          })
        );
        return;
      }

      scripts.push(
        buildScriptRecord({
          sourceKind,
          originClass,
          locatorToken: `html:${file.relPath}:src:${srcLocator}:${idx + 1}`,
          integrityPresent,
          integrityValid: integrityPresent,
        })
      );
    });
  }

  scripts.sort((a, b) => {
    const id = cmpStrV0(a.scriptId, b.scriptId);
    if (id !== 0) return id;
    const source = cmpStrV0(a.sourceDigest, b.sourceDigest);
    if (source !== 0) return source;
    return cmpStrV0(a.locatorDigest, b.locatorDigest);
  });
  if (scripts.length > context.scriptCap) {
    truncationMarkers.push("WEB_RUNTIME_SCRIPT_CAP_TRUNCATED");
    reasonCodes.push("WEB_RUNTIME_BOUNDS_EXCEEDED");
  }
  const boundedScripts = scripts.length > context.scriptCap ? scripts.slice(0, context.scriptCap) : scripts;
  return {
    scripts: boundedScripts,
    truncationMarkers: stableSortUniqueReasonsV0(truncationMarkers),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
    cspValues: stableSortUniqueReasonsV0(cspValues),
    filesScanned,
  };
};

const computeTargetDigest = (
  inputPath: string
): { digest: string; reasonCodes: string[]; truncationMarkers: string[] } => {
  const resolved = path.resolve(inputPath);
  const reasonCodes: string[] = [];
  const truncationMarkers: string[] = [];
  let stat: any = null;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return {
      digest: digestText(`missing:${normalizeToken(inputPath)}`),
      reasonCodes: ["WEB_RUNTIME_CAPTURE_UNSUPPORTED"],
      truncationMarkers,
    };
  }
  if (stat.isFile()) {
    const read = readFileBounded(resolved, 4 * 1024 * 1024);
    if (!read.ok) {
      return {
        digest: digestText(`unreadable:${normalizeToken(inputPath)}`),
        reasonCodes: ["WEB_RUNTIME_CAPTURE_PARTIAL"],
        truncationMarkers,
      };
    }
    if (read.truncated) {
      truncationMarkers.push("WEB_RUNTIME_TARGET_DIGEST_BOUNDED");
      reasonCodes.push("WEB_RUNTIME_BOUNDS_EXCEEDED");
      reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
    }
    return {
      digest: digestBytes(read.bytes),
      reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
      truncationMarkers: stableSortUniqueReasonsV0(truncationMarkers),
    };
  }
  if (!stat.isDirectory()) {
    return {
      digest: digestText(`unsupported:${normalizeToken(inputPath)}`),
      reasonCodes: ["WEB_RUNTIME_CAPTURE_UNSUPPORTED"],
      truncationMarkers,
    };
  }
  const entries: Array<{ relDigest: string; contentDigest: string; size: number }> = [];
  const stack: string[] = [resolved];
  while (stack.length > 0) {
    const current = String(stack.pop() || "");
    let dirEntries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      dirEntries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
      continue;
    }
    dirEntries.sort((a, b) => cmpStrV0(a.name, b.name));
    for (let i = dirEntries.length - 1; i >= 0; i -= 1) {
      const entry = dirEntries[i];
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(resolved, abs).split(path.sep).join("/");
      const read = readFileBounded(abs, 256 * 1024);
      if (!read.ok) {
        reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
        entries.push({
          relDigest: digestText(rel),
          contentDigest: "NOT_AVAILABLE",
          size: 0,
        });
        continue;
      }
      if (read.truncated) {
        truncationMarkers.push("WEB_RUNTIME_TARGET_DIGEST_BOUNDED");
        reasonCodes.push("WEB_RUNTIME_BOUNDS_EXCEEDED");
        reasonCodes.push("WEB_RUNTIME_CAPTURE_PARTIAL");
      }
      entries.push({
        relDigest: digestText(rel),
        contentDigest: digestBytes(read.bytes),
        size: read.bytes.length,
      });
    }
  }
  entries.sort((a, b) => {
    const relCmp = cmpStrV0(a.relDigest, b.relDigest);
    if (relCmp !== 0) return relCmp;
    return cmpStrV0(a.contentDigest, b.contentDigest);
  });
  return {
    digest: digestText(canonicalJSON({ kind: "directory", entries })),
    reasonCodes: stableSortUniqueReasonsV0(reasonCodes),
    truncationMarkers: stableSortUniqueReasonsV0(truncationMarkers),
  };
};

const buildRuntimeSurface = (scripts: RuntimeScriptRecordV0[], cspValues: string[]): RuntimeSurfaceV0 => {
  const externalScripts = scripts.filter((script) => script.sourceKind === "external");
  const inlineScripts = scripts.filter((script) => script.sourceKind === "inline");
  const remoteScriptCount = scripts.filter((script) => script.originClass === "third_party").length;
  const dynamicExecutionCount = scripts
    .map((script) => dynamicSinkTotal(script.dynamicSinkFlags))
    .reduce((sum, value) => sum + value, 0);
  const mutatingScriptCount = scripts.filter((script) => script.mutationObserved === 1).length;
  const sriCovered = externalScripts.filter((script) => script.integrityPresent === 1).length;
  const sriCoveragePercent = externalScripts.length > 0 ? Math.floor((sriCovered * 100) / externalScripts.length) : 0;
  return {
    cspPresent: cspValues.length > 0 ? 1 : 0,
    cspStrictEnough: cspStrictEnough(cspValues),
    sriCoveragePercent,
    trustedTypesEnforced: trustedTypesEnforced(cspValues),
    remoteScriptCount,
    inlineScriptCount: inlineScripts.length,
    dynamicExecutionCount,
    mutatingScriptCount,
  };
};

const buildRuntimeSummary = (scripts: RuntimeScriptRecordV0[]): RuntimeSummaryV0 => {
  const uniqueDigests = new Set<string>();
  scripts.forEach((script) => {
    if (script.sourceDigest && script.sourceDigest !== "NOT_AVAILABLE") uniqueDigests.add(script.sourceDigest);
  });
  const thirdPartyScriptCount = scripts.filter((script) => script.originClass === "third_party").length;
  const sriMissingCount = scripts.filter((script) => script.sourceKind === "external" && script.integrityPresent === 0).length;
  const integrityMismatchCount = scripts.filter((script) => script.integrityPresent === 1 && script.integrityValid === 0).length;
  const mutationObservedCount = scripts.filter((script) => script.mutationObserved === 1).length;
  const dynamicSinkTotalCount = scripts
    .map((script) => dynamicSinkTotal(script.dynamicSinkFlags))
    .reduce((sum, value) => sum + value, 0);
  return {
    scriptTotal: scripts.length,
    scriptUniqueDigestCount: uniqueDigests.size,
    thirdPartyScriptCount,
    sriMissingCount,
    integrityMismatchCount,
    mutationObservedCount,
    dynamicSinkTotal: dynamicSinkTotalCount,
    boundedScriptCount: scripts.length,
  };
};

const hasPrivacyForbiddenFields = (inventory: WebRuntimeInventoryV0): boolean => {
  const payload = canonicalJSON(inventory);
  const forbidden = [
    /https?:\/\//i,
    /\\\\/,
    /[A-Za-z]:\\/,
    /\buser(name)?\b/i,
    /\bcookie\b/i,
    /\btoken\b/i,
  ];
  return forbidden.some((re) => re.test(payload));
};

const buildSummaryText = (inventory: WebRuntimeInventoryV0, status: "PASS" | "PARTIAL" | "UNSUPPORTED"): string => {
  const reasonText = inventory.reasonCodes.length > 0 ? inventory.reasonCodes.join(",") : "NONE";
  const markerText = inventory.truncation.markers.length > 0 ? inventory.truncation.markers.join(",") : "NONE";
  const lines = [
    `WEB_RUNTIME_CAPTURE status=${status} mode=${inventory.captureMode}`,
    `schema=${inventory.schema} schemaVersion=${inventory.schemaVersion}`,
    `targetDigest=${inventory.targetDigest}`,
    `scripts=total:${inventory.summary.scriptTotal} uniqueDigest:${inventory.summary.scriptUniqueDigestCount} thirdParty:${inventory.summary.thirdPartyScriptCount}`,
    `integrity=sriMissing:${inventory.summary.sriMissingCount} integrityMismatch:${inventory.summary.integrityMismatchCount}`,
    `runtimeSurface=cspPresent:${inventory.runtimeSurface.cspPresent} cspStrictEnough:${inventory.runtimeSurface.cspStrictEnough} sriCoveragePercent:${inventory.runtimeSurface.sriCoveragePercent} trustedTypesEnforced:${inventory.runtimeSurface.trustedTypesEnforced}`,
    `runtimeSignals=remoteScriptCount:${inventory.runtimeSurface.remoteScriptCount} inlineScriptCount:${inventory.runtimeSurface.inlineScriptCount} dynamicExecutionCount:${inventory.runtimeSurface.dynamicExecutionCount} mutatingScriptCount:${inventory.runtimeSurface.mutatingScriptCount}`,
    `reasonCodes=${reasonText}`,
    `truncation=${inventory.truncation.status} markers=${markerText}`,
  ];
  return `${lines.join("\n")}\n`;
};

const writeTextAtomic = (filePath: string, text: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagePath = `${filePath}.stage`;
  fs.rmSync(stagePath, { recursive: true, force: true });
  fs.writeFileSync(stagePath, text, "utf8");
  fs.renameSync(stagePath, filePath);
};

const prepareStagedOutRoot = (outDir: string): { ok: true; stageOutDir: string } | { ok: false } => {
  const stageOutDir = `${outDir}.stage`;
  try {
    fs.rmSync(stageOutDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(stageOutDir), { recursive: true });
    fs.mkdirSync(stageOutDir, { recursive: true });
    return { ok: true, stageOutDir };
  } catch {
    return { ok: false };
  }
};

const finalizeStagedOutRoot = (stageOutDir: string, outDir: string): boolean => {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(stageOutDir, outDir);
    return true;
  } catch {
    return false;
  }
};

const outPathDirectorySafe = (outDir: string): { ok: true } | { ok: false; code: string; message: string } => {
  if (fs.existsSync(outDir)) {
    try {
      if (!fs.statSync(outDir).isDirectory()) {
        return {
          ok: false,
          code: "WEB_RUNTIME_OUT_PATH_NOT_DIRECTORY",
          message: "--out must be a directory path or a missing path.",
        };
      }
    } catch {
      return { ok: false, code: "WEB_RUNTIME_OUT_PATH_INVALID", message: "unable to inspect --out path." };
    }
    return { ok: true };
  }
  let probe = path.dirname(path.resolve(outDir));
  while (probe && !fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (!probe || !fs.existsSync(probe)) return { ok: true };
  try {
    if (!fs.statSync(probe).isDirectory()) {
      return {
        ok: false,
        code: "WEB_RUNTIME_OUT_PATH_PARENT_NOT_DIRECTORY",
        message: "parent of --out must be a directory.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "WEB_RUNTIME_OUT_PATH_INVALID", message: "unable to inspect --out path." };
  }
};

export const runWebRuntimeCli = async (argv: string[]): Promise<number> => {
  const { rest, flags } = parseArgs(argv);
  const command = rest[0];
  if (flags.help || command !== "capture") {
    printUsage();
    return 1;
  }
  const inputPath = String(rest[1] || "");
  const outDir = String(flags["out"] || "");
  const modeRaw = String(flags["mode"] || "strict_replay").trim().toLowerCase();
  const mode: CaptureModeV0 =
    modeRaw === "strict_replay" || modeRaw === "live_observe"
      ? (modeRaw as CaptureModeV0)
      : ("strict_replay" as CaptureModeV0);

  if (!inputPath) {
    printUsage();
    return 1;
  }
  if (!outDir) {
    console.error("[OUT_REQUIRED] web-runtime capture requires --out <dir>.");
    return 40;
  }
  if (String(flags["mode"] || "").length > 0 && modeRaw !== "strict_replay" && modeRaw !== "live_observe") {
    console.error("[WEB_RUNTIME_MODE_INVALID] --mode must be strict_replay|live_observe.");
    return 40;
  }
  const outPathCheck = outPathDirectorySafe(outDir);
  if (!outPathCheck.ok) {
    console.error(`[${outPathCheck.code}] ${outPathCheck.message}`);
    return 40;
  }
  if (pathsOverlap(inputPath, outDir)) {
    console.error("[WEB_RUNTIME_OUT_CONFLICTS_INPUT] --out must not equal or overlap the input path.");
    return 40;
  }
  if (POLICY_GENERIC && pathsOverlap(outDir, POLICY_GENERIC)) {
    console.error("[WEB_RUNTIME_OUT_CONFLICTS_POLICY] --out must not equal or overlap policy dependency paths.");
    return 40;
  }

  const stage = prepareStagedOutRoot(outDir);
  if (!stage.ok) {
    console.error("[WEB_RUNTIME_STAGE_INIT_FAILED] unable to initialize staged output path.");
    return 1;
  }

  const targetDigestInfo = computeTargetDigest(inputPath);
  const candidates = listCandidateFiles(inputPath);
  const extracted = extractScriptsFromCandidates(candidates.files, {
    inputRoot: candidates.inputRoot,
    mode,
    scriptCap: MAX_SCRIPTS,
    sourceByteCap: MAX_SOURCE_BYTES,
  });

  const truncationMarkers = stableSortUniqueReasonsV0([
    ...targetDigestInfo.truncationMarkers,
    ...candidates.truncationMarkers,
    ...extracted.truncationMarkers,
  ]);
  const reasonCodes = stableSortUniqueReasonsV0([
    ...targetDigestInfo.reasonCodes,
    ...candidates.reasonCodes,
    ...extracted.reasonCodes,
    ...(candidates.files.length === 0 ? ["WEB_RUNTIME_CAPTURE_UNSUPPORTED"] : []),
  ]);
  const runtimeSurface = buildRuntimeSurface(extracted.scripts, extracted.cspValues);
  const summary = buildRuntimeSummary(extracted.scripts);

  const inventory: WebRuntimeInventoryV0 = {
    schema: WEB_RUNTIME_SCHEMA,
    schemaVersion: 0,
    captureMode: mode,
    targetDigest: targetDigestInfo.digest,
    runtimeSurface,
    scripts: extracted.scripts,
    summary,
    reasonCodes: reasonCodes.slice(0, MAX_REASON_CODES),
    truncation: {
      status: truncationMarkers.length > 0 ? "TRUNCATED" : "NONE",
      markers: truncationMarkers,
    },
  };

  if (hasPrivacyForbiddenFields(inventory)) {
    inventory.reasonCodes = stableSortUniqueReasonsV0([...inventory.reasonCodes, "WEB_RUNTIME_PRIVACY_FORBIDDEN"]).slice(
      0,
      MAX_REASON_CODES
    );
  }
  const unsupported = inventory.reasonCodes.includes("WEB_RUNTIME_CAPTURE_UNSUPPORTED");
  const privacyFail = inventory.reasonCodes.includes("WEB_RUNTIME_PRIVACY_FORBIDDEN");
  const partial =
    inventory.reasonCodes.includes("WEB_RUNTIME_CAPTURE_PARTIAL") ||
    inventory.reasonCodes.includes("WEB_RUNTIME_BOUNDS_EXCEEDED");
  const status: "PASS" | "PARTIAL" | "UNSUPPORTED" = unsupported ? "UNSUPPORTED" : partial ? "PARTIAL" : "PASS";

  const inventoryPath = path.join(stage.stageOutDir, "web_runtime_inventory_v0.json");
  const summaryPath = path.join(stage.stageOutDir, "web_runtime_summary.txt");
  writeTextAtomic(inventoryPath, `${canonicalJSON(inventory)}\n`);
  writeTextAtomic(summaryPath, buildSummaryText(inventory, status));

  if (!finalizeStagedOutRoot(stage.stageOutDir, outDir)) {
    console.error("[WEB_RUNTIME_FINALIZE_FAILED] unable to finalize staged output.");
    return 1;
  }

  const reasonText = inventory.reasonCodes.length > 0 ? inventory.reasonCodes.join(",") : "NONE";
  console.log(
    `WEB_RUNTIME_CAPTURE mode=${mode} status=${status} filesScanned=${extracted.filesScanned} scripts=${inventory.summary.scriptTotal} reasonCodes=${reasonText}`
  );
  if (privacyFail || unsupported) return 40;
  return 0;
};
