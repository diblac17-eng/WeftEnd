/* src/cli/shadow_audit.ts */
// Deterministic, bounded, proof-only shadow audit lane (explicit CLI only).

import { canonicalJSON } from "../core/canon";
import { cmpNumV0, cmpStrV0 } from "../core/order";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");

const MAX_EVENTS = 512;
const MAX_EVENT_KEYS = 32;
const MAX_STRING_BYTES = 64;
const MAX_REASON_FAMILIES = 32;
const MAX_TARTARUS_KINDS = 32;
const SAFE_TAG_RE = /^[A-Za-z0-9._:-]{1,64}$/;

type JsonObject = Record<string, unknown>;

type ShadowEvent = {
  seq: number;
  kind: string;
  side?: "expected" | "observed";
  data?: Record<string, boolean | number | string | string[]>;
};

type ShadowResult = {
  schema: "weftend.shadowAudit.result/0";
  v: 0;
  status: "OK" | "WARN" | "DENY" | "QUARANTINE";
  reasonFamilies: string[];
  tartarusKindCounts: Record<string, number>;
  counts: {
    events: number;
    warnings: number;
    denies: number;
    quarantines: number;
  };
  sequenceCounts: {
    missing: number;
    extra: number;
    reordered: number;
    duplicate: number;
  };
  capCounts: {
    attemptedWithoutRequest: number;
    allowedWithoutEvidence: number;
    inconsistent: number;
  };
};

type EvalState = {
  reasons: Set<string>;
  events: ShadowEvent[];
};

const printUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend shadow-audit <request.json>");
};

const stableSortUnique = (items: string[]): string[] =>
  Array.from(new Set(items.filter((x) => typeof x === "string" && x.length > 0))).sort((a, b) => cmpStrV0(a, b));

const boundedTag = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!SAFE_TAG_RE.test(s)) return null;
  return s;
};

const isNonNegInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

const isForbiddenKey = (key: string): boolean => {
  const k = key.toLowerCase();
  const norm = k.replace(/[_-]/g, "");
  return (
    norm === "userid" ||
    norm === "deviceid" ||
    norm === "accountid" ||
    norm === "sessionid" ||
    norm === "playerid" ||
    norm === "timestamp" ||
    norm === "timestampms" ||
    norm === "time" ||
    norm === "timems" ||
    norm === "duration" ||
    norm === "durationms" ||
    norm === "url" ||
    norm === "uri" ||
    norm === "hostname" ||
    norm === "host" ||
    norm === "path" ||
    norm === "filepath" ||
    norm === "absolutepath"
  );
};

const hasForbiddenStringPattern = (value: string, key: string): boolean => {
  if (value.includes("://")) return true;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.includes("\\") || value.includes("/")) return true;
  const keyLower = key.toLowerCase();
  const keyImpliesHost =
    keyLower.includes("host") || keyLower.includes("domain") || keyLower.includes("url") || keyLower.includes("uri");
  if (keyImpliesHost && /\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(value)) return true;
  return false;
};

const parseThreshold = (obj: JsonObject, key: string, state: EvalState): number | undefined => {
  const value = obj[key];
  if (typeof value === "undefined") return undefined;
  if (!isNonNegInt(value)) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
    return undefined;
  }
  return value;
};

const parseEventData = (data: unknown, state: EvalState): ShadowEvent["data"] => {
  if (typeof data === "undefined") return undefined;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
    return undefined;
  }
  const keys = Object.keys(data as JsonObject);
  if (keys.length > MAX_EVENT_KEYS) state.reasons.add("SHADOW_AUDIT_BOUNDS_EXCEEDED");
  const out: Record<string, boolean | number | string | string[]> = {};

  for (const key of keys.sort((a, b) => cmpStrV0(a, b))) {
    const tag = boundedTag(key);
    if (!tag) {
      state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
      continue;
    }
    if (isForbiddenKey(tag)) {
      state.reasons.add("SHADOW_AUDIT_PRIVACY_FORBIDDEN");
      continue;
    }
    const value = (data as JsonObject)[key];
    if (tag === "reasonCodes") {
      if (!Array.isArray(value)) {
        state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
        continue;
      }
      const rc: string[] = [];
      for (const item of value) {
        const reason = boundedTag(item);
        if (!reason) {
          state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
          continue;
        }
        rc.push(reason);
      }
      out[tag] = stableSortUnique(rc);
      continue;
    }
    if (typeof value === "boolean") {
      out[tag] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[tag] = value;
      continue;
    }
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
        state.reasons.add("SHADOW_AUDIT_BOUNDS_EXCEEDED");
        continue;
      }
      if (!SAFE_TAG_RE.test(value) || hasForbiddenStringPattern(value, tag)) {
        state.reasons.add("SHADOW_AUDIT_PRIVACY_FORBIDDEN");
        continue;
      }
      out[tag] = value;
      continue;
    }
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  }
  return out;
};

