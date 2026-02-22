/* src/cli/email.ts */
// Email adapter v0: local email artifacts -> deterministic folder -> safe-run.

import { canonicalJSON } from "../core/canon";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { runSafeRun } from "./safe_run";

declare const require: any;
declare const Buffer: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");

type EmailFlags = Record<string, string | boolean>;

const MAX_HEADER_LINES = 256;
const MAX_LINKS = 512;
const MAX_ATTACHMENTS = 128;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_MSG_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_MSG_LINE_COUNT = 4096;

type EmailFormatV0 = "eml" | "mbox" | "msg";

type HeaderEntry = { name: string; nameLower: string; value: string };

type AttachmentV0 = {
  filename: string;
  contentType: string;
  transferEncoding: string;
  bytes: any;
};

type ParsedEmailV0 = {
  headers: HeaderEntry[];
  textBody: string;
  htmlBody: string;
  links: string[];
  attachments: AttachmentV0[];
  markers: string[];
};

type LoadedEmailV0 =
  | { ok: true; parsed: ParsedEmailV0; format: EmailFormatV0 }
  | { ok: false; code: string };

const parseArgs = (argv: string[]): { rest: string[]; flags: EmailFlags } => {
  const args = [...argv];
  const flags: EmailFlags = {};
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
      const value = args.shift();
      flags[key] = value ?? "";
      continue;
    }
    rest.push(token);
  }
  return { rest, flags };
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const splitHeadBody = (raw: string): { headersRaw: string; bodyRaw: string } => {
  const normalized = normalizeNewlines(raw);
  const idx = normalized.indexOf("\n\n");
  if (idx < 0) return { headersRaw: normalized, bodyRaw: "" };
  return { headersRaw: normalized.slice(0, idx), bodyRaw: normalized.slice(idx + 2) };
};

const parseHeaders = (raw: string): HeaderEntry[] => {
  const lines = normalizeNewlines(raw).split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] = `${unfolded[unfolded.length - 1]} ${line.trim()}`;
      continue;
    }
    unfolded.push(line);
  }
  const entries: HeaderEntry[] = [];
  for (const line of unfolded.slice(0, MAX_HEADER_LINES)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!isNonEmptyString(name)) continue;
    entries.push({ name, nameLower: name.toLowerCase(), value });
  }
  return entries;
};

const headerValue = (headers: HeaderEntry[], key: string): string | undefined => {
  const lowered = key.toLowerCase();
  const found = headers.find((entry) => entry.nameLower === lowered);
  return found?.value;
};

const parseParams = (value: string): { type: string; params: Record<string, string> } => {
  const segments = String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const type = (segments.shift() || "text/plain").toLowerCase();
  const params: Record<string, string> = {};
  for (const segment of segments) {
    const idx = segment.indexOf("=");
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim().toLowerCase();
    const raw = segment.slice(idx + 1).trim();
    const valueText =
      raw.startsWith("\"") && raw.endsWith("\"") && raw.length >= 2 ? raw.slice(1, raw.length - 1) : raw;
    params[key] = valueText;
  }
  return { type, params };
};

const decodeQuotedPrintable = (input: string): any => {
  const normalized = normalizeNewlines(input).replace(/=\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "=" && i + 2 < normalized.length) {
      const hex = normalized.slice(i + 1, i + 3);
      if (/^[A-Fa-f0-9]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch.charCodeAt(0));
  }
  return Buffer.from(bytes);
};

const decodeBody = (bodyRaw: string, transferEncoding: string): any => {
  const encoding = transferEncoding.toLowerCase();
  if (encoding === "base64") {
    const compact = bodyRaw.replace(/\s+/g, "");
    try {
      return Buffer.from(compact, "base64");
    } catch {
      return Buffer.from("", "utf8");
    }
  }
  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(bodyRaw);
  }
  return Buffer.from(bodyRaw, "utf8");
};

