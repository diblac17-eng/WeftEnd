// src/core/trust_algebra_v0_core.ts
// TRUST_ALGEBRA_V0 helpers (JS-compatible, deterministic).
// @ts-nocheck

import { canonicalJSON } from "./canon";

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export const MAX_REASONS_PER_BLOCK = 32;
export const MAX_REASONS_TOTAL = 2048;
export const MAX_REASON_DETAIL_BYTES = 512;

export const canonicalJSONV0 = (obj) => canonicalJSON(obj);

export const stableSortUniqueStringsV0 = (xs) => {
  const values = Array.isArray(xs) ? xs : [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!isNonEmptyString(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
};

const TRUNCATION_CODE = "TRUST_REASONS_TRUNCATED";

const formatTruncationReason = (kept, dropped) => `${TRUNCATION_CODE}:kept=${kept},dropped=${dropped}`;

const reasonKey = (code, subject, locator) => `${code}\u0000${subject || ""}\u0000${locator || ""}`;

const normalizeReasonArray = (xs, opts) => {
  const values = Array.isArray(xs) ? xs : [];
  const seen = new Set();
  const out = [];
  const allowMeta = opts && opts.allowTruncationCode === true;
  for (const value of values) {
    if (!isNonEmptyString(value)) continue;
    const code = String(value);
    if (!allowMeta && code.startsWith(TRUNCATION_CODE)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  const subject = (opts && opts.subject) || "";
  const locator = (opts && opts.locator) || "";
  out.sort((a, b) => reasonKey(a, subject, locator).localeCompare(reasonKey(b, subject, locator)));
  return out;
};

export const createReasonBudgetV0 = (maxTotal = MAX_REASONS_TOTAL) => ({
  maxTotal: Math.max(0, Math.floor(maxTotal)),
  used: 0,
});

const utf8ByteLength = (value) => {
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

const truncateByBytes = (value, maxBytes) => {
  if (utf8ByteLength(value) <= maxBytes) return value;
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

export const truncateReasonDetailV0 = (detail, maxBytes = MAX_REASON_DETAIL_BYTES) => {
  if (!isNonEmptyString(detail)) return undefined;
  return truncateByBytes(String(detail), maxBytes);
};

export const normalizeReasonCodesV0 = (xs, opts) => {
  const subject = opts && opts.subject;
  const locator = opts && opts.locator;
  const budget = opts && opts.budget;
  const perLimit =
    opts && typeof opts.maxPerSubject === "number"
      ? Math.max(0, Math.floor(opts.maxPerSubject))
      : MAX_REASONS_PER_BLOCK;

  const sorted = normalizeReasonArray(xs, { subject, locator });
  const available = budget ? Math.max(0, budget.maxTotal - budget.used) : sorted.length;
  const limit = Math.min(perLimit, available);

  let out = sorted;
  if (sorted.length > limit) {
    if (limit <= 0) {
      out = [];
    } else {
      const kept = Math.max(0, limit - 1);
      const dropped = sorted.length - kept;
      const trimmed = sorted.slice(0, kept);
      trimmed.push(formatTruncationReason(kept, dropped));
      out = normalizeReasonArray(trimmed, { subject, locator, allowTruncationCode: true });
    }
  }

  if (budget) {
    budget.used = Math.min(budget.maxTotal, budget.used + out.length);
  }

  return out;
};

export const stableSortUniqueReasonsV0 = (xs, opts) => normalizeReasonCodesV0(xs, opts);
export const stableSortUniqueReasonCodesV0 = stableSortUniqueReasonsV0;

export const joinStringsV0 = (a, b) => {
  const merged = [];
  if (Array.isArray(a)) merged.push(...a);
  if (Array.isArray(b)) merged.push(...b);
  return stableSortUniqueStringsV0(merged);
};

export const joinReasonsV0 = (a, b) => joinStringsV0(a, b);

export const joinDecisionV0 = (a, b) => {
  if (a === "NO" || b === "NO") return "NO";
  if (a === "YES" && b === "YES") return "YES";
  return "MAYBE";
};

export const checkpointEqOrReasonV0 = (expected, observed, reasonCode) =>
  expected === observed ? [] : [reasonCode];

export const assertStableSortedUniqueV0 = (xs, kind) => {
  if (!Array.isArray(xs)) {
    throw new Error(`${kind || "values"} must be an array`);
  }
  const normalized = stableSortUniqueStringsV0(xs);
  if (normalized.length !== xs.length) {
    throw new Error(`${kind || "values"} must be unique`);
  }
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] !== xs[i]) {
      throw new Error(`${kind || "values"} must be stable-sorted`);
    }
  }
  return true;
};