const parseEvents = (eventsRaw: unknown, state: EvalState): ShadowEvent[] => {
  if (!Array.isArray(eventsRaw)) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
    return [];
  }
  const parsed: ShadowEvent[] = [];
  for (const item of eventsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
      continue;
    }
    const keys = Object.keys(item as JsonObject);
    if (keys.length > MAX_EVENT_KEYS) state.reasons.add("SHADOW_AUDIT_BOUNDS_EXCEEDED");
    const seq = (item as JsonObject).seq;
    const kind = boundedTag((item as JsonObject).kind);
    const sideRaw = (item as JsonObject).side;
    const data = parseEventData((item as JsonObject).data, state);
    if (!isNonNegInt(seq) || !kind) {
      state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
      continue;
    }
    let side: "expected" | "observed" | undefined;
    if (typeof sideRaw !== "undefined") {
      if (sideRaw === "expected" || sideRaw === "observed") side = sideRaw;
      else {
        state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
        continue;
      }
    }
    parsed.push({ seq, kind, side, data });
  }
  parsed.sort((a, b) => {
    const cs = cmpNumV0(a.seq, b.seq);
    if (cs !== 0) return cs;
    const as = a.side === "expected" ? 0 : a.side === "observed" ? 1 : 2;
    const bs = b.side === "expected" ? 0 : b.side === "observed" ? 1 : 2;
    const cr = cmpNumV0(as, bs);
    if (cr !== 0) return cr;
    return cmpStrV0(a.kind, b.kind);
  });
  if (parsed.length > MAX_EVENTS) {
    state.reasons.add("SHADOW_AUDIT_BOUNDS_EXCEEDED");
    return parsed.slice(0, MAX_EVENTS);
  }
  return parsed;
};

const computeSequenceCounts = (events: ShadowEvent[]) => {
  const expected = events.filter((e) => e.side === "expected");
  const observed = events.filter((e) => e.side === "observed");

  const makeSeqSet = (xs: ShadowEvent[]): Set<number> => new Set(xs.map((e) => e.seq));
  const expSet = makeSeqSet(expected);
  const obsSet = makeSeqSet(observed);
  let missing = 0;
  let extra = 0;
  expSet.forEach((seq) => {
    if (!obsSet.has(seq)) missing += 1;
  });
  obsSet.forEach((seq) => {
    if (!expSet.has(seq)) extra += 1;
  });

  const countDup = (xs: ShadowEvent[]): number => {
    const seen = new Map<number, number>();
    xs.forEach((e) => seen.set(e.seq, (seen.get(e.seq) || 0) + 1));
    let dup = 0;
    seen.forEach((count) => {
      if (count > 1) dup += count - 1;
    });
    return dup;
  };
  const duplicate = countDup(expected) + countDup(observed);

  const groupedKinds = (xs: ShadowEvent[]): Map<number, string[]> => {
    const out = new Map<number, string[]>();
    xs.forEach((e) => {
      const list = out.get(e.seq) || [];
      list.push(e.kind);
      out.set(e.seq, list);
    });
    out.forEach((kinds) => kinds.sort((a, b) => cmpStrV0(a, b)));
    return out;
  };
  const expKinds = groupedKinds(expected);
  const obsKinds = groupedKinds(observed);
  const commonSeq = Array.from(expSet.values())
    .filter((seq) => obsSet.has(seq))
    .sort((a, b) => cmpNumV0(a, b));
  let reordered = 0;
  commonSeq.forEach((seq) => {
    const ek = expKinds.get(seq) || [];
    const ok = obsKinds.get(seq) || [];
    if (ek.length !== ok.length || ek.some((v, idx) => v !== ok[idx])) reordered += 1;
  });

  return { missing, extra, reordered, duplicate };
};