const splitMultipart = (bodyRaw: string, boundary: string): string[] => {
  const normalized = normalizeNewlines(bodyRaw);
  const marker = `--${boundary}`;
  const endMarker = `--${boundary}--`;
  const lines = normalized.split("\n");
  const parts: string[] = [];
  let current: string[] = [];
  let active = false;
  for (const line of lines) {
    if (line === marker) {
      if (active && current.length > 0) parts.push(current.join("\n"));
      current = [];
      active = true;
      continue;
    }
    if (line === endMarker) {
      if (active && current.length > 0) parts.push(current.join("\n"));
      break;
    }
    if (active) current.push(line);
  }
  return parts;
};

const sanitizeFileLeaf = (value: string): string =>
  String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const extractLinks = (text: string): string[] => {
  const found = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return stableSortUniqueStringsV0(found).slice(0, MAX_LINKS);
};

const stripScriptTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");

const parsePart = (rawPart: string, out: ParsedEmailV0): void => {
  const { headersRaw, bodyRaw } = splitHeadBody(rawPart);
  const headers = parseHeaders(headersRaw);
  const contentTypeRaw = headerValue(headers, "content-type") || "text/plain; charset=utf-8";
  const transferEncoding = (headerValue(headers, "content-transfer-encoding") || "7bit").toLowerCase();
  const dispositionRaw = headerValue(headers, "content-disposition") || "";
  const contentType = parseParams(contentTypeRaw);
  const disposition = parseParams(dispositionRaw);

  if (contentType.type.startsWith("multipart/")) {
    const boundary = contentType.params.boundary;
    if (!isNonEmptyString(boundary)) {
      out.markers.push("EMAIL_MULTIPART_BOUNDARY_MISSING");
      return;
    }
    const parts = splitMultipart(bodyRaw, boundary);
    parts.forEach((part) => parsePart(part, out));
    return;
  }

  const payload = decodeBody(bodyRaw, transferEncoding);
  const filename = sanitizeFileLeaf(disposition.params.filename || contentType.params.name || "");
  const isAttachment = disposition.type === "attachment" || filename.length > 0;
  if (isAttachment) {
    if (out.attachments.length < MAX_ATTACHMENTS) {
      out.attachments.push({
        filename: filename || `attachment_${String(out.attachments.length + 1).padStart(3, "0")}.bin`,
        contentType: contentType.type,
        transferEncoding,
        bytes: payload,
      });
    } else {
      out.markers.push("EMAIL_ATTACHMENTS_TRUNCATED");
    }
    return;
  }

  if (contentType.type === "text/html") {
    out.htmlBody += payload.toString("utf8");
    return;
  }
  if (contentType.type === "text/plain") {
    out.textBody += payload.toString("utf8");
    return;
  }
  if (contentType.type.startsWith("text/")) {
    out.textBody += payload.toString("utf8");
  }
};

const parseEml = (raw: string): ParsedEmailV0 => {
  const { headersRaw, bodyRaw } = splitHeadBody(raw);
  const parsed: ParsedEmailV0 = {
    headers: parseHeaders(headersRaw),
    textBody: "",
    htmlBody: "",
    links: [],
    attachments: [],
    markers: [],
  };
  parsePart(`${headersRaw}\n\n${bodyRaw}`, parsed);
  if (!parsed.textBody && parsed.htmlBody) {
    parsed.textBody = parsed.htmlBody.replace(/<[^>]+>/g, " ");
  }
  const combinedLinks = [...extractLinks(parsed.textBody), ...extractLinks(parsed.htmlBody)];
  parsed.links = stableSortUniqueStringsV0(combinedLinks).slice(0, MAX_LINKS);
  parsed.htmlBody = stripScriptTags(parsed.htmlBody);
  return parsed;
};

const parseMboxMessages = (raw: string): string[] => {
  const normalized = normalizeNewlines(raw);
  const lines = normalized.split("\n");
  const messages: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("From ")) {
      if (current.length > 0) messages.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) messages.push(current.join("\n"));
  return messages.filter((msg) => msg.trim().length > 0);
};

