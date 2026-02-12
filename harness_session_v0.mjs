// test/harness/harness_session_v0.mjs
// Harness session bundle (UI-only, deterministic, time-free).

export const HARNESS_SESSION_SCHEMA_V0 = "weftend.harness.session/0";
export const HARNESS_SESSION_VERSION = 0;

const MAX_STRING_BYTES = 512;

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);

const utf8ByteLen = (value) => {
  let count = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) || 0;
    if (code <= 0x7f) count += 1;
    else if (code <= 0x7ff) count += 2;
    else if (code <= 0xffff) count += 3;
    else count += 4;
  }
  return count;
};

const truncateUtf8 = (value, maxBytes) => {
  if (utf8ByteLen(value) <= maxBytes) return value;
  let out = "";
  let count = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) || 0;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (count + size > maxBytes) break;
    out += ch;
    count += size;
  }
  return out;
};

const normalizeString = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateUtf8(trimmed, MAX_STRING_BYTES);
};

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const canonicalJSON = (obj) => {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "function" || t === "symbol") return null;
    if (Array.isArray(v)) return v.map(normalize);
    if (t === "object") {
      if (seen.has(v)) throw new Error("CYCLE_IN_CANONICAL_JSON");
      seen.add(v);
      const out = {};
      Object.keys(v)
        .sort()
        .forEach((k) => {
          out[k] = normalize(v[k]);
        });
      return out;
    }
    return null;
  };
  return JSON.stringify(normalize(obj));
};

const normalizeInput = (value) => {
  if (!isRecord(value)) return {};
  const out = {};
  const releaseDir = normalizeString(value.releaseDir);
  if (releaseDir) out.releaseDir = releaseDir;
  const verifySource = normalizeString(value.verifySource);
  if (verifySource) out.verifySource = verifySource;
  const shadowSource = normalizeString(value.shadowSource);
  if (shadowSource) out.shadowSource = shadowSource;
  const telemetrySource = normalizeString(value.telemetrySource);
  if (telemetrySource) out.telemetrySource = telemetrySource;
  const releaseTamper = normalizeString(value.releaseTamper);
  if (releaseTamper) out.releaseTamper = releaseTamper;
  return out;
};

const normalizeOutputs = (value) => {
  if (!isRecord(value)) return {};
  const out = {};
  if (isRecord(value.verifyReport)) out.verifyReport = value.verifyReport;
  if (isRecord(value.shadowAuditResult)) out.shadowAuditResult = value.shadowAuditResult;
  if (isRecord(value.telemetryConduitSnapshot)) out.telemetryConduitSnapshot = value.telemetryConduitSnapshot;
  if (isRecord(value.releaseFolder)) out.releaseFolder = value.releaseFolder;
  return out;
};

export const buildHarnessSessionCoreV0 = (input, outputs) => ({
  schema: HARNESS_SESSION_SCHEMA_V0,
  v: HARNESS_SESSION_VERSION,
  input: normalizeInput(input),
  outputs: normalizeOutputs(outputs),
});

export const canonicalizeHarnessSessionV0 = (session) => canonicalJSON(session);

export const digestHarnessSessionV0 = (session) => {
  const canon = canonicalizeHarnessSessionV0(session);
  return `fnv1a32:${fnv1a32(canon)}`;
};

export const buildHarnessSessionV0 = (input, outputs) => {
  const core = buildHarnessSessionCoreV0(input, outputs);
  const sessionDigest = digestHarnessSessionV0(core);
  return {
    ...core,
    digests: { sessionDigest },
  };
};

export const validateHarnessSessionV0 = (value) => {
  const issues = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ code: "FIELD_INVALID", path: "/", message: "Session must be an object." }] };
  }
  if (value.schema !== HARNESS_SESSION_SCHEMA_V0) {
    issues.push({
      code: "FIELD_INVALID",
      path: "/schema",
      message: `schema must be ${HARNESS_SESSION_SCHEMA_V0}.`,
    });
  }
  if (value.v !== HARNESS_SESSION_VERSION) {
    issues.push({ code: "FIELD_INVALID", path: "/v", message: "v must be 0." });
  }
  if (!isRecord(value.input)) {
    issues.push({ code: "FIELD_INVALID", path: "/input", message: "input must be an object." });
  }
  if (!isRecord(value.outputs)) {
    issues.push({ code: "FIELD_INVALID", path: "/outputs", message: "outputs must be an object." });
  }
  return { ok: issues.length === 0, issues };
};