const computeCapCounts = (events: ShadowEvent[]) => {
  const requested = new Set<string>();
  const allowed = new Set<string>();
  const denied = new Set<string>();
  let attemptedWithoutRequest = 0;
  let allowedWithoutEvidence = 0;

  events.forEach((e) => {
    if (e.kind !== "CAP_REQUEST" && e.kind !== "CAP_ALLOW" && e.kind !== "CAP_DENY") return;
    const capIdRaw = e.data?.capId;
    const capId = boundedTag(capIdRaw);
    if (!capId) return;
    if (e.kind === "CAP_REQUEST") {
      requested.add(capId);
      return;
    }
    if (!requested.has(capId)) attemptedWithoutRequest += 1;
    if (e.kind === "CAP_ALLOW") {
      allowed.add(capId);
      if (e.data?.evidenceOk !== true) allowedWithoutEvidence += 1;
    } else {
      denied.add(capId);
    }
  });

  let inconsistent = 0;
  allowed.forEach((capId) => {
    if (denied.has(capId)) inconsistent += 1;
  });
  return { attemptedWithoutRequest, allowedWithoutEvidence, inconsistent };
};

const buildKindCounts = (events: ShadowEvent[], state: EvalState): Record<string, number> => {
  const map = new Map<string, number>();
  events.forEach((e) => map.set(e.kind, (map.get(e.kind) || 0) + 1));
  const keys = Array.from(map.keys()).sort((a, b) => cmpStrV0(a, b));
  if (keys.length > MAX_TARTARUS_KINDS) state.reasons.add("SHADOW_AUDIT_BOUNDS_EXCEEDED");
  const out: Record<string, number> = {};
  keys.slice(0, MAX_TARTARUS_KINDS).forEach((k) => {
    out[k] = map.get(k) || 0;
  });
  return out;
};