const selectMboxMessage = (
  messages: string[],
  indexRaw: string | undefined,
  messageIdRaw: string | undefined
): { ok: true; raw: string } | { ok: false; code: string } => {
  if (messages.length === 0) return { ok: false, code: "EMAIL_MBOX_EMPTY" };
  if (isNonEmptyString(messageIdRaw)) {
    const wanted = messageIdRaw.trim().toLowerCase();
    for (const message of messages) {
      const headers = parseHeaders(splitHeadBody(message).headersRaw);
      const id = (headerValue(headers, "message-id") || "").trim().toLowerCase();
      if (id === wanted) return { ok: true, raw: message };
    }
    return { ok: false, code: "EMAIL_MESSAGE_ID_NOT_FOUND" };
  }
  const index = isNonEmptyString(indexRaw) ? Number(indexRaw) : 0;
  if (!Number.isFinite(index) || index < 0 || Math.floor(index) !== index) {
    return { ok: false, code: "EMAIL_INDEX_INVALID" };
  }
  if (index >= messages.length) return { ok: false, code: "EMAIL_INDEX_OUT_OF_RANGE" };
  return { ok: true, raw: messages[index] };
};

const toCanonicalHeadersObject = (headers: HeaderEntry[]) => {
  const grouped = new Map<string, string[]>();
  headers.forEach((entry) => {
    if (!grouped.has(entry.nameLower)) grouped.set(entry.nameLower, []);
    grouped.get(entry.nameLower)!.push(entry.value);
  });
  return Array.from(grouped.keys())
    .sort((a, b) => cmpStrV0(a, b))
    .map((key) => ({
      name: key,
      values: grouped
        .get(key)!
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    }));
};

const extractPrintableLinesFromMsg = (input: any): string[] => {
  const bytes = input.slice(0, Math.min(MAX_MSG_BUFFER_BYTES, Number(input.length || 0)));
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) {
      if (current.length < 1024) current += String.fromCharCode(b);
      continue;
    }
    if (current.length >= 4) lines.push(current);
    current = "";
    if (lines.length >= MAX_MSG_LINE_COUNT) break;
  }
  if (current.length >= 4 && lines.length < MAX_MSG_LINE_COUNT) lines.push(current);
  return lines;
};

const parseMsg = (input: any): ParsedEmailV0 => {
  const lines = extractPrintableLinesFromMsg(input);
  const headerCandidates = lines
    .filter((line) => /^[A-Za-z0-9\-]{2,64}:/.test(line))
    .slice(0, MAX_HEADER_LINES)
    .join("\n");
  const headers = parseHeaders(headerCandidates);
  const textBody = lines.slice(0, MAX_MSG_LINE_COUNT).join("\n");
  const htmlBody = /<html|<!doctype html/i.test(textBody) ? stripScriptTags(textBody) : "";
  const links = stableSortUniqueStringsV0([...extractLinks(textBody), ...extractLinks(htmlBody)]).slice(0, MAX_LINKS);
  return {
    headers,
    textBody,
    htmlBody,
    links,
    attachments: [],
    markers: ["EMAIL_MSG_EXPERIMENTAL_PARSE", "EMAIL_ATTACHMENTS_UNAVAILABLE_IN_MSG_V0"],
  };
};

const writeText = (filePath: string, text: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagePath = `${filePath}.stage`;
  fs.rmSync(stagePath, { recursive: true, force: true });
  fs.writeFileSync(stagePath, text, "utf8");
  fs.renameSync(stagePath, filePath);
};

const writeBytes = (filePath: string, bytes: any): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagePath = `${filePath}.stage`;
  fs.rmSync(stagePath, { recursive: true, force: true });
  fs.writeFileSync(stagePath, bytes);
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

const pathsOverlap = (aPath: string, bPath: string): boolean => {
  const a = path.resolve(process.cwd(), aPath || "");
  const b = path.resolve(process.cwd(), bPath || "");
  if (a === b) return true;
  const aPrefix = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  const bPrefix = b.endsWith(path.sep) ? b : `${b}${path.sep}`;
  return a.startsWith(bPrefix) || b.startsWith(aPrefix);
};

const isSafeRequiredRelPath = (value: string): boolean => {
  const rel = String(value || "").replace(/\\/g, "/").trim();
  if (!rel) return false;
  if (rel.startsWith("/") || /^[A-Za-z]:\//.test(rel)) return false;
  if (rel.includes("..")) return false;
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(rel)) return false;
  if (/\$env:[A-Za-z_][A-Za-z0-9_]*/.test(rel)) return false;
  return true;
};

