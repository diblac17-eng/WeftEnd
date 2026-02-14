// src/core/trust_algebra_v0.ts
// TRUST_ALGEBRA_V0 helpers (pure, deterministic).

import { canonicalJSON } from "./canon";
import { cmpStrV0 } from "./order";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const MAX_REASONS_PER_BLOCK = 32;
export const MAX_REASONS_TOTAL = 2048;
export const MAX_REASON_DETAIL_BYTES = 512;

export interface ReasonBudgetV0 {
  maxTotal: number;
  used: number;
}

export interface ReasonNormalizeOptionsV0 {
  maxPerSubject?: number;
  budget?: ReasonBudgetV0;
  subject?: string;
  locator?: string;
}

export const canonicalJSONV0 = (obj: unknown): string => canonicalJSON(obj);

export const stableSortUniqueStringsV0 = (xs?: readonly unknown[] | null): string[] => {
  const values: unknown[] = Array.isArray(xs) ? xs : [];
  const seen = new Set<string>();
  const out: string[] = [];
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

const formatTruncationReason = (kept: number, dropped: number): string =>
  `${TRUNCATION_CODE}:kept=${kept},dropped=${dropped}`;

const reasonKey = (code: string, subject?: string, locator?: string): string =>
  `${code}\u0000${subject ?? ""}\u0000${locator ?? ""}`;

const normalizeReasonArray = (
  xs: readonly unknown[] | null | undefined,
  opts: { allowTruncationCode?: boolean; subject?: string; locator?: string }
): string[] => {
  const values: unknown[] = Array.isArray(xs) ? xs : [];
  const seen = new Set<string>();
  const out: string[] = [];
  const allowMeta = opts.allowTruncationCode === true;
  for (const value of values) {
    if (!isNonEmptyString(value)) continue;
    const code = String(value);
    if (!allowMeta && code.startsWith(TRUNCATION_CODE)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  const subject = opts.subject ?? "";
  const locator = opts.locator ?? "";
  out.sort((a, b) => cmpStrV0(reasonKey(a, subject, locator), reasonKey(b, subject, locator)));
  return out;
};

export const createReasonBudgetV0 = (maxTotal: number = MAX_REASONS_TOTAL): ReasonBudgetV0 => ({
  maxTotal: Math.max(0, Math.floor(maxTotal)),
  used: 0,
});

const utf8ByteLength = (value: string): number => {
  let count = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x7f) count += 1;
    else if (code <= 0x7ff) count += 2;
    else if (code <= 0xffff) count += 3;
    else count += 4;
  }
  return count;
};

const truncateByBytes = (value: string, maxBytes: number): string => {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let out = "";
  let count = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (count + size > maxBytes) break;
    out += ch;
    count += size;
  }
  return out;
};

export const truncateReasonDetailV0 = (
  detail: unknown,
  maxBytes: number = MAX_REASON_DETAIL_BYTES
): string | undefined => {
  if (!isNonEmptyString(detail)) return undefined;
  return truncateByBytes(String(detail), maxBytes);
};

export const normalizeReasonCodesV0 = (
  xs?: readonly unknown[] | null,
  opts?: ReasonNormalizeOptionsV0
): string[] => {
  const subject = opts?.subject;
  const locator = opts?.locator;
  const budget = opts?.budget;
  const perLimit =
    typeof opts?.maxPerSubject === "number"
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

export const stableSortUniqueReasonsV0 = (
  xs?: readonly unknown[] | null,
  opts?: ReasonNormalizeOptionsV0
): string[] => normalizeReasonCodesV0(xs, opts);
export const stableSortUniqueReasonCodesV0 = stableSortUniqueReasonsV0;

export const joinStringsV0 = (a?: readonly unknown[] | null, b?: readonly unknown[] | null): string[] => {
  const merged: unknown[] = [];
  if (Array.isArray(a)) merged.push(...a);
  if (Array.isArray(b)) merged.push(...b);
  return stableSortUniqueStringsV0(merged);
};

export const joinReasonsV0 = (a?: readonly unknown[] | null, b?: readonly unknown[] | null): string[] =>
  joinStringsV0(a, b);

export const joinDecisionV0 = (a: "YES" | "NO" | "MAYBE", b: "YES" | "NO" | "MAYBE") => {
  if (a === "NO" || b === "NO") return "NO";
  if (a === "YES" && b === "YES") return "YES";
  return "MAYBE";
};

export const checkpointEqOrReasonV0 = (expected: unknown, observed: unknown, reasonCode: string): string[] =>
  expected === observed ? [] : [reasonCode];

export const assertStableSortedUniqueV0 = (xs: readonly string[], kind?: string): true => {
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