const buildResult = (requestRaw: unknown): ShadowResult => {
  const state: EvalState = { reasons: new Set<string>(), events: [] };
  if (!requestRaw || typeof requestRaw !== "object" || Array.isArray(requestRaw)) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  }
  const req = (requestRaw && typeof requestRaw === "object" ? requestRaw : {}) as JsonObject;
  if (req.schema !== "weftend.shadowAudit.request/0" || req.v !== 0) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  }
  if (!boundedTag(req.rulesetId)) state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  if (typeof req.releaseId !== "undefined" && !boundedTag(req.releaseId)) state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  if (typeof req.pathDigest !== "undefined" && !boundedTag(req.pathDigest)) state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");

  const stream = req.stream as JsonObject | undefined;
  if (!stream || stream.schema !== "weftend.shadowAudit.stream/0" || stream.v !== 0) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  }
  if (stream && typeof stream.streamNonce !== "undefined" && !boundedTag(stream.streamNonce)) {
    state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");
  }

  const events = parseEvents(stream?.events, state);
  state.events = events;

  const policyObj = req.policy && typeof req.policy === "object" && !Array.isArray(req.policy) ? (req.policy as JsonObject) : undefined;
  const deny = policyObj?.denyThresholds;
  const thresholds =
    deny && typeof deny === "object" && !Array.isArray(deny)
      ? {
          missing: parseThreshold(deny as JsonObject, "missing", state),
          extra: parseThreshold(deny as JsonObject, "extra", state),
          reordered: parseThreshold(deny as JsonObject, "reordered", state),
          duplicate: parseThreshold(deny as JsonObject, "duplicate", state),
          attemptedWithoutRequest: parseThreshold(deny as JsonObject, "attemptedWithoutRequest", state),
          allowedWithoutEvidence: parseThreshold(deny as JsonObject, "allowedWithoutEvidence", state),
          inconsistent: parseThreshold(deny as JsonObject, "inconsistent", state),
        }
      : undefined;
  if (typeof deny !== "undefined" && !thresholds) state.reasons.add("SHADOW_AUDIT_SCHEMA_INVALID");

  const sequenceCounts = computeSequenceCounts(events);
  if (sequenceCounts.missing > 0) state.reasons.add("SHADOW_AUDIT_MISSING");
  if (sequenceCounts.extra > 0) state.reasons.add("SHADOW_AUDIT_EXTRA");
  if (sequenceCounts.reordered > 0) state.reasons.add("SHADOW_AUDIT_REORDERED");
  if (sequenceCounts.duplicate > 0) state.reasons.add("SHADOW_AUDIT_DUPLICATE");

  const capCounts = computeCapCounts(events);
  if (capCounts.attemptedWithoutRequest > 0) state.reasons.add("SHADOW_AUDIT_CAP_ATTEMPT_WITHOUT_REQUEST");
  if (capCounts.allowedWithoutEvidence > 0) state.reasons.add("SHADOW_AUDIT_CAP_ALLOWED_WITHOUT_EVIDENCE");
  if (capCounts.inconsistent > 0) state.reasons.add("SHADOW_AUDIT_CAP_INCONSISTENT");

  const exceeds = (value: number, limit: number | undefined): boolean => typeof limit === "number" && value > limit;
  const thresholdDenied =
    exceeds(sequenceCounts.missing, thresholds?.missing) ||
    exceeds(sequenceCounts.extra, thresholds?.extra) ||
    exceeds(sequenceCounts.reordered, thresholds?.reordered) ||
    exceeds(sequenceCounts.duplicate, thresholds?.duplicate) ||
    exceeds(capCounts.attemptedWithoutRequest, thresholds?.attemptedWithoutRequest) ||
    exceeds(capCounts.allowedWithoutEvidence, thresholds?.allowedWithoutEvidence) ||
    exceeds(capCounts.inconsistent, thresholds?.inconsistent);

  const denyReasons = ["SHADOW_AUDIT_SCHEMA_INVALID", "SHADOW_AUDIT_BOUNDS_EXCEEDED", "SHADOW_AUDIT_PRIVACY_FORBIDDEN"];
  const hardDenied = denyReasons.some((code) => state.reasons.has(code));

  const tartarusKindCounts = buildKindCounts(events, state);
  let reasonFamilies = stableSortUnique(Array.from(state.reasons.values()));
  if (reasonFamilies.length > MAX_REASON_FAMILIES) {
    reasonFamilies = reasonFamilies.slice(0, MAX_REASON_FAMILIES);
    if (!reasonFamilies.includes("SHADOW_AUDIT_BOUNDS_EXCEEDED")) {
      reasonFamilies[reasonFamilies.length - 1] = "SHADOW_AUDIT_BOUNDS_EXCEEDED";
      reasonFamilies = stableSortUnique(reasonFamilies);
    }
  }

  let status: ShadowResult["status"] = "OK";
  if (hardDenied || thresholdDenied) status = "DENY";
  else if (
    reasonFamilies.length > 0 ||
    sequenceCounts.missing > 0 ||
    sequenceCounts.extra > 0 ||
    sequenceCounts.reordered > 0 ||
    sequenceCounts.duplicate > 0 ||
    capCounts.attemptedWithoutRequest > 0 ||
    capCounts.allowedWithoutEvidence > 0 ||
    capCounts.inconsistent > 0
  ) {
    status = "WARN";
  }

  return {
    schema: "weftend.shadowAudit.result/0",
    v: 0,
    status,
    reasonFamilies,
    tartarusKindCounts,
    counts: {
      events: events.length,
      warnings: status === "WARN" ? reasonFamilies.length : 0,
      denies: status === "DENY" ? reasonFamilies.length : 0,
      quarantines: 0,
    },
    sequenceCounts,
    capCounts,
  };
};

export const runShadowAuditCli = (args: string[]): number => {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return 1;
  }
  const requestPath = String(args[0] || "").trim();
  if (!requestPath) {
    printUsage();
    return 1;
  }

  let requestRaw: unknown;
  try {
    const text = fs.readFileSync(requestPath, "utf8");
    requestRaw = JSON.parse(text);
  } catch {
    const result = buildResult({});
    process.stdout.write(`${canonicalJSON(result)}\n`);
    return 40;
  }

  const result = buildResult(requestRaw);
  process.stdout.write(`${canonicalJSON(result)}\n`);
  return result.status === "DENY" ? 40 : 0;
};