const resolveWithinDir = (root: string, relPath: string): string | null => {
  const rootAbs = path.resolve(root);
  const candidate = path.resolve(rootAbs, relPath);
  const rel = path.relative(rootAbs, candidate);
  if (!rel || rel === ".") return candidate;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return candidate;
};

const validateMarkers = (parsed: ParsedEmailV0, bodyText: string, htmlText: string): string[] => {
  const markers = [...parsed.markers];
  if (bodyText.length >= MAX_TEXT_BYTES) markers.push("EMAIL_BODY_TEXT_TRUNCATED");
  if (htmlText.length >= MAX_TEXT_BYTES) markers.push("EMAIL_BODY_HTML_TRUNCATED");
  if (parsed.links.length >= MAX_LINKS) markers.push("EMAIL_LINKS_TRUNCATED");
  if (parsed.headers.length >= MAX_HEADER_LINES) markers.push("EMAIL_HEADERS_TRUNCATED");
  if (parsed.attachments.length >= MAX_ATTACHMENTS) markers.push("EMAIL_ATTACHMENTS_TRUNCATED");
  return stableSortUniqueStringsV0(markers);
};

const writeEmailExport = (parsed: ParsedEmailV0, outDir: string, format: EmailFormatV0): void => {
  const exportDir = path.join(outDir, "email_export");
  const attachDir = path.join(exportDir, "attachments", "files");
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.mkdirSync(attachDir, { recursive: true });

  const bodyText = normalizeNewlines(parsed.textBody).slice(0, MAX_TEXT_BYTES);
  const htmlText = normalizeNewlines(parsed.htmlBody).slice(0, MAX_TEXT_BYTES);
  const links = stableSortUniqueStringsV0(parsed.links).slice(0, MAX_LINKS);
  const markers = validateMarkers(parsed, bodyText, htmlText);

  const headersJson = {
    schema: "weftend.emailHeaders/0",
    schemaVersion: 0,
    sourceFormat: format,
    headers: toCanonicalHeadersObject(parsed.headers),
    markers,
  };
  writeText(path.join(exportDir, "headers.json"), `${canonicalJSON(headersJson)}\n`);
  writeText(path.join(exportDir, "body.txt"), `${bodyText}\n`);
  writeText(path.join(exportDir, "body.html.txt"), `${htmlText}\n`);
  writeText(path.join(exportDir, "links.txt"), `${links.join("\n")}\n`);

  // Compatibility files for existing tooling.
  writeText(path.join(exportDir, "email_headers.txt"), `${headersJson.headers.map((h) => `${h.name}: ${h.values.join(" | ")}`).join("\n")}\n`);
  writeText(path.join(exportDir, "email_body.txt"), `${bodyText}\n`);
  writeText(path.join(exportDir, "email_body.html"), `${htmlText}\n`);

  const seenNames = new Set<string>();
  const manifestEntries = parsed.attachments.slice(0, MAX_ATTACHMENTS).map((attachment, index) => {
    let name = sanitizeFileLeaf(attachment.filename);
    if (!name) name = `attachment_${String(index + 1).padStart(3, "0")}.bin`;
    let unique = name;
    let counter = 1;
    while (seenNames.has(unique.toLowerCase())) {
      unique = `${name}_${String(counter).padStart(3, "0")}`;
      counter += 1;
    }
    seenNames.add(unique.toLowerCase());
    writeBytes(path.join(attachDir, unique), attachment.bytes);
    return {
      name: unique,
      bytes: Number(attachment.bytes.length || 0),
    };
  });
  manifestEntries.sort((a, b) => cmpStrV0(a.name, b.name));

  writeText(
    path.join(exportDir, "attachments", "manifest.json"),
    `${canonicalJSON({
      schema: "weftend.emailAttachmentManifest/0",
      schemaVersion: 0,
      sourceFormat: format,
      markers,
      entries: manifestEntries,
    })}\n`
  );

  writeText(
    path.join(exportDir, "adapter_manifest.json"),
    `${canonicalJSON({
      schema: "weftend.normalizedArtifact/0",
      schemaVersion: 0,
      adapterId: "email_v0",
      kind: "email",
      rootDir: "email_export",
      sourceFormat: format,
      requiredFiles: [
        "adapter_manifest.json",
        "headers.json",
        "body.txt",
        "body.html.txt",
        "links.txt",
        "attachments/manifest.json",
      ],
      markers,
    })}\n`
  );
};

