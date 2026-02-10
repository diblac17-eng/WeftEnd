/* src/cli/email.ts */
// Email adapter v0: local MIME artifacts -> deterministic folder -> safe-run.

import { canonicalJSON } from "../core/canon";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { runSafeRun } from "./safe_run";

declare const require: any;
declare const Buffer: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type EmailFlags = Record<string, string | boolean>;

const MAX_HEADER_LINES = 256;
const MAX_LINKS = 512;
const MAX_ATTACHMENTS = 128;
const MAX_TEXT_BYTES = 1024 * 1024;

const parseArgs = (argv: string[]): { rest: string[]; flags: EmailFlags } => {
  const args = [...argv];
  const flags: EmailFlags = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      flags["help"] = true;
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
  return {
    headersRaw: normalized.slice(0, idx),
    bodyRaw: normalized.slice(idx + 2),
  };
};

type HeaderEntry = { name: string; nameLower: string; value: string };

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
      if (active && current.length > 0) {
        parts.push(current.join("\n"));
      }
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
    const boundary = contentType.params["boundary"];
    if (!isNonEmptyString(boundary)) {
      out.markers.push("EMAIL_MULTIPART_BOUNDARY_MISSING");
      return;
    }
    const parts = splitMultipart(bodyRaw, boundary);
    parts.forEach((part) => parsePart(part, out));
    return;
  }

  const payload = decodeBody(bodyRaw, transferEncoding);
  const filename = sanitizeFileLeaf(
    disposition.params["filename"] || contentType.params["name"] || ""
  );
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
    const html = payload.toString("utf8");
    out.htmlBody += html;
    return;
  }
  if (contentType.type === "text/plain") {
    out.textBody += payload.toString("utf8");
    return;
  }

  // Keep unknown text-ish as plain body for deterministic analysis lane.
  if (contentType.type.startsWith("text/")) {
    out.textBody += payload.toString("utf8");
  }
};

const parseEml = (raw: string): ParsedEmailV0 => {
  const { headersRaw, bodyRaw } = splitHeadBody(raw);
  const headers = parseHeaders(headersRaw);
  const parsed: ParsedEmailV0 = {
    headers,
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

const toCanonicalHeaders = (headers: HeaderEntry[]): string => {
  const grouped = new Map<string, string[]>();
  headers.forEach((entry) => {
    const key = entry.nameLower;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry.value);
  });
  const lines = Array.from(grouped.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const value = grouped.get(key)!.map((item) => item.trim()).filter((item) => item.length > 0).join(" | ");
      return `${key}: ${value}`;
    });
  return `${lines.join("\n")}\n`;
};

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const writeText = (filePath: string, text: string): void => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
};

const writeEmailExport = (parsed: ParsedEmailV0, outDir: string): void => {
  const exportDir = path.join(outDir, "email_export");
  const attachDir = path.join(exportDir, "attachments", "files");
  fs.rmSync(exportDir, { recursive: true, force: true });
  ensureDir(attachDir);

  const headersText = toCanonicalHeaders(parsed.headers);
  const bodyText = normalizeNewlines(parsed.textBody).slice(0, MAX_TEXT_BYTES);
  const htmlText = normalizeNewlines(parsed.htmlBody).slice(0, MAX_TEXT_BYTES);
  const links = stableSortUniqueStringsV0(parsed.links).slice(0, MAX_LINKS);

  writeText(path.join(exportDir, "email_headers.txt"), headersText);
  writeText(path.join(exportDir, "email_body.txt"), `${bodyText}\n`);
  writeText(path.join(exportDir, "email_body.html"), `${htmlText}\n`);
  writeText(path.join(exportDir, "links.txt"), `${links.join("\n")}\n`);

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
    const abs = path.join(attachDir, unique);
    fs.writeFileSync(abs, attachment.bytes);
    return {
      name: unique,
      digest: computeArtifactDigestV0(attachment.bytes.toString("binary")),
      bytes: attachment.bytes.length,
      contentType: attachment.contentType,
      transferEncoding: attachment.transferEncoding,
    };
  });
  manifestEntries.sort((a, b) => a.name.localeCompare(b.name));
  writeText(
    path.join(exportDir, "attachments", "manifest.json"),
    `${canonicalJSON({
      schema: "weftend.emailAttachmentManifest/0",
      schemaVersion: 0,
      markers: stableSortUniqueStringsV0(parsed.markers),
      entries: manifestEntries,
    })}\n`
  );
};

