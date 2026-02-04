// test/harness/adapter_v0.ts
// Harness-only adapter format (deterministic, bounded, informational).

const ADAPTER_SCHEMA = "weftend.adapter/0";
const MAX_REASON_CODES = 25;
const MAX_SCARS = 25;
const MAX_PROOF_POINTERS = 25;
const MAX_NOTES_BYTES = 256;
const MAX_STR_BYTES = 128;

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const canonicalJSON = (obj) => {
  const seen = new WeakSet();
  const normalize = (value) => {
    if (value === null || value === undefined) return null;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") return value;
    if (Array.isArray(value)) return value.map(normalize);
    if (t === "object") {
      if (seen.has(value)) throw new Error("CYCLE_IN_CANONICAL_JSON");
      seen.add(value);
      const out = {};
      Object.keys(value)
        .sort()
        .forEach((key) => {
          out[key] = normalize(value[key]);
        });
      return out;
    }
    return null;
  };
  return JSON.stringify(normalize(obj));
};

const utf8ByteLen = (value) => {
  if (value === null || value === undefined) return 0;
  const text = String(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return Buffer.from(text, "utf8").length;
};

const truncateUtf8 = (value, maxBytes) => {
  const text = String(value ?? "");
  if (utf8ByteLen(text) <= maxBytes) return text;
  if (typeof TextEncoder === "undefined" || typeof TextDecoder === "undefined") {
    return Buffer.from(text, "utf8").slice(0, maxBytes).toString("utf8");
  }
  const enc = new TextEncoder().encode(text);
  const sliced = enc.slice(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced);
};

const digestString = (value) => `fnv1a32:${fnv1a32(String(value))}`;

const normalizeHtml = (html) => {
  if (typeof html !== "string") return "";
  return html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const clampNumber = (value) => {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return num < 0 ? 0 : Math.floor(num);
};

const normalizeStringList = (items, maxItems) => {
  const list = Array.isArray(items) ? items : [];
  const normalized = list
    .map((item) => truncateUtf8(String(item ?? "").trim(), MAX_STR_BYTES))
    .filter((item) => item.length > 0);
  const unique = Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
  const dropped = unique.length > maxItems ? unique.length - maxItems : 0;
  return { list: unique.slice(0, maxItems), dropped };
};

const canonicalizeAdapterV0 = (input) => {
  const obj = input && typeof input === "object" ? input : {};
  const profile =
    obj.profile === "web" || obj.profile === "mod" || obj.profile === "package" || obj.profile === "release"
      ? obj.profile
      : "web";
  const verdict =
    obj.verdict === "OK" || obj.verdict === "WARN" || obj.verdict === "DENY" || obj.verdict === "QUARANTINE"
      ? obj.verdict
      : "WARN";

  const digests = obj.digests && typeof obj.digests === "object" ? obj.digests : {};
  const inputDigest = typeof digests.inputDigest === "string" ? digests.inputDigest : digestString("");
  const snapshotDigest = typeof digests.snapshotDigest === "string" ? digests.snapshotDigest : "";
  const reportDigest = typeof digests.reportDigest === "string" ? digests.reportDigest : "";

  const capsIn = obj.caps && typeof obj.caps === "object" ? obj.caps : {};
  const caps = {
    denied: clampNumber(capsIn.denied),
    attempted: clampNumber(capsIn.attempted),
  };

  const reasonRes = normalizeStringList(obj.reasonCodes, MAX_REASON_CODES);
  const scarsRes = normalizeStringList(obj.scars, MAX_SCARS);
  const pointersRes = normalizeStringList(obj.proofPointers, MAX_PROOF_POINTERS);

  const dropped = {
    reasonCodes: reasonRes.dropped,
    scars: scarsRes.dropped,
    proofPointers: pointersRes.dropped,
  };

  let notes = typeof obj.notes === "string" ? truncateUtf8(obj.notes, MAX_NOTES_BYTES) : "";
  let reasonCodes = reasonRes.list;
  if (dropped.reasonCodes || dropped.scars || dropped.proofPointers) {
    const merged = ["BOUNDED_DROP_TAIL", ...reasonCodes.filter((code) => code !== "BOUNDED_DROP_TAIL")];
    reasonCodes = normalizeStringList(merged, MAX_REASON_CODES).list;
    const dropNote = `dropTail reasonCodes=${dropped.reasonCodes} scars=${dropped.scars} proofPointers=${dropped.proofPointers}`;
    notes = notes ? `${notes} | ${dropNote}` : dropNote;
    notes = truncateUtf8(notes, MAX_NOTES_BYTES);
  }

  const out = {
    schema: ADAPTER_SCHEMA,
    profile,
    verdict,
    reasonCodes,
    digests: {
      inputDigest,
      ...(snapshotDigest ? { snapshotDigest } : {}),
      ...(reportDigest ? { reportDigest } : {}),
    },
    caps,
    scars: scarsRes.list,
    proofPointers: pointersRes.list,
  };

  if (notes) out.notes = notes;
  return out;
};

const digestAdapterV0 = (adapter) => digestString(canonicalJSON(adapter));

const issue = (path, code, message) => ({ path, code, message });

const sortIssues = (issues) =>
  [...issues].sort((a, b) => {
    const p = (a.path || "").localeCompare(b.path || "");
    if (p !== 0) return p;
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    return a.message.localeCompare(b.message);
  });

const validateAdapterV0 = (input) => {
  const issues = [];
  const obj = input && typeof input === "object" ? input : {};
  if (obj.schema !== ADAPTER_SCHEMA) {
    issues.push(issue("/schema", "ADAPTER_SCHEMA_INVALID", "schema must be weftend.adapter/0"));
  }
  if (obj.profile !== "web" && obj.profile !== "mod" && obj.profile !== "package" && obj.profile !== "release") {
    issues.push(issue("/profile", "ADAPTER_PROFILE_INVALID", "profile must be web|mod|package|release"));
  }
  if (obj.verdict !== "OK" && obj.verdict !== "WARN" && obj.verdict !== "DENY" && obj.verdict !== "QUARANTINE") {
    issues.push(issue("/verdict", "ADAPTER_VERDICT_INVALID", "verdict must be OK|WARN|DENY|QUARANTINE"));
  }
  if (!obj.digests || typeof obj.digests !== "object" || typeof obj.digests.inputDigest !== "string") {
    issues.push(issue("/digests/inputDigest", "ADAPTER_DIGEST_MISSING", "inputDigest is required"));
  }
  const reasonCodes = Array.isArray(obj.reasonCodes) ? obj.reasonCodes : [];
  if (reasonCodes.length > MAX_REASON_CODES) {
    issues.push(issue("/reasonCodes", "ADAPTER_REASON_CAP", "reasonCodes exceeds cap"));
  }
  const scars = Array.isArray(obj.scars) ? obj.scars : [];
  if (scars.length > MAX_SCARS) {
    issues.push(issue("/scars", "ADAPTER_SCAR_CAP", "scars exceeds cap"));
  }
  const pointers = Array.isArray(obj.proofPointers) ? obj.proofPointers : [];
  if (pointers.length > MAX_PROOF_POINTERS) {
    issues.push(issue("/proofPointers", "ADAPTER_POINTER_CAP", "proofPointers exceeds cap"));
  }
  const notes = typeof obj.notes === "string" ? obj.notes : "";
  if (notes && utf8ByteLen(notes) > MAX_NOTES_BYTES) {
    issues.push(issue("/notes", "ADAPTER_NOTES_CAP", "notes exceeds cap"));
  }
  return issues.length > 0 ? { ok: false, issues: sortIssues(issues) } : { ok: true, issues: [] };
};

export {
  ADAPTER_SCHEMA,
  MAX_REASON_CODES,
  MAX_SCARS,
  MAX_PROOF_POINTERS,
  MAX_NOTES_BYTES,
  MAX_STR_BYTES,
  canonicalJSON,
  digestString,
  normalizeHtml,
  canonicalizeAdapterV0,
  digestAdapterV0,
  validateAdapterV0,
};