const validateNormalizedEmailExport = (inputDir: string): { ok: true; exportDir: string } | { ok: false; code: string } => {
  const exportDir = path.resolve(process.cwd(), inputDir || "");
  if (!inputDir || !fs.existsSync(exportDir) || !fs.statSync(exportDir).isDirectory()) {
    return { ok: false, code: "INPUT_MISSING" };
  }
  const manifestPath = path.join(exportDir, "adapter_manifest.json");
  if (!fs.existsSync(manifestPath)) return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
  }
  if (!manifest || manifest.schema !== "weftend.normalizedArtifact/0" || manifest.adapterId !== "email_v0") {
    return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
  }
  const required = Array.isArray(manifest.requiredFiles) ? manifest.requiredFiles : [];
  if (required.length === 0 || required.length > 64) {
    return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
  }
  for (const file of required) {
    if (typeof file !== "string" || file.length === 0) return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
    if (!isSafeRequiredRelPath(file)) return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
    const abs = resolveWithinDir(exportDir, file);
    if (!abs) return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
    if (!fs.existsSync(abs)) return { ok: false, code: "ADAPTER_NORMALIZATION_INVALID" };
  }
  return { ok: true, exportDir };
};

const readSourceEmail = (
  inputPath: string,
  indexRaw?: string,
  messageIdRaw?: string
): LoadedEmailV0 => {
  const resolved = path.resolve(process.cwd(), inputPath || "");
  if (!inputPath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, code: "INPUT_MISSING" };
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".eml") {
    const raw = fs.readFileSync(resolved, "utf8");
    return { ok: true, parsed: parseEml(raw), format: "eml" };
  }
  if (ext === ".mbox") {
    const raw = fs.readFileSync(resolved, "utf8");
    const messages = parseMboxMessages(raw);
    const selected = selectMboxMessage(messages, indexRaw, messageIdRaw);
    if (!selected.ok) return selected;
    return { ok: true, parsed: parseEml(selected.raw), format: "mbox" };
  }
  if (ext === ".msg") {
    const raw = fs.readFileSync(resolved);
    return { ok: true, parsed: parseMsg(raw), format: "msg" };
  }
  return { ok: false, code: "EMAIL_INPUT_UNSUPPORTED" };
};

const printEmailUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend email unpack <input.eml|input.mbox|input.msg> --out <dir> [--index <n>] [--message-id <id>]");
  console.log("  weftend email safe-run <input.eml|input.mbox|input.msg|email_export_dir> --out <dir> [--policy <path>] [--index <n>] [--message-id <id>]");
};

export const runEmailUnpackCli = (argv: string[]): number => {
  const { rest, flags } = parseArgs(argv);
  if (flags.help) {
    printEmailUsage();
    return 1;
  }
  const inputPath = rest[0];
  const outDir = String(flags.out || "");
  if (!inputPath || !outDir) {
    printEmailUsage();
    return 40;
  }
  if (pathsOverlap(inputPath, outDir)) {
    console.error("[EMAIL_UNPACK_OUT_CONFLICTS_INPUT] --out must not equal or overlap the input path.");
    return 40;
  }
  const outRoot = path.resolve(process.cwd(), outDir);
  if (fs.existsSync(outRoot)) {
    try {
      if (!fs.statSync(outRoot).isDirectory()) {
        console.error("[EMAIL_UNPACK_OUT_PATH_NOT_DIRECTORY] --out must be a directory path or a missing path.");
        return 40;
      }
    } catch {
      console.error("[EMAIL_UNPACK_OUT_PATH_INVALID] unable to inspect --out path.");
      return 40;
    }
  }
  const indexRaw = isNonEmptyString(flags.index) ? String(flags.index) : undefined;
  const messageIdRaw = isNonEmptyString(flags["message-id"]) ? String(flags["message-id"]) : undefined;
  const loaded = readSourceEmail(inputPath, indexRaw, messageIdRaw);
  if (!loaded.ok) {
    console.error(`[${loaded.code}] unable to load email input.`);
    return 40;
  }
  const stage = prepareStagedOutRoot(outRoot);
  if (!stage.ok) {
    console.error("[EMAIL_UNPACK_STAGE_INIT_FAILED] unable to initialize staged output path.");
    return 1;
  }
  writeEmailExport(loaded.parsed, stage.stageOutDir, loaded.format);
  if (!finalizeStagedOutRoot(stage.stageOutDir, outRoot)) {
    console.error("[EMAIL_UNPACK_FINALIZE_FAILED] unable to finalize staged output.");
    return 1;
  }
  console.log(
    `EMAIL_UNPACK OK format=${loaded.format} headers=${Math.min(loaded.parsed.headers.length, MAX_HEADER_LINES)} links=${Math.min(
      loaded.parsed.links.length,
      MAX_LINKS
    )} attachments=${Math.min(loaded.parsed.attachments.length, MAX_ATTACHMENTS)}`
  );
  return 0;
};