const readSourceEmail = (
  inputPath: string,
  indexRaw?: string,
  messageIdRaw?: string
): { ok: true; rawEml: string } | { ok: false; code: string } => {
  const resolved = path.resolve(process.cwd(), inputPath || "");
  if (!inputPath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, code: "INPUT_MISSING" };
  }
  const ext = path.extname(resolved).toLowerCase();
  const raw = fs.readFileSync(resolved, "utf8");
  if (ext === ".eml") return { ok: true, rawEml: raw };
  if (ext === ".mbox") {
    const messages = parseMboxMessages(raw);
    const selected = selectMboxMessage(messages, indexRaw, messageIdRaw);
    if (!selected.ok) return selected;
    return { ok: true, rawEml: selected.raw };
  }
  return { ok: false, code: "EMAIL_INPUT_UNSUPPORTED" };
};

const parseUnpackOptions = (argv: string[]): {
  ok: boolean;
  inputPath?: string;
  outDir?: string;
  indexRaw?: string;
  messageIdRaw?: string;
  help?: boolean;
} => {
  const { rest, flags } = parseArgs(argv);
  if (flags["help"]) return { ok: false, help: true };
  const inputPath = rest[0];
  const outDir = String(flags["out"] || "");
  if (!inputPath || !outDir) return { ok: false };
  return {
    ok: true,
    inputPath,
    outDir,
    indexRaw: isNonEmptyString(flags["index"]) ? String(flags["index"]) : undefined,
    messageIdRaw: isNonEmptyString(flags["message-id"]) ? String(flags["message-id"]) : undefined,
  };
};

const printEmailUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend email unpack <input.eml|input.mbox> --out <dir> [--index <n>] [--message-id <id>]");
  console.log("  weftend email safe-run <input.eml|input.mbox> --out <dir> [--policy <path>] [--index <n>] [--message-id <id>]");
};

export const runEmailUnpackCli = (argv: string[]): number => {
  const parsed = parseUnpackOptions(argv);
  if (parsed.help || !parsed.ok || !parsed.inputPath || !parsed.outDir) {
    printEmailUsage();
    return parsed.help ? 1 : 40;
  }
  const input = readSourceEmail(parsed.inputPath, parsed.indexRaw, parsed.messageIdRaw);
  if (!input.ok) {
    console.error(`[${input.code}] unable to load email input.`);
    return 40;
  }
  const parsedEmail = parseEml(input.rawEml);
  writeEmailExport(parsedEmail, path.resolve(process.cwd(), parsed.outDir));
  console.log(
    `EMAIL_UNPACK OK headers=${Math.min(parsedEmail.headers.length, MAX_HEADER_LINES)} links=${Math.min(
      parsedEmail.links.length,
      MAX_LINKS
    )} attachments=${Math.min(parsedEmail.attachments.length, MAX_ATTACHMENTS)}`
  );
  return 0;
};

export const runEmailSafeRunCli = async (argv: string[]): Promise<number> => {
  const { rest, flags } = parseArgs(argv);
  if (flags["help"]) {
    printEmailUsage();
    return 1;
  }
  const inputPath = rest[0];
  const outDir = String(flags["out"] || "");
  if (!inputPath || !outDir) {
    printEmailUsage();
    return 40;
  }
  const indexRaw = isNonEmptyString(flags["index"]) ? String(flags["index"]) : undefined;
  const messageIdRaw = isNonEmptyString(flags["message-id"]) ? String(flags["message-id"]) : undefined;
  const policyPath = isNonEmptyString(flags["policy"]) ? String(flags["policy"]) : undefined;

  const input = readSourceEmail(inputPath, indexRaw, messageIdRaw);
  if (!input.ok) {
    console.error(`[${input.code}] unable to load email input.`);
    return 40;
  }
  const outRoot = path.resolve(process.cwd(), outDir);
  const parsedEmail = parseEml(input.rawEml);
  writeEmailExport(parsedEmail, outRoot);
  return runSafeRun({
    inputPath: path.join(outRoot, "email_export"),
    outDir: outRoot,
    policyPath,
    profile: "web",
    mode: "strict",
    executeRequested: false,
    withholdExec: true,
  });
};

export const runEmailCli = async (argv: string[]): Promise<number> => {
  const args = [...argv];
  const command = args.shift();
  if (command === "unpack") return runEmailUnpackCli(args);
  if (command === "safe-run") return runEmailSafeRunCli(args);
  printEmailUsage();
  return 1;
};