export const runEmailSafeRunCli = async (argv: string[]): Promise<number> => {
  const { rest, flags } = parseArgs(argv);
  if (flags.help) {
    printEmailUsage();
    return 1;
  }
  const inputPath = rest[0];
  const outDir = String(flags.out || "");
  if (!inputPath || !outDir) {
    printEmailUsage();
    return 40;
  }
  if (pathsOverlap(inputPath, outDir)) {
    console.error("[EMAIL_SAFE_RUN_OUT_CONFLICTS_INPUT] --out must not equal or overlap the input path.");
    return 40;
  }
  const outRoot = path.resolve(process.cwd(), outDir);
  if (fs.existsSync(outRoot)) {
    try {
      if (!fs.statSync(outRoot).isDirectory()) {
        console.error("[EMAIL_SAFE_RUN_OUT_PATH_NOT_DIRECTORY] --out must be a directory path or a missing path.");
        return 40;
      }
    } catch {
      console.error("[EMAIL_SAFE_RUN_OUT_PATH_INVALID] unable to inspect --out path.");
      return 40;
    }
  }
  const policyPath = isNonEmptyString(flags.policy) ? String(flags.policy) : undefined;
  if (policyPath && pathsOverlap(policyPath, outRoot)) {
    console.error("[EMAIL_SAFE_RUN_OUT_CONFLICTS_POLICY] --out must not equal or overlap the --policy path.");
    return 40;
  }
  const resolvedInput = path.resolve(process.cwd(), inputPath);
  let exportDir = path.join(outRoot, "email_export");
  let tempExportRoot: string | null = null;
  if (fs.existsSync(resolvedInput) && fs.statSync(resolvedInput).isDirectory()) {
    const normalized = validateNormalizedEmailExport(resolvedInput);
    if (!normalized.ok) {
      console.error(`[${normalized.code}] invalid normalized email artifact.`);
      return 40;
    }
    exportDir = normalized.exportDir;
  } else {
    const indexRaw = isNonEmptyString(flags.index) ? String(flags.index) : undefined;
    const messageIdRaw = isNonEmptyString(flags["message-id"]) ? String(flags["message-id"]) : undefined;
    const loaded = readSourceEmail(inputPath, indexRaw, messageIdRaw);
    if (!loaded.ok) {
      console.error(`[${loaded.code}] unable to load email input.`);
      return 40;
    }
    const exportWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "weftend-email-export-"));
    tempExportRoot = exportWorkspace;
    writeEmailExport(loaded.parsed, exportWorkspace, loaded.format);
    exportDir = path.join(exportWorkspace, "email_export");
  }
  try {
    return await runSafeRun({
      inputPath: exportDir,
      outDir: outRoot,
      policyPath,
      profile: "web",
      mode: "strict",
      executeRequested: false,
      withholdExec: true,
    });
  } finally {
    const cleanupRoot = tempExportRoot;
    if (cleanupRoot !== null) fs.rmSync(cleanupRoot, { recursive: true, force: true });
  }
};

export const runEmailCli = async (argv: string[]): Promise<number> => {
  const args = [...argv];
  const command = args.shift();
  if (command === "unpack") return runEmailUnpackCli(args);
  if (command === "safe-run") return runEmailSafeRunCli(args);
  printEmailUsage();
  return 1;
};
