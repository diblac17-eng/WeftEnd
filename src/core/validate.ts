/* src/core/validate.ts */
/**
 * WeftEnd (WebLayers v2.6) — Fail-closed validators for core schemas.
 *
 * Core rules:
 * - validate unknown input as untrusted (fail closed)
 * - validate shape + enums + NodeId grammar
 * - validate bundle binding invariants so runtime can enforce without loopholes
 */

import type {
  ExecutionPlan,
  GateReceiptV0,
  GraphManifest,
  HostRunReceiptV0,
  HostStatusReceiptV0,
  HostSelfManifestV0,
  HostUpdateReceiptV0,
  CompareReceiptV0,
  MintGradeStatusV1,
  MintProbeResultV1,
  OperatorReceiptV0,
  RunReceiptV0,
  SafeRunReceiptV0,
  WeftendBuildV0,
  WeftendMintPackageV1,
  PulseBodyV0,
  PulseV0,
  Result,
  RuntimeBundle,
  SecretBox,
  TrustNodeResult,
  TrustResult,
  WeftendEntitlementV1,
} from "./types";
import type { IntakeActionV1, IntakeSeverityV1, WeftEndPolicyV1 } from "./types";

import { canonicalJSON } from "./canon";
import { sha256HexV0 } from "./hash_v0";
import { computeMintDigestV1 } from "./mint_digest";
import { computePulseDigestV0 } from "./pulse_digest";
import { MAX_REASONS_PER_BLOCK, checkpointEqOrReasonV0, stableSortUniqueReasonsV0 } from "./trust_algebra_v0";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

const ok = <T>(value: T): Result<T, ValidationIssue[]> => ({ ok: true, value });

function cmpStr(a: string, b: string): number {
  // Locale-independent deterministic string compare (code-unit).
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortIssuesDeterministically(issues: ValidationIssue[]): ValidationIssue[] {
  // Stable sort by (code, path, message), then original index.
  return issues
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ac = a.v.code ?? "";
      const bc = b.v.code ?? "";
      const c0 = cmpStr(ac, bc);
      if (c0 !== 0) return c0;

      const ap = a.v.path ?? "\uffff";
      const bp = b.v.path ?? "\uffff";
      const c1 = cmpStr(ap, bp);
      if (c1 !== 0) return c1;

      const am = a.v.message ?? "";
      const bm = b.v.message ?? "";
      const c2 = cmpStr(am, bm);
      if (c2 !== 0) return c2;

      return a.i - b.i;
    })
    .map((x) => x.v);
}

const err = <T = never>(issues: ValidationIssue[]): Result<T, ValidationIssue[]> => ({
  ok: false,
  error: sortIssuesDeterministically([...issues]),
});

const issue = (code: string, message: string, path?: string): ValidationIssue => ({
  code,
  message,
  path,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = Array.isArray;
declare const Buffer: any;

const asStringArray = (v: unknown): string[] | null => {
  if (!isArray(v)) return null;
  for (const x of v) if (!isString(x)) return null;
  return v as string[];
};

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const hasOnlyKeys = (obj: Record<string, unknown>, allowed: string[]): boolean => {
  const keys = Object.keys(obj);
  return keys.every((k) => allowed.includes(k));
};

const isTightString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !/\s/.test(v);
const isBoundedTightString = (v: unknown, maxBytes: number): v is string =>
  isTightString(v) && utf8ByteLength(v) <= maxBytes;
const isBoundedString = (v: unknown, maxBytes: number): v is string =>
  typeof v === "string" && v.length > 0 && utf8ByteLength(v) <= maxBytes;

const isDateYmd = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const isSortedUniqueStrings = (values: string[]): boolean => {
  for (let i = 1; i < values.length; i += 1) {
    if (cmpStr(values[i - 1], values[i]) >= 0) return false;
  }
  return true;
};

const isNamespacedKind = (v: unknown): v is string => {
  if (!isNonEmptyString(v)) return false;
  const s = v.trim();
  if (/\s/.test(s)) return false;
  if (!s.includes(".")) return false;
  if (s.startsWith(".") || s.endsWith(".")) return false;
  return true;
};

const isSortedArtifacts = (items: { nodeId: string; contentHash: string }[]): boolean => {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const curr = items[i];
    const c0 = cmpStr(prev.nodeId, curr.nodeId);
    if (c0 > 0) return false;
    if (c0 === 0 && cmpStr(prev.contentHash, curr.contentHash) > 0) return false;
  }
  return true;
};

const isSortedGrants = (items: { blockHash: string; eligibleCaps: string[] }[]): boolean => {
  for (let i = 1; i < items.length; i += 1) {
    if (cmpStr(items[i - 1].blockHash, items[i].blockHash) >= 0) return false;
  }
  return true;
};

const isSortedByLocatorDigest = (items: { locator: string; digest: string }[]): boolean => {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const next = items[i];
    const c0 = cmpStr(prev.locator, next.locator);
    if (c0 > 0) return false;
    if (c0 === 0 && cmpStr(prev.digest, next.digest) >= 0) return false;
  }
  return true;
};

const isSortedByRefDigest = (items: { ref: string; digest: string }[]): boolean => {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const next = items[i];
    const c0 = cmpStr(prev.ref, next.ref);
    if (c0 > 0) return false;
    if (c0 === 0 && cmpStr(prev.digest, next.digest) >= 0) return false;
  }
  return true;
};

const isIntakeSeverityV1 = (v: unknown): v is IntakeSeverityV1 =>
  v === "INFO" || v === "WARN" || v === "DENY" || v === "QUARANTINE";

const isIntakeActionV1 = (v: unknown): v is IntakeActionV1 =>
  v === "APPROVE" || v === "QUEUE" || v === "REJECT" || v === "HOLD";

const isRunExecutionStatusV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "DENY" || v === "QUARANTINE" || v === "SKIP";

const isStrictVerifyVerdictV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "DENY" || v === "QUARANTINE";

const isStrictExecuteOutcomeV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "DENY" || v === "SKIP";

const isHostVerifyVerdictV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "DENY";

const isHostExecuteOutcomeV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "DENY" || v === "SKIP";

const isSafeRunExecutionResultV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "DENY" || v === "SKIP" || v === "WITHHELD";

const isCompareVerdictV0 = (v: unknown): boolean => v === "SAME" || v === "CHANGED";

const isArtifactKindV0 = (v: unknown): boolean =>
  v === "RELEASE_DIR" ||
  v === "WEB_DIR" ||
  v === "ZIP" ||
  v === "NATIVE_EXE" ||
  v === "NATIVE_MSI" ||
  v === "SHORTCUT_LNK" ||
  v === "SCRIPT_JS" ||
  v === "SCRIPT_PS1" ||
  v === "TEXT" ||
  v === "UNKNOWN";

const isSafeRunAnalysisVerdictV0 = (v: unknown): boolean =>
  v === "ALLOW" || v === "WITHHELD" || v === "DENY";

const isSafeRunExecutionVerdictV0 = (v: unknown): boolean =>
  v === "NOT_ATTEMPTED" || v === "SKIP" || v === "ALLOW" || v === "DENY";

const isHostStatusResultV0 = (v: unknown): boolean =>
  v === "OK" || v === "UNVERIFIED";

const isHostOutRootSourceV0 = (v: unknown): boolean =>
  v === "ARG_OUT" || v === "ENV_OUT_ROOT";

const isOperatorCommandV0 = (v: unknown): boolean =>
  v === "host status" || v === "host run" || v === "host update" || v === "run" || v === "safe-run" || v === "compare";

const sha256 = (input: string): string => sha256HexV0(input);

const utf8ByteLength = (value: string): number => {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").length;
  }
  return value.length;
};

const base64ByteLength = (b64: string): number | null => {
  if (!isString(b64) || b64.length === 0) return null;
  if (/\s/.test(b64)) return null;
  const normalized = b64.replace(/=+$/, "");
  if (normalized.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  if (typeof Buffer !== "undefined") {
    try {
      return Buffer.from(b64, "base64").length;
    } catch {
      return null;
    }
  }
  const pad = (b64.match(/=+$/) || [""])[0].length;
  return Math.floor((b64.length * 3) / 4) - pad;
};

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, "");

const FORBIDDEN_KEYS = new Set([
  "ip",
  "ipaddress",
  "useragent",
  "ua",
  "hostname",
  "email",
  "deviceid",
  "sessionid",
  "userid",
  "accountid",
  "playerid",
  "cookie",
  "token",
  "authtoken",
  "password",
  "secret",
]);

const TIME_KEYS = new Set([
  "createdat",
  "updatedat",
  "builtat",
  "issuedat",
  "expiresat",
  "timestamp",
  "datetime",
  "time",
  "date",
]);

const isForbiddenKey = (key: string): boolean => FORBIDDEN_KEYS.has(normalizeKey(key));
const isTimeKey = (key: string): boolean => TIME_KEYS.has(normalizeKey(key));

const looksLikeEmail = (value: string): boolean => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
const looksLikeIp = (value: string): boolean => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value);
const looksLikeUrl = (value: string): boolean => /[a-z]+:\/\//i.test(value);
const looksLikeAbsPath = (value: string): boolean =>
  value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value);
const looksLikeEnvMarker = (value: string): boolean =>
  /%[A-Za-z_][A-Za-z0-9_]*%/.test(value) ||
  /\$env:[A-Za-z_][A-Za-z0-9_]*/.test(value) ||
  /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(value);
const containsSensitiveMarker = (value: string): boolean =>
  /\\Users\\/.test(value) ||
  /\/Users\//.test(value) ||
  /\/home\//.test(value) ||
  /\\\\[A-Za-z0-9._-]+\\/.test(value) ||
  looksLikeAbsPath(value) ||
  looksLikeEnvMarker(value);

const isSafeExt = (value: string): boolean =>
  isBoundedTightString(value, MAX_CONTENT_EXT_BYTES) && !/[\\/]/.test(value) && !/\s/.test(value);

const isYesNoUnknown = (value: unknown): boolean =>
  value === "yes" || value === "no" || value === "unknown";

const isForbiddenValue = (value: string): boolean =>
  looksLikeEmail(value) || looksLikeIp(value) || looksLikeUrl(value) || looksLikeAbsPath(value);

const isUntrustedString = (value: string): boolean =>
  /\s/.test(value) || utf8ByteLength(value) > PRIVACY_MAX_STRING_BYTES;

const MAX_SECRETBOX_BYTES = 16 * 1024;
const MAX_RELEASE_SIG_BYTES = 4096;
const PRIVACY_MAX_RECEIPT_SIGNATURES = 8;
const PRIVACY_MAX_STRING_BYTES = 512;
const MAX_RECOVERY_ACTIONS = 64;
const MAX_RECOVERY_STR_BYTES = 512;
const MAX_ATTESTATION_ITEMS = 2048;
const MAX_ATTESTATION_STR_BYTES = 512;
const MAX_VERIFY_REASON_CODES = 2048;
const MAX_PULSE_ITEMS = 512;
const MAX_MINT_EXTERNAL_REFS = 200;
const MAX_MINT_REASON_CODES = 64;
const MAX_MINT_RECEIPTS = 64;
const MAX_MINT_PATHS = 200;
const MAX_MINT_STRING_BYTES = 256;
const MAX_MINT_JSON_BYTES = 1024 * 1024;
const MAX_HOST_PATH_BYTES = 1024;
const MAX_COMPARE_BUCKETS = 32;
const MAX_COMPARE_REASON_CODES = 256;
const MAX_COMPARE_CHANGE_ITEMS = 256;
const MAX_CONTENT_TOP_EXT = 12;
const MAX_CONTENT_EXT_BYTES = 16;
const MAX_CONTENT_INDICATOR = 1000;
const MAX_CONTENT_DOMAINS = 10;
const MAX_CONTENT_HINTS = 12;
const MAX_CONTENT_MARKERS = 32;

function validateContentSummaryV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "contentSummary must be an object.", path)];

  const allowed = [
    "targetKind",
    "artifactKind",
    "fileCountsByKind",
    "totalFiles",
    "totalBytesBounded",
    "sizeSummary",
    "topExtensions",
    "hasNativeBinaries",
    "hasScripts",
    "hasHtml",
    "externalRefs",
    "entryHints",
    "boundednessMarkers",
    "archiveDepthMax",
    "nestedArchiveCount",
    "manifestCount",
    "stringsIndicators",
    "signingSummary",
    "policyMatch",
    "hashFamily",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "contentSummary contains disallowed fields.", path));
  }

  const o = v as any;
  const isTargetKind =
    o.targetKind === "nativeBinary" ||
    o.targetKind === "shortcut" ||
    o.targetKind === "directory" ||
    o.targetKind === "zip" ||
    o.targetKind === "file" ||
    o.targetKind === "missing";
  if (!isTargetKind) {
    issues.push(issue("ENUM_INVALID", "targetKind must be nativeBinary|shortcut|directory|zip|file|missing.", `${path}.targetKind`));
  }
  const isArtifactKind =
    o.artifactKind === "executable" ||
    o.artifactKind === "webBundle" ||
    o.artifactKind === "dataOnly" ||
    o.artifactKind === "unknown";
  if (!isArtifactKind) {
    issues.push(issue("ENUM_INVALID", "artifactKind must be executable|webBundle|dataOnly|unknown.", `${path}.artifactKind`));
  }
  const kindKeys = ["html", "js", "css", "json", "wasm", "media", "binary", "other"];
  if (!isRecord(o.fileCountsByKind)) {
    issues.push(issue("FIELD_INVALID", "fileCountsByKind must be an object.", `${path}.fileCountsByKind`));
  } else {
    if (!hasOnlyKeys(o.fileCountsByKind, kindKeys)) {
      issues.push(issue("FIELD_INVALID", "fileCountsByKind contains disallowed fields.", `${path}.fileCountsByKind`));
    }
    kindKeys.forEach((key) => {
      const value = (o.fileCountsByKind as any)[key];
      if (!isNumber(value) || value < 0) {
        issues.push(issue("FIELD_INVALID", "fileCountsByKind values must be non-negative numbers.", `${path}.fileCountsByKind.${key}`));
      }
    });
  }

  if (!isNumber(o.totalFiles) || o.totalFiles < 0) {
    issues.push(issue("FIELD_INVALID", "totalFiles must be a non-negative number.", `${path}.totalFiles`));
  }
  if (!isNumber(o.totalBytesBounded) || o.totalBytesBounded < 0) {
    issues.push(issue("FIELD_INVALID", "totalBytesBounded must be a non-negative number.", `${path}.totalBytesBounded`));
  }
  if (!isRecord(o.sizeSummary)) {
    issues.push(issue("FIELD_INVALID", "sizeSummary must be an object.", `${path}.sizeSummary`));
  } else {
    if (!isNumber(o.sizeSummary.totalBytesBounded) || o.sizeSummary.totalBytesBounded < 0) {
      issues.push(issue("FIELD_INVALID", "sizeSummary.totalBytesBounded must be a non-negative number.", `${path}.sizeSummary.totalBytesBounded`));
    }
    if (!isBoolean(o.sizeSummary.truncated)) {
      issues.push(issue("FIELD_INVALID", "sizeSummary.truncated must be boolean.", `${path}.sizeSummary.truncated`));
    }
    if (!hasOnlyKeys(o.sizeSummary, ["totalBytesBounded", "truncated"])) {
      issues.push(issue("FIELD_INVALID", "sizeSummary contains disallowed fields.", `${path}.sizeSummary`));
    }
  }

  if (!isArray(o.topExtensions)) {
    issues.push(issue("FIELD_INVALID", "topExtensions must be an array.", `${path}.topExtensions`));
  } else {
    if (o.topExtensions.length > MAX_CONTENT_TOP_EXT) {
      issues.push(issue("FIELD_INVALID", `topExtensions exceeds ${MAX_CONTENT_TOP_EXT}.`, `${path}.topExtensions`));
    }
    const items: Array<{ ext: string; count: number }> = [];
    o.topExtensions.forEach((item: unknown, i: number) => {
      const itemPath = `${path}.topExtensions[${i}]`;
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "topExtensions entry must be an object.", itemPath));
        return;
      }
      const ext = (item as any).ext;
      const count = (item as any).count;
      if (!isSafeExt(ext)) {
        issues.push(issue("FIELD_INVALID", "ext must be a short extension string.", `${itemPath}.ext`));
      } else if (containsSensitiveMarker(ext)) {
        issues.push(issue("FIELD_INVALID", "ext contains sensitive markers.", `${itemPath}.ext`));
      }
      if (!isNumber(count) || count < 0) {
        issues.push(issue("FIELD_INVALID", "count must be a non-negative number.", `${itemPath}.count`));
      }
      if (!hasOnlyKeys(item as Record<string, unknown>, ["ext", "count"])) {
        issues.push(issue("FIELD_INVALID", "topExtensions entry contains disallowed fields.", itemPath));
      }
      if (isSafeExt(ext) && isNumber(count)) items.push({ ext, count });
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => {
        const c0 = b.count - a.count;
        if (c0 !== 0) return c0;
        return cmpStr(a.ext, b.ext);
      });
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].ext !== sorted[i].ext || items[i].count !== sorted[i].count) {
          issues.push(issue("FIELD_INVALID", "topExtensions must be sorted by count desc then ext.", `${path}.topExtensions`));
          break;
        }
      }
    }
  }

  if (!isBoolean(o.hasNativeBinaries)) {
    issues.push(issue("FIELD_INVALID", "hasNativeBinaries must be boolean.", `${path}.hasNativeBinaries`));
  }
  if (!isBoolean(o.hasScripts)) {
    issues.push(issue("FIELD_INVALID", "hasScripts must be boolean.", `${path}.hasScripts`));
  }
  if (!isBoolean(o.hasHtml)) {
    issues.push(issue("FIELD_INVALID", "hasHtml must be boolean.", `${path}.hasHtml`));
  }
  if (!isRecord(o.externalRefs)) {
    issues.push(issue("FIELD_INVALID", "externalRefs must be an object.", `${path}.externalRefs`));
  } else {
    if (!isNumber(o.externalRefs.count) || o.externalRefs.count < 0) {
      issues.push(issue("FIELD_INVALID", "externalRefs.count must be a non-negative number.", `${path}.externalRefs.count`));
    }
    const domains = asStringArray(o.externalRefs.topDomains);
    if (!domains) {
      issues.push(issue("FIELD_INVALID", "externalRefs.topDomains must be string[].", `${path}.externalRefs.topDomains`));
    } else {
      if (!isSortedUniqueStrings(domains)) {
        issues.push(issue("FIELD_INVALID", "externalRefs.topDomains must be stable-sorted and unique.", `${path}.externalRefs.topDomains`));
      }
      if (domains.length > MAX_CONTENT_DOMAINS) {
        issues.push(issue("FIELD_INVALID", `externalRefs.topDomains exceeds ${MAX_CONTENT_DOMAINS}.`, `${path}.externalRefs.topDomains`));
      }
      domains.forEach((value, i) => {
        if (!isBoundedTightString(value, PRIVACY_MAX_STRING_BYTES)) {
          issues.push(issue("FIELD_INVALID", "externalRefs.topDomains entries must be non-empty strings.", `${path}.externalRefs.topDomains[${i}]`));
        } else if (containsSensitiveMarker(value) || /[\\/]/.test(value)) {
          issues.push(issue("FIELD_INVALID", "externalRefs.topDomains entries must be domain-only strings.", `${path}.externalRefs.topDomains[${i}]`));
        }
      });
    }
    if (!hasOnlyKeys(o.externalRefs, ["count", "topDomains"])) {
      issues.push(issue("FIELD_INVALID", "externalRefs contains disallowed fields.", `${path}.externalRefs`));
    }
  }
  const entryHints = asStringArray(o.entryHints);
  if (!entryHints) {
    issues.push(issue("FIELD_INVALID", "entryHints must be string[].", `${path}.entryHints`));
  } else {
    if (!isSortedUniqueStrings(entryHints)) {
      issues.push(issue("FIELD_INVALID", "entryHints must be stable-sorted and unique.", `${path}.entryHints`));
    }
    if (entryHints.length > MAX_CONTENT_HINTS) {
      issues.push(issue("FIELD_INVALID", `entryHints exceeds ${MAX_CONTENT_HINTS}.`, `${path}.entryHints`));
    }
    entryHints.forEach((value, i) => {
      if (!isBoundedTightString(value, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "entryHints entries must be non-empty strings.", `${path}.entryHints[${i}]`));
      } else if (containsSensitiveMarker(value) || /[\\/]/.test(value)) {
        issues.push(issue("FIELD_INVALID", "entryHints entries must be short labels.", `${path}.entryHints[${i}]`));
      }
    });
  }
  const markers = asStringArray(o.boundednessMarkers);
  if (!markers) {
    issues.push(issue("FIELD_INVALID", "boundednessMarkers must be string[].", `${path}.boundednessMarkers`));
  } else {
    if (!isSortedUniqueStrings(markers)) {
      issues.push(issue("FIELD_INVALID", "boundednessMarkers must be stable-sorted and unique.", `${path}.boundednessMarkers`));
    }
    if (markers.length > MAX_CONTENT_MARKERS) {
      issues.push(issue("FIELD_INVALID", `boundednessMarkers exceeds ${MAX_CONTENT_MARKERS}.`, `${path}.boundednessMarkers`));
    }
    markers.forEach((value, i) => {
      if (!isBoundedTightString(value, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "boundednessMarkers entries must be non-empty strings.", `${path}.boundednessMarkers[${i}]`));
      } else if (containsSensitiveMarker(value) || /[\\/]/.test(value)) {
        issues.push(issue("FIELD_INVALID", "boundednessMarkers entries must be short labels.", `${path}.boundednessMarkers[${i}]`));
      }
    });
  }
  if (!isNumber(o.archiveDepthMax) || o.archiveDepthMax < 0) {
    issues.push(issue("FIELD_INVALID", "archiveDepthMax must be a non-negative number.", `${path}.archiveDepthMax`));
  }
  if (!isNumber(o.nestedArchiveCount) || o.nestedArchiveCount < 0) {
    issues.push(issue("FIELD_INVALID", "nestedArchiveCount must be a non-negative number.", `${path}.nestedArchiveCount`));
  }
  if (!isNumber(o.manifestCount) || o.manifestCount < 0) {
    issues.push(issue("FIELD_INVALID", "manifestCount must be a non-negative number.", `${path}.manifestCount`));
  }

  if (!isRecord(o.stringsIndicators)) {
    issues.push(issue("FIELD_INVALID", "stringsIndicators must be an object.", `${path}.stringsIndicators`));
  } else {
    const indicatorKeys = ["urlLikeCount", "ipLikeCount", "powershellLikeCount", "cmdExecLikeCount"];
    if (!hasOnlyKeys(o.stringsIndicators, indicatorKeys)) {
      issues.push(issue("FIELD_INVALID", "stringsIndicators contains disallowed fields.", `${path}.stringsIndicators`));
    }
    indicatorKeys.forEach((key) => {
      const value = (o.stringsIndicators as any)[key];
      if (!isNumber(value) || value < 0 || value > MAX_CONTENT_INDICATOR) {
        issues.push(issue("FIELD_INVALID", `stringsIndicators.${key} must be 0..${MAX_CONTENT_INDICATOR}.`, `${path}.stringsIndicators.${key}`));
      }
    });
  }

  if (o.signingSummary !== undefined) {
    if (!isRecord(o.signingSummary)) {
      issues.push(issue("FIELD_INVALID", "signingSummary must be an object when present.", `${path}.signingSummary`));
    } else {
      const allowedSummary = [
        "signaturePresent",
        "signerCountBounded",
        "timestampPresent",
        "importTablePresent",
        "importTableSize",
        "peMachine",
        "peSections",
      ];
      if (!hasOnlyKeys(o.signingSummary, allowedSummary)) {
        issues.push(issue("FIELD_INVALID", "signingSummary contains disallowed fields.", `${path}.signingSummary`));
      }
      if (!isYesNoUnknown(o.signingSummary.signaturePresent)) {
        issues.push(issue("FIELD_INVALID", "signaturePresent must be yes|no|unknown.", `${path}.signingSummary.signaturePresent`));
      }
      if (!isYesNoUnknown(o.signingSummary.timestampPresent)) {
        issues.push(issue("FIELD_INVALID", "timestampPresent must be yes|no|unknown.", `${path}.signingSummary.timestampPresent`));
      }
      if (!isYesNoUnknown(o.signingSummary.importTablePresent)) {
        issues.push(issue("FIELD_INVALID", "importTablePresent must be yes|no|unknown.", `${path}.signingSummary.importTablePresent`));
      }
      if (!isNumber(o.signingSummary.signerCountBounded) || o.signingSummary.signerCountBounded < 0) {
        issues.push(issue("FIELD_INVALID", "signerCountBounded must be a non-negative number.", `${path}.signingSummary.signerCountBounded`));
      }
      if (o.signingSummary.importTableSize !== undefined && (!isNumber(o.signingSummary.importTableSize) || o.signingSummary.importTableSize < 0)) {
        issues.push(issue("FIELD_INVALID", "importTableSize must be a non-negative number when present.", `${path}.signingSummary.importTableSize`));
      }
      if (o.signingSummary.peMachine !== undefined && !isBoundedTightString(o.signingSummary.peMachine, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "peMachine must be a short string when present.", `${path}.signingSummary.peMachine`));
      }
      if (o.signingSummary.peSections !== undefined && (!isNumber(o.signingSummary.peSections) || o.signingSummary.peSections < 0)) {
        issues.push(issue("FIELD_INVALID", "peSections must be a non-negative number when present.", `${path}.signingSummary.peSections`));
      }
    }
  }

  if (!isRecord(o.policyMatch)) {
    issues.push(issue("FIELD_INVALID", "policyMatch must be an object.", `${path}.policyMatch`));
  } else {
    if (!isBoundedTightString(o.policyMatch.selectedPolicy, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "policyMatch.selectedPolicy must be a non-empty string.", `${path}.policyMatch.selectedPolicy`));
    } else if (containsSensitiveMarker(o.policyMatch.selectedPolicy) || /[\\/]/.test(o.policyMatch.selectedPolicy)) {
      issues.push(issue("FIELD_INVALID", "policyMatch.selectedPolicy must be a filename only.", `${path}.policyMatch.selectedPolicy`));
    }
    const reasons = asStringArray(o.policyMatch.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "policyMatch.reasonCodes must be string[].", `${path}.policyMatch.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "policyMatch.reasonCodes must be stable-sorted and unique.", `${path}.policyMatch.reasonCodes`));
    }
  }

  if (!isRecord(o.hashFamily)) {
    issues.push(issue("FIELD_INVALID", "hashFamily must be an object.", `${path}.hashFamily`));
  } else {
    if (!isTightString(o.hashFamily.sha256)) {
      issues.push(issue("FIELD_INVALID", "hashFamily.sha256 must be a non-empty string.", `${path}.hashFamily.sha256`));
    } else if (containsSensitiveMarker(o.hashFamily.sha256)) {
      issues.push(issue("FIELD_INVALID", "hashFamily.sha256 contains sensitive markers.", `${path}.hashFamily.sha256`));
    }
    if (!hasOnlyKeys(o.hashFamily, ["sha256"])) {
      issues.push(issue("FIELD_INVALID", "hashFamily contains disallowed fields.", `${path}.hashFamily`));
    }
  }

  return issues;
}

const safeCanonicalJSON = (v: unknown): string | null => {
  try {
    return canonicalJSON(v);
  } catch {
    return null;
  }
};

export function validateNodeId(v: unknown, path = "nodeId"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isString(v) || v.length === 0) {
    issues.push(issue("NODE_ID_INVALID", "NodeId must be a non-empty string.", path));
    return issues;
  }
  if (/\s/.test(v)) {
    issues.push(issue("NODE_ID_INVALID", "NodeId must not contain whitespace.", path));
  }

  const s = v;

  const okPrefix =
    s.startsWith("page:/") ||
    s.startsWith("block:") ||
    s.startsWith("svc:") ||
    s.startsWith("data:") ||
    s.startsWith("priv:") ||
    s.startsWith("sess:") ||
    s.startsWith("asset:");

  if (!okPrefix) {
    issues.push(
      issue(
        "NODE_ID_INVALID",
        "NodeId must start with one of: page:/, block:, svc:, data:, priv:, sess:, asset:",
        path
      )
    );
  }

  return issues;
}

function validateSignature(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "Signature must be an object.", path)];

  const o = v as any;
  if (!isString(o.algo) || o.algo.length === 0)
    issues.push(issue("FIELD_INVALID", "algo must be a non-empty string.", `${path}.algo`));
  if (!isString(o.keyId) || o.keyId.length === 0)
    issues.push(issue("FIELD_INVALID", "keyId must be a non-empty string.", `${path}.keyId`));
  if (!isString(o.sig) || o.sig.length === 0)
    issues.push(issue("FIELD_INVALID", "sig must be a non-empty string.", `${path}.sig`));

  return issues;
}

function validateCapRequest(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "CapabilityRequest must be an object.", path)];

  const o = v as any;

  if (!isString(o.capId) || o.capId.length === 0)
    issues.push(issue("FIELD_INVALID", "capId must be a non-empty string.", `${path}.capId`));

  if (o.params !== undefined && !isRecord(o.params))
    issues.push(issue("FIELD_INVALID", "params must be an object when present.", `${path}.params`));

  return issues;
}

function validateCapGrant(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "CapabilityGrant must be an object.", path)];

  const o = v as any;

  if (!isString(o.capId) || o.capId.length === 0)
    issues.push(issue("FIELD_INVALID", "capId must be a non-empty string.", `${path}.capId`));

  if (!isString(o.grantedBy) || (o.grantedBy as string).length === 0)
    issues.push(issue("FIELD_INVALID", "grantedBy must be a non-empty string.", `${path}.grantedBy`));

  if (o.params !== undefined && !isRecord(o.params))
    issues.push(issue("FIELD_INVALID", "params must be an object when present.", `${path}.params`));

  if (o.notes !== undefined && !isString(o.notes))
    issues.push(issue("FIELD_INVALID", "notes must be a string when present.", `${path}.notes`));

  return issues;
}

function validateTrustDigest(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "TrustDigest must be an object.", path)];

  const checkHashNullable = (x: unknown, p: string) => {
    if (x === null) return;
    if (!isString(x)) issues.push(issue("FIELD_INVALID", "Must be string or null.", p));
    if (isString(x) && x.length === 0)
      issues.push(issue("FIELD_INVALID", "Must be non-empty when string.", p));
  };

  checkHashNullable((v as any).producerHash, `${path}.producerHash`);
  checkHashNullable((v as any).inputsHash, `${path}.inputsHash`);
  checkHashNullable((v as any).outputHash, `${path}.outputHash`);

  if (!isArray((v as any).grantedCaps)) {
    issues.push(issue("FIELD_INVALID", "grantedCaps must be an array.", `${path}.grantedCaps`));
  } else {
    (v as any).grantedCaps.forEach((g: unknown, i: number) =>
      issues.push(...validateCapGrant(g, `${path}.grantedCaps[${i}]`))
    );
  }

  return issues;
}

function validatePlanConstraints(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "constraints must be an object.", path)];

  const o = v as any;

  if (o.net !== undefined) {
    if (!isRecord(o.net)) issues.push(issue("SHAPE_INVALID", "net must be an object.", `${path}.net`));
    else {
      const origins = asStringArray(o.net.allowOrigins);
      if (!origins)
        issues.push(issue("FIELD_INVALID", "allowOrigins must be string[].", `${path}.net.allowOrigins`));

      const methods = asStringArray(o.net.allowMethods);
      if (!methods)
        issues.push(issue("FIELD_INVALID", "allowMethods must be string[].", `${path}.net.allowMethods`));
      else {
        const allowed = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
        for (let i = 0; i < methods.length; i++) {
          const m = methods[i];
          if (!allowed.has(m)) {
            issues.push(
              issue(
                "ENUM_INVALID",
                "allowMethods entries must be one of: GET|POST|PUT|PATCH|DELETE.",
                `${path}.net.allowMethods[${i}]`
              )
            );
          }
        }
      }
    }
  }

  if (o.kv !== undefined) {
    if (!isRecord(o.kv)) issues.push(issue("SHAPE_INVALID", "kv must be an object.", `${path}.kv`));
    else if (!asStringArray(o.kv.allowNamespaces))
      issues.push(issue("FIELD_INVALID", "allowNamespaces must be string[].", `${path}.kv.allowNamespaces`));
  }

  if (o.db !== undefined) {
    if (!isRecord(o.db)) issues.push(issue("SHAPE_INVALID", "db must be an object.", `${path}.db`));
    else if (!asStringArray(o.db.allowConnections))
      issues.push(issue("FIELD_INVALID", "allowConnections must be string[].", `${path}.db.allowConnections`));
  }

  if (o.secrets !== undefined) {
    if (!isRecord(o.secrets)) issues.push(issue("SHAPE_INVALID", "secrets must be an object.", `${path}.secrets`));
    else if (!asStringArray(o.secrets.allowNames))
      issues.push(issue("FIELD_INVALID", "allowNames must be string[].", `${path}.secrets.allowNames`));
  }

  if (o.session !== undefined) {
    if (!isRecord(o.session))
      issues.push(issue("SHAPE_INVALID", "session must be an object.", `${path}.session`));
    else {
      if (!isBoolean(o.session.allowRead))
        issues.push(issue("FIELD_INVALID", "allowRead must be boolean.", `${path}.session.allowRead`));
      if (!isBoolean(o.session.allowWrite))
        issues.push(issue("FIELD_INVALID", "allowWrite must be boolean.", `${path}.session.allowWrite`));
    }
  }

  return issues;
}

function validatePlanNode(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "PlanNode must be an object.", path)];

  const o = v as any;

  issues.push(...validateNodeId(o.nodeId, `${path}.nodeId`));

  if (o.tier !== "cache.global" && o.tier !== "edge.exec" && o.tier !== "origin.exec")
    issues.push(issue("ENUM_INVALID", "tier must be cache.global|edge.exec|origin.exec.", `${path}.tier`));

  if (!isBoolean(o.allowExecute))
    issues.push(issue("FIELD_INVALID", "allowExecute must be boolean.", `${path}.allowExecute`));

  if (o.denyReason !== undefined && !isString(o.denyReason))
    issues.push(issue("FIELD_INVALID", "denyReason must be string when present.", `${path}.denyReason`));

  if (!isArray(o.grantedCaps))
    issues.push(issue("FIELD_INVALID", "grantedCaps must be an array.", `${path}.grantedCaps`));
  else
    o.grantedCaps.forEach((g: unknown, i: number) =>
      issues.push(...validateCapGrant(g, `${path}.grantedCaps[${i}]`))
    );

  if (o.constraints !== undefined) issues.push(...validatePlanConstraints(o.constraints, `${path}.constraints`));

  return issues;
}

function validateExecutionPlan(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "ExecutionPlan must be an object.", path)];

  const o = v as any;

  if (!isString(o.manifestId) || o.manifestId.length === 0)
    issues.push(issue("FIELD_INVALID", "manifestId must be a non-empty string.", `${path}.manifestId`));

  if (!isString(o.policyId) || o.policyId.length === 0)
    issues.push(issue("FIELD_INVALID", "policyId must be a non-empty string.", `${path}.policyId`));

  if (!isArray(o.nodes)) issues.push(issue("FIELD_INVALID", "nodes must be an array.", `${path}.nodes`));
  else o.nodes.forEach((n: unknown, i: number) => issues.push(...validatePlanNode(n, `${path}.nodes[${i}]`)));

  if (!isString(o.planHash) || o.planHash.length === 0)
    issues.push(issue("FIELD_INVALID", "planHash must be a non-empty string.", `${path}.planHash`));

  return issues;
}

function validateCompilerStamp(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "CompilerStamp must be an object.", path)];
  const o = v as any;
  const fields = ["compilerId", "compilerVersion", "builtAt", "manifestHash", "trustHash", "planHash"] as const;
  for (const f of fields) {
    if (!isString(o[f]) || (o[f] as string).length === 0)
      issues.push(issue("FIELD_INVALID", `${f} must be a non-empty string.`, `${path}.${f}`));
  }
  return issues;
}

function validateDependency(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "Dependency must be an object.", path)];

  const o = v as any;
  issues.push(...validateNodeId(o.id, `${path}.id`));

  if (!isString(o.role) || o.role.length === 0)
    issues.push(issue("FIELD_INVALID", "role must be a non-empty string.", `${path}.role`));

  if (!isBoolean(o.required))
    issues.push(issue("FIELD_INVALID", "required must be boolean.", `${path}.required`));

  return issues;
}

function validateStamp(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "Stamp must be an object.", path)];

  const o = v as any;
  const reqStr = (field: string) => {
    if (!isString(o[field]) || o[field].length === 0)
      issues.push(issue("FIELD_INVALID", `${field} must be a non-empty string.`, `${path}.${field}`));
  };

  reqStr("id");
  reqStr("kind");
  reqStr("at");
  reqStr("by");

  if (o.message !== undefined && !isString(o.message))
    issues.push(issue("FIELD_INVALID", "message must be string when present.", `${path}.message`));

  if (o.signature !== undefined) issues.push(...validateSignature(o.signature, `${path}.signature`));

  return issues;
}

function validateChainStamp(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "ChainStamp must be an object.", path)];

  const o = v as any;

  if (!isRecord(o.body)) issues.push(issue("SHAPE_INVALID", "body must be an object.", `${path}.body`));
  else {
    const b = o.body as any;

    if (!isNumber(b.sequenceNumber))
      issues.push(issue("FIELD_INVALID", "sequenceNumber must be a finite number.", `${path}.body.sequenceNumber`));

    const kinds = new Set(["build", "compile", "review", "audit", "sign"]);
    if (!isString(b.kind) || !kinds.has(b.kind))
      issues.push(issue("ENUM_INVALID", "kind must be build|compile|review|audit|sign.", `${path}.body.kind`));

    if (!isString(b.by) || b.by.length === 0)
      issues.push(issue("FIELD_INVALID", "by must be a non-empty string.", `${path}.body.by`));

    if (b.at !== undefined && !isString(b.at))
      issues.push(issue("FIELD_INVALID", "at must be string when present.", `${path}.body.at`));

    if (b.previousHash !== undefined && b.previousHash !== null && !isString(b.previousHash))
      issues.push(issue("FIELD_INVALID", "previousHash must be string|null when present.", `${path}.body.previousHash`));

    if (b.inputHash !== undefined && !isString(b.inputHash))
      issues.push(issue("FIELD_INVALID", "inputHash must be string when present.", `${path}.body.inputHash`));

    if (b.outputHash !== undefined && !isString(b.outputHash))
      issues.push(issue("FIELD_INVALID", "outputHash must be string when present.", `${path}.body.outputHash`));

    if (b.materials !== undefined) {
      const mats = asStringArray(b.materials);
      if (!mats) issues.push(issue("FIELD_INVALID", "materials must be string[].", `${path}.body.materials`));
    }

    if (b.products !== undefined) {
      const prods = asStringArray(b.products);
      if (!prods) issues.push(issue("FIELD_INVALID", "products must be string[].", `${path}.body.products`));
    }

    if (b.witness !== undefined && !isString(b.witness))
      issues.push(issue("FIELD_INVALID", "witness must be string when present.", `${path}.body.witness`));

    if (b.notes !== undefined && !isString(b.notes))
      issues.push(issue("FIELD_INVALID", "notes must be string when present.", `${path}.body.notes`));
  }

  if (!isString(o.stampHash) || o.stampHash.length === 0)
    issues.push(issue("FIELD_INVALID", "stampHash must be a non-empty string.", `${path}.stampHash`));

  if (!isArray(o.signatures)) issues.push(issue("FIELD_INVALID", "signatures must be an array.", `${path}.signatures`));
  else o.signatures.forEach((s: unknown, i: number) => issues.push(...validateSignature(s, `${path}.signatures[${i}]`)));

  return issues;
}

function validateBlockRuntimeSpec(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "BlockRuntimeSpec must be an object.", path)];

  const o = v as any;

  if (o.abi !== "ui" && o.abi !== "svc" && o.abi !== "data")
    issues.push(issue("ENUM_INVALID", "abi must be ui|svc|data.", `${path}.abi`));

  if (o.scope !== undefined && o.scope !== "request" && o.scope !== "app")
    issues.push(issue("ENUM_INVALID", "scope must be request|app when present.", `${path}.scope`));

  if (o.engine !== "js")
    issues.push(issue("ENUM_INVALID", "engine must be exactly 'js'.", `${path}.engine`));

  if (!isString(o.entry) || o.entry.length === 0)
    issues.push(issue("FIELD_INVALID", "entry must be a non-empty string.", `${path}.entry`));

  return issues;
}

function validateArtifactRef(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "ArtifactRef must be an object.", path)];

  const o = v as any;
  if (o.kind !== "inline" && o.kind !== "ref")
    return [issue("ENUM_INVALID", "ArtifactRef.kind must be inline|ref.", `${path}.kind`)];

  if (!isString(o.mime) || o.mime.length === 0)
    issues.push(issue("FIELD_INVALID", "mime must be a non-empty string.", `${path}.mime`));

  if (o.kind === "inline") {
    if (o.text !== undefined && !isString(o.text))
      issues.push(issue("FIELD_INVALID", "text must be string when present.", `${path}.text`));
  } else {
    if (!isString(o.ref) || o.ref.length === 0)
      issues.push(issue("FIELD_INVALID", "ref must be a non-empty string.", `${path}.ref`));
  }

  if (o.entry !== undefined && !isString(o.entry))
    issues.push(issue("FIELD_INVALID", "entry must be string when present.", `${path}.entry`));

  return issues;
}

function validatePackageRef(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "PackageRef must be an object.", path)];

  const o = v as any;
  if (o.registry !== undefined && !isString(o.registry))
    issues.push(issue("FIELD_INVALID", "registry must be string when present.", `${path}.registry`));

  if (!isString(o.locator) || o.locator.length === 0)
    issues.push(issue("FIELD_INVALID", "locator must be a non-empty string.", `${path}.locator`));

  if (o.version !== undefined && !isString(o.version))
    issues.push(issue("FIELD_INVALID", "version must be string when present.", `${path}.version`));

  if (!isString(o.contentHash) || o.contentHash.length === 0)
    issues.push(issue("FIELD_INVALID", "contentHash must be a non-empty string.", `${path}.contentHash`));

  if (o.signature !== undefined) issues.push(...validateSignature(o.signature, `${path}.signature`));

  return issues;
}

function validateNode(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "Node must be an object.", path)];

  const o = v as any;

  issues.push(...validateNodeId(o.id, `${path}.id`));

  const classes = new Set([
    "ui.static",
    "ui.compute",
    "svc.compute",
    "data.query",
    "private.secret",
    "session.auth",
  ]);

  if (!isString(o.class) || !classes.has(o.class))
    issues.push(
      issue(
        "ENUM_INVALID",
        "class must be ui.static|ui.compute|svc.compute|data.query|private.secret|session.auth.",
        `${path}.class`
      )
    );

  if (o.title !== undefined && !isString(o.title))
    issues.push(issue("FIELD_INVALID", "title must be string when present.", `${path}.title`));

  if (!isArray(o.dependencies))
    issues.push(issue("FIELD_INVALID", "dependencies must be an array.", `${path}.dependencies`));
  else
    o.dependencies.forEach((d: unknown, i: number) =>
      issues.push(...validateDependency(d, `${path}.dependencies[${i}]`))
    );

  if (!isArray(o.stamps)) issues.push(issue("FIELD_INVALID", "stamps must be an array.", `${path}.stamps`));
  else o.stamps.forEach((s: unknown, i: number) => issues.push(...validateStamp(s, `${path}.stamps[${i}]`)));

  if (o.constructionChain !== undefined) {
    if (!isArray(o.constructionChain))
      issues.push(issue("FIELD_INVALID", "constructionChain must be an array when present.", `${path}.constructionChain`));
    else
      o.constructionChain.forEach((c: unknown, i: number) =>
        issues.push(...validateChainStamp(c, `${path}.constructionChain[${i}]`))
      );
  }

  if (!isArray(o.capabilityRequests))
    issues.push(issue("FIELD_INVALID", "capabilityRequests must be an array.", `${path}.capabilityRequests`));
  else
    o.capabilityRequests.forEach((c: unknown, i: number) =>
      issues.push(...validateCapRequest(c, `${path}.capabilityRequests[${i}]`))
    );

  if (o.runtime !== undefined) issues.push(...validateBlockRuntimeSpec(o.runtime, `${path}.runtime`));

  if (o.artifact !== undefined) {
    if (isRecord(o.artifact) && isString((o.artifact as any).kind)) {
      issues.push(...validateArtifactRef(o.artifact, `${path}.artifact`));
    } else {
      issues.push(...validatePackageRef(o.artifact, `${path}.artifact`));
    }
  }

  return issues;
}

function validateTrustNodeResult(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "TrustNodeResult must be an object.", path)];

  const o = v as any;

  issues.push(...validateNodeId(o.nodeId, `${path}.nodeId`));

  if (o.status !== "trusted" && o.status !== "untrusted" && o.status !== "unknown")
    issues.push(issue("ENUM_INVALID", "status must be trusted|untrusted|unknown.", `${path}.status`));

  const reasons = asStringArray(o.reasons);
  if (!reasons) issues.push(issue("FIELD_INVALID", "reasons must be string[].", `${path}.reasons`));

  if (!isArray(o.grants)) issues.push(issue("FIELD_INVALID", "grants must be an array.", `${path}.grants`));
  else o.grants.forEach((g: unknown, i: number) => issues.push(...validateCapGrant(g, `${path}.grants[${i}]`)));

  issues.push(...validateTrustDigest(o.digest, `${path}.digest`));

  // Binding invariant: grants must equal digest.grantedCaps (canonical compare).
  if (isRecord(o.digest) && isArray(o.grants) && isArray((o.digest as any).grantedCaps)) {
    const a = safeCanonicalJSON(o.grants);
    const b = safeCanonicalJSON((o.digest as any).grantedCaps);

    if (a === null || b === null) {
      issues.push(
        issue(
          "CANONICAL_INVALID",
          "grants/digest.grantedCaps must be canonicalizable (no cycles).",
          `${path}.grants`
        )
      );
    } else if (a !== b) {
      issues.push(issue("GRANTS_MISMATCH", "grants must exactly match digest.grantedCaps.", `${path}.grants`));
    }
  }

  if (o.publisherId !== undefined && !isString(o.publisherId))
    issues.push(issue("FIELD_INVALID", "publisherId must be string when present.", `${path}.publisherId`));

  if (o.packageHash !== undefined && !isString(o.packageHash))
    issues.push(issue("FIELD_INVALID", "packageHash must be string when present.", `${path}.packageHash`));

  // If both exist, packageHash must match digest.producerHash (when non-null)
  if (isRecord(o.digest) && o.packageHash !== undefined) {
    const ph = (o.digest as any).producerHash;
    if (ph !== null && ph !== undefined && isString(ph) && isString(o.packageHash) && o.packageHash !== ph) {
      issues.push(
        issue(
          "PRODUCER_HASH_MISMATCH",
          "packageHash must equal digest.producerHash when both are present.",
          `${path}.packageHash`
        )
      );
    }
  }

  return issues;
}

function validateTrustResult(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "TrustResult must be an object.", path)];

  const o = v as any;

  if (!isString(o.manifestId) || o.manifestId.length === 0)
    issues.push(issue("FIELD_INVALID", "manifestId must be a non-empty string.", `${path}.manifestId`));

  if (!isString(o.policyId) || o.policyId.length === 0)
    issues.push(issue("FIELD_INVALID", "policyId must be a non-empty string.", `${path}.policyId`));

  if (!isArray(o.nodes)) issues.push(issue("FIELD_INVALID", "nodes must be an array.", `${path}.nodes`));
  else o.nodes.forEach((n: unknown, i: number) => issues.push(...validateTrustNodeResult(n, `${path}.nodes[${i}]`)));

  return issues;
}

function validateGraphManifest(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "GraphManifest must be an object.", path)];

  const o = v as any;

  if (!isString(o.id) || o.id.length === 0)
    issues.push(issue("FIELD_INVALID", "id must be a non-empty string.", `${path}.id`));

  if (o.version !== "2.6")
    issues.push(issue("FIELD_INVALID", "version must be exactly '2.6'.", `${path}.version`));

  issues.push(...validateNodeId(o.rootPageId, `${path}.rootPageId`));

  if (!isArray(o.nodes)) {
    issues.push(issue("FIELD_INVALID", "nodes must be an array.", `${path}.nodes`));
  } else {
    o.nodes.forEach((n: unknown, i: number) => issues.push(...validateNode(n, `${path}.nodes[${i}]`)));

    // Fail-closed sanity: rootPageId must exist in nodes list.
    if (isString(o.rootPageId)) {
      const haveRoot = o.nodes.some((n: unknown) => isRecord(n) && (n as any).id === o.rootPageId);
      if (!haveRoot) {
        issues.push(issue("FIELD_INVALID", "rootPageId must refer to a node present in nodes[].", `${path}.rootPageId`));
      }
    }
  }

  if (!isString(o.createdAt) || o.createdAt.length === 0)
    issues.push(issue("FIELD_INVALID", "createdAt must be a non-empty string.", `${path}.createdAt`));

  if (!isString(o.createdBy) || o.createdBy.length === 0)
    issues.push(issue("FIELD_INVALID", "createdBy must be a non-empty string.", `${path}.createdBy`));

  return issues;
}

export function validateRuntimeBundle(bundle: unknown): Result<RuntimeBundle, ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(bundle)) return err([issue("SHAPE_INVALID", "RuntimeBundle must be an object.", "bundle")]);

  issues.push(...validateGraphManifest((bundle as any).manifest, "bundle.manifest"));
  issues.push(...validateTrustResult((bundle as any).trust, "bundle.trust"));
  issues.push(...validateExecutionPlan((bundle as any).plan, "bundle.plan"));
  issues.push(...validateCompilerStamp((bundle as any).compiler, "bundle.compiler"));

  // Binding invariants (runtime enforcement contract)
  if (isRecord((bundle as any).manifest) && isRecord((bundle as any).trust)) {
    if (
      isString((bundle as any).manifest.id) &&
      isString((bundle as any).trust.manifestId) &&
      (bundle as any).manifest.id !== (bundle as any).trust.manifestId
    ) {
      issues.push(issue("BINDING_INVALID", "trust.manifestId must equal manifest.id.", "bundle.trust.manifestId"));
    }
  }

  if (isRecord((bundle as any).manifest) && isRecord((bundle as any).plan)) {
    if (
      isString((bundle as any).manifest.id) &&
      isString((bundle as any).plan.manifestId) &&
      (bundle as any).manifest.id !== (bundle as any).plan.manifestId
    ) {
      issues.push(issue("BINDING_INVALID", "plan.manifestId must equal manifest.id.", "bundle.plan.manifestId"));
    }
  }

  if (isRecord((bundle as any).plan) && isRecord((bundle as any).trust)) {
    const ppid = (bundle as any).plan.policyId;
    const tpid = (bundle as any).trust.policyId;
    if (isString(ppid) && isString(tpid) && ppid !== tpid) {
      issues.push(issue("BINDING_INVALID", "plan.policyId must equal trust.policyId.", "bundle.plan.policyId"));
    }
  }

  if (
    isRecord((bundle as any).plan) &&
    isRecord((bundle as any).compiler) &&
    isString((bundle as any).plan.planHash) &&
    isString((bundle as any).compiler.planHash)
  ) {
    if ((bundle as any).plan.planHash !== (bundle as any).compiler.planHash) {
      issues.push(issue("BINDING_INVALID", "compiler.planHash must equal plan.planHash.", "bundle.compiler.planHash"));
    }
  }

  if (issues.length > 0) return err(issues);

  // Intentional: after validation, treat as RuntimeBundle.
  return ok(bundle as unknown as RuntimeBundle);
}

// Export helpers used elsewhere (optional), typed to current schemas.
export function validateTrustNodeResultTyped(v: unknown): Result<TrustNodeResult, ValidationIssue[]> {
  const issues = validateTrustNodeResult(v, "trustNode");
  return issues.length ? err(issues) : ok(v as unknown as TrustNodeResult);
}

export function validateTrustResultTyped(v: unknown): Result<TrustResult, ValidationIssue[]> {
  const issues = validateTrustResult(v, "trust");
  return issues.length ? err(issues) : ok(v as unknown as TrustResult);
}

export function validateExecutionPlanTyped(v: unknown): Result<ExecutionPlan, ValidationIssue[]> {
  const issues = validateExecutionPlan(v, "plan");
  return issues.length ? err(issues) : ok(v as unknown as ExecutionPlan);
}

const validateSecretBoxBindings = (v: unknown, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) {
    issues.push(issue("SECRETBOX_UNBOUND", "SecretBox.bindings must be an object.", path));
    return issues;
  }

  const allowed = ["planHash", "issuerId", "mintedSeq", "mintedAt"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("SECRETBOX_FIELDS_INVALID", "SecretBox.bindings contains disallowed fields.", path));
  }

  if (!isNonEmptyString((v as any).planHash))
    issues.push(issue("SECRETBOX_UNBOUND", "SecretBox must be bound to a non-empty planHash.", `${path}.planHash`));
  if (!isNonEmptyString((v as any).issuerId))
    issues.push(issue("SECRETBOX_UNBOUND", "SecretBox must be bound to a non-empty issuerId.", `${path}.issuerId`));

  if ((v as any).mintedSeq !== undefined) {
    if (!Number.isInteger((v as any).mintedSeq) || (v as any).mintedSeq < 0) {
      issues.push(
        issue("SECRETBOX_FIELDS_INVALID", "mintedSeq must be an integer >= 0 when present.", `${path}.mintedSeq`)
      );
    }
  }

  if ((v as any).mintedAt !== undefined && typeof (v as any).mintedAt !== "string") {
    issues.push(issue("SECRETBOX_FIELDS_INVALID", "mintedAt must be a string when present.", `${path}.mintedAt`));
  }

  return issues;
};

export const validateSecretBox = (secretBox: unknown, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(secretBox)) {
    issues.push(issue("SECRETBOX_FIELDS_INVALID", "SecretBox must be an object.", path));
    return sortIssuesDeterministically(issues);
  }

  const allowed = ["schema", "kind", "secretB64", "bindings", "secretHash", "boxDigest"];
  if (!hasOnlyKeys(secretBox, allowed)) {
    issues.push(issue("SECRETBOX_FIELDS_INVALID", "SecretBox contains disallowed fields.", path));
  }

  if ((secretBox as any).schema !== "retni.secretbox/1") {
    issues.push(issue("SECRETBOX_FIELDS_INVALID", "SecretBox.schema must be retni.secretbox/1.", `${path}.schema`));
  }

  const allowedKinds = new Set(["auth.token", "crypto.key", "payment.token", "opaque.secret"]);
  if (!isString((secretBox as any).kind) || !allowedKinds.has((secretBox as any).kind)) {
    issues.push(issue("SECRETBOX_KIND_INVALID", "SecretBox.kind is not in the allowed enum.", `${path}.kind`));
  }

  if (!isString((secretBox as any).secretB64)) {
    issues.push(issue("SECRETBOX_BAD_BASE64", "SecretBox.secretB64 must be a base64 string.", `${path}.secretB64`));
  } else {
    const n = base64ByteLength((secretBox as any).secretB64);
    if (n === null) {
      issues.push(
        issue("SECRETBOX_BAD_BASE64", "SecretBox.secretB64 is not strict base64.", `${path}.secretB64`)
      );
    } else {
      if (n <= 0) {
        issues.push(
          issue(
            "SECRETBOX_BAD_BASE64",
            "SecretBox.secretB64 must decode to non-empty bytes.",
            `${path}.secretB64`
          )
        );
      }
      if (n > MAX_SECRETBOX_BYTES) {
        issues.push(
          issue(
            "SECRETBOX_TOO_LARGE",
            `SecretBox secret exceeds max size ${MAX_SECRETBOX_BYTES} bytes.`,
            `${path}.secretB64`
          )
        );
      }
    }
  }

  if (!isNonEmptyString((secretBox as any).secretHash)) {
    issues.push(
      issue("SECRETBOX_FIELDS_INVALID", "SecretBox.secretHash must be a non-empty string.", `${path}.secretHash`)
    );
  }

  if (!isNonEmptyString((secretBox as any).boxDigest)) {
    issues.push(
      issue("SECRETBOX_FIELDS_INVALID", "SecretBox.boxDigest must be a non-empty string.", `${path}.boxDigest`)
    );
  }

  issues.push(...validateSecretBoxBindings((secretBox as any).bindings, `${path}.bindings`));

  return sortIssuesDeterministically(issues);
};

export const validateSecretBoxTyped = (secretBox: unknown): Result<SecretBox, ValidationIssue[]> => {
  const issues = validateSecretBox(secretBox, "secretBox");
  if (issues.length > 0) return err(issues);
  return ok(secretBox as SecretBox);
};

export function validatePlanSnapshotV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "PlanSnapshotV0 must be an object.", path)];

  const allowed = [
    "schema",
    "graphDigest",
    "artifacts",
    "policyDigest",
    "evidenceDigests",
    "grants",
    "mode",
    "tier",
    "pathSummary",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "PlanSnapshotV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.plan/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.plan/0.", `${path}.schema`));
  }

  if (!isNonEmptyString(o.graphDigest))
    issues.push(issue("FIELD_INVALID", "graphDigest must be a non-empty string.", `${path}.graphDigest`));
  if (!isNonEmptyString(o.policyDigest))
    issues.push(issue("FIELD_INVALID", "policyDigest must be a non-empty string.", `${path}.policyDigest`));

  if (!isArray(o.artifacts)) {
    issues.push(issue("FIELD_INVALID", "artifacts must be an array.", `${path}.artifacts`));
  } else {
    const items: { nodeId: string; contentHash: string }[] = [];
    o.artifacts.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "artifact entry must be an object.", `${path}.artifacts[${i}]`));
        return;
      }
      const entry = item as any;
      issues.push(...validateNodeId(entry.nodeId, `${path}.artifacts[${i}].nodeId`));
      if (!isNonEmptyString(entry.contentHash))
        issues.push(
          issue(
            "FIELD_INVALID",
            "contentHash must be a non-empty string.",
            `${path}.artifacts[${i}].contentHash`
          )
        );
      items.push({ nodeId: entry.nodeId, contentHash: entry.contentHash });
      if (!hasOnlyKeys(entry, ["nodeId", "contentHash"])) {
        issues.push(issue("FIELD_INVALID", "artifact entry contains disallowed fields.", `${path}.artifacts[${i}]`));
      }
    });
    if (items.length > 1 && !isSortedArtifacts(items)) {
      issues.push(
        issue("FIELD_INVALID", "artifacts must be stable-sorted by nodeId then contentHash.", `${path}.artifacts`)
      );
    }
  }

  const digests = asStringArray(o.evidenceDigests);
  if (!digests) {
    issues.push(issue("FIELD_INVALID", "evidenceDigests must be string[].", `${path}.evidenceDigests`));
  } else {
    digests.forEach((d, i) => {
      if (!isNonEmptyString(d))
        issues.push(
          issue("FIELD_INVALID", "evidenceDigests entries must be non-empty strings.", `${path}.evidenceDigests[${i}]`)
        );
    });
    if (!isSortedUniqueStrings(digests)) {
      issues.push(issue("FIELD_INVALID", "evidenceDigests must be stable-sorted and unique.", `${path}.evidenceDigests`));
    }
  }

  if (!isArray(o.grants)) {
    issues.push(issue("FIELD_INVALID", "grants must be an array.", `${path}.grants`));
  } else {
    const items: { blockHash: string; eligibleCaps: string[] }[] = [];
    o.grants.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "grant entry must be an object.", `${path}.grants[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isNonEmptyString(entry.blockHash))
        issues.push(issue("FIELD_INVALID", "blockHash must be a non-empty string.", `${path}.grants[${i}].blockHash`));
      const caps = asStringArray(entry.eligibleCaps);
      if (!caps) {
        issues.push(issue("FIELD_INVALID", "eligibleCaps must be string[].", `${path}.grants[${i}].eligibleCaps`));
      } else {
        caps.forEach((cap, j) => {
          if (!isNonEmptyString(cap))
            issues.push(
              issue(
                "FIELD_INVALID",
                "eligibleCaps entries must be non-empty strings.",
                `${path}.grants[${i}].eligibleCaps[${j}]`
              )
            );
        });
        if (!isSortedUniqueStrings(caps)) {
          issues.push(
            issue(
              "FIELD_INVALID",
              "eligibleCaps must be stable-sorted and unique.",
              `${path}.grants[${i}].eligibleCaps`
            )
          );
        }
      }
      items.push({ blockHash: entry.blockHash, eligibleCaps: caps || [] });
      if (!hasOnlyKeys(entry, ["blockHash", "eligibleCaps"])) {
        issues.push(issue("FIELD_INVALID", "grant entry contains disallowed fields.", `${path}.grants[${i}]`));
      }
    });
    if (items.length > 1 && !isSortedGrants(items)) {
      issues.push(issue("FIELD_INVALID", "grants must be stable-sorted by blockHash.", `${path}.grants`));
    }
  }

  if (o.mode !== "strict" && o.mode !== "compatible" && o.mode !== "legacy") {
    issues.push(issue("ENUM_INVALID", "mode must be strict|compatible|legacy.", `${path}.mode`));
  }

  if (!isNonEmptyString(o.tier) || /\s/.test(o.tier)) {
    issues.push(issue("FIELD_INVALID", "tier must be a non-empty string without whitespace.", `${path}.tier`));
  }

  if (!isRecord(o.pathSummary)) {
    issues.push(issue("FIELD_INVALID", "pathSummary must be an object.", `${path}.pathSummary`));
  }

  return sortIssuesDeterministically(issues);
}

export const validateWeftEndPolicyV1 = (
  v: unknown,
  path = "policy"
): ValidationIssue[] => {
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "WeftEndPolicyV1 must be an object.", path)];
  const issues: ValidationIssue[] = [];
  const allowed = [
    "schema",
    "profile",
    "reasonSeverity",
    "severityAction",
    "capsPolicy",
    "disclosure",
    "bounds",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "WeftEndPolicyV1 contains disallowed fields.", path));
  }
  const o = v as any;
  if (o.schema !== "weftend.intake.policy/1") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.intake.policy/1.", `${path}.schema`));
  }
  if (o.profile !== "web" && o.profile !== "mod" && o.profile !== "plugin" && o.profile !== "release") {
    issues.push(issue("ENUM_INVALID", "profile must be web|mod|plugin|release.", `${path}.profile`));
  }

  if (!isRecord(o.reasonSeverity)) {
    issues.push(issue("FIELD_INVALID", "reasonSeverity must be an object.", `${path}.reasonSeverity`));
  } else {
    Object.keys(o.reasonSeverity).forEach((key) => {
      const value = o.reasonSeverity[key];
      if (!isTightString(key)) {
        issues.push(
          issue("FIELD_INVALID", "reasonSeverity keys must be non-empty strings.", `${path}.reasonSeverity`)
        );
      }
      if (!isIntakeSeverityV1(value)) {
        issues.push(
          issue(
            "ENUM_INVALID",
            "reasonSeverity values must be INFO|WARN|DENY|QUARANTINE.",
            `${path}.reasonSeverity.${key}`
          )
        );
      }
    });
  }

  if (!isRecord(o.severityAction)) {
    issues.push(issue("FIELD_INVALID", "severityAction must be an object.", `${path}.severityAction`));
  } else {
    const allowedSev = ["INFO", "WARN", "DENY", "QUARANTINE"];
    if (!hasOnlyKeys(o.severityAction, allowedSev)) {
      issues.push(issue("FIELD_INVALID", "severityAction contains disallowed fields.", `${path}.severityAction`));
    }
    allowedSev.forEach((sev) => {
      const value = o.severityAction[sev];
      if (!isIntakeActionV1(value)) {
        issues.push(
          issue(
            "ENUM_INVALID",
            "severityAction values must be APPROVE|QUEUE|REJECT|HOLD.",
            `${path}.severityAction.${sev}`
          )
        );
      }
    });
  }

  if (!isRecord(o.capsPolicy)) {
    issues.push(issue("FIELD_INVALID", "capsPolicy must be an object.", `${path}.capsPolicy`));
  } else if (!hasOnlyKeys(o.capsPolicy, ["net", "fs", "storage", "childProcess"])) {
    issues.push(issue("FIELD_INVALID", "capsPolicy contains disallowed fields.", `${path}.capsPolicy`));
  } else {
    if (o.capsPolicy.net !== undefined) {
      if (!isRecord(o.capsPolicy.net)) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.net must be an object.", `${path}.capsPolicy.net`));
      } else if (!hasOnlyKeys(o.capsPolicy.net, ["allowedDomains", "allowIfUnsigned"])) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.net contains disallowed fields.", `${path}.capsPolicy.net`));
      } else {
        const domains = asStringArray(o.capsPolicy.net.allowedDomains);
        if (!domains) {
          issues.push(
            issue("FIELD_INVALID", "capsPolicy.net.allowedDomains must be string[].", `${path}.capsPolicy.net.allowedDomains`)
          );
        } else {
          domains.forEach((entry, i) => {
            if (!isTightString(entry)) {
              issues.push(
                issue(
                  "FIELD_INVALID",
                  "capsPolicy.net.allowedDomains entries must be non-empty strings.",
                  `${path}.capsPolicy.net.allowedDomains[${i}]`
                )
              );
            }
          });
        }
        if (o.capsPolicy.net.allowIfUnsigned !== undefined && !isBoolean(o.capsPolicy.net.allowIfUnsigned)) {
          issues.push(
            issue("FIELD_INVALID", "capsPolicy.net.allowIfUnsigned must be boolean.", `${path}.capsPolicy.net.allowIfUnsigned`)
          );
        }
      }
    }
    if (o.capsPolicy.fs !== undefined) {
      if (!isRecord(o.capsPolicy.fs)) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.fs must be an object.", `${path}.capsPolicy.fs`));
      } else if (!hasOnlyKeys(o.capsPolicy.fs, ["allowedPaths"])) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.fs contains disallowed fields.", `${path}.capsPolicy.fs`));
      } else {
        const paths = asStringArray(o.capsPolicy.fs.allowedPaths);
        if (!paths) {
          issues.push(
            issue("FIELD_INVALID", "capsPolicy.fs.allowedPaths must be string[].", `${path}.capsPolicy.fs.allowedPaths`)
          );
        } else {
          paths.forEach((entry, i) => {
            if (!isNonEmptyString(entry)) {
              issues.push(
                issue(
                  "FIELD_INVALID",
                  "capsPolicy.fs.allowedPaths entries must be non-empty strings.",
                  `${path}.capsPolicy.fs.allowedPaths[${i}]`
                )
              );
            }
          });
        }
      }
    }
    if (o.capsPolicy.storage !== undefined) {
      if (!isRecord(o.capsPolicy.storage)) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.storage must be an object.", `${path}.capsPolicy.storage`));
      } else if (!hasOnlyKeys(o.capsPolicy.storage, ["allow"])) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.storage contains disallowed fields.", `${path}.capsPolicy.storage`));
      } else if (o.capsPolicy.storage.allow !== undefined && !isBoolean(o.capsPolicy.storage.allow)) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.storage.allow must be boolean.", `${path}.capsPolicy.storage.allow`));
      }
    }
    if (o.capsPolicy.childProcess !== undefined) {
      if (!isRecord(o.capsPolicy.childProcess)) {
        issues.push(issue("FIELD_INVALID", "capsPolicy.childProcess must be an object.", `${path}.capsPolicy.childProcess`));
      } else if (!hasOnlyKeys(o.capsPolicy.childProcess, ["allow"])) {
        issues.push(
          issue("FIELD_INVALID", "capsPolicy.childProcess contains disallowed fields.", `${path}.capsPolicy.childProcess`)
        );
      } else if (o.capsPolicy.childProcess.allow !== undefined && !isBoolean(o.capsPolicy.childProcess.allow)) {
        issues.push(
          issue("FIELD_INVALID", "capsPolicy.childProcess.allow must be boolean.", `${path}.capsPolicy.childProcess.allow`)
        );
      }
    }
  }

  if (!isRecord(o.disclosure)) {
    issues.push(issue("FIELD_INVALID", "disclosure must be an object.", `${path}.disclosure`));
  } else if (!hasOnlyKeys(o.disclosure, ["requireOnWARN", "requireOnDENY", "maxLines"])) {
    issues.push(issue("FIELD_INVALID", "disclosure contains disallowed fields.", `${path}.disclosure`));
  } else {
    if (!isBoolean(o.disclosure.requireOnWARN)) {
      issues.push(
        issue("FIELD_INVALID", "disclosure.requireOnWARN must be boolean.", `${path}.disclosure.requireOnWARN`)
      );
    }
    if (!isBoolean(o.disclosure.requireOnDENY)) {
      issues.push(
        issue("FIELD_INVALID", "disclosure.requireOnDENY must be boolean.", `${path}.disclosure.requireOnDENY`)
      );
    }
    if (!isNumber(o.disclosure.maxLines) || o.disclosure.maxLines < 1) {
      issues.push(
        issue("FIELD_INVALID", "disclosure.maxLines must be a positive integer.", `${path}.disclosure.maxLines`)
      );
    }
  }

  if (!isRecord(o.bounds)) {
    issues.push(issue("FIELD_INVALID", "bounds must be an object.", `${path}.bounds`));
  } else if (
    !hasOnlyKeys(o.bounds, ["maxReasonCodes", "maxCapsItems", "maxDisclosureChars", "maxAppealBytes"])
  ) {
    issues.push(issue("FIELD_INVALID", "bounds contains disallowed fields.", `${path}.bounds`));
  } else {
    const fields = ["maxReasonCodes", "maxCapsItems", "maxDisclosureChars", "maxAppealBytes"] as const;
    fields.forEach((field) => {
      const value = o.bounds[field];
      if (!isNumber(value) || value < 0 || !Number.isInteger(value)) {
        issues.push(
          issue("FIELD_INVALID", `${field} must be an integer >= 0.`, `${path}.bounds.${field}`)
        );
      }
    });
    // Bounds are enforced during canonicalization; input may be unbounded.
  }

  if (isRecord(o.reasonSeverity) && isRecord(o.bounds) && isNumber(o.bounds.maxReasonCodes)) {
    const reasonCount = Object.keys(o.reasonSeverity).length;
    if (reasonCount > o.bounds.maxReasonCodes) {
      issues.push(
        issue(
          "POLICY_UNBOUNDED_REASON_SEVERITY",
          "reasonSeverity must not exceed bounds.maxReasonCodes.",
          `${path}.reasonSeverity`
        )
      );
    }
  }

  return sortIssuesDeterministically(issues);
};

export const computeReleaseIdV0 = (manifestBody: unknown): string => `sha256:${sha256(canonicalJSON(manifestBody))}`;

export function validateReleaseManifestV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "ReleaseManifestV0 must be an object.", path)];

  const allowed = ["schema", "releaseId", "manifestBody", "signatures"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "ReleaseManifestV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.release/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.release/0.", `${path}.schema`));
  }
  if (!isTightString(o.releaseId)) {
    issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string.", `${path}.releaseId`));
  }

  if (!isRecord(o.manifestBody)) {
    issues.push(issue("FIELD_INVALID", "manifestBody must be an object.", `${path}.manifestBody`));
  } else {
    const body = o.manifestBody as any;
    const allowedBody = [
      "planDigest",
      "policyDigest",
      "blocks",
      "evidenceJournalHead",
      "tartarusJournalHead",
      "pathDigest",
      "buildInfo",
    ];
    if (!hasOnlyKeys(body, allowedBody)) {
      issues.push(issue("FIELD_INVALID", "manifestBody contains disallowed fields.", `${path}.manifestBody`));
    }
    if (!isTightString(body.planDigest)) {
      issues.push(issue("FIELD_INVALID", "planDigest must be a non-empty string.", `${path}.manifestBody.planDigest`));
    }
    if (!isTightString(body.policyDigest)) {
      issues.push(
        issue("FIELD_INVALID", "policyDigest must be a non-empty string.", `${path}.manifestBody.policyDigest`)
      );
    }

    const blocks = asStringArray(body.blocks);
    if (!blocks) {
      issues.push(issue("FIELD_INVALID", "blocks must be string[].", `${path}.manifestBody.blocks`));
    } else {
      blocks.forEach((b, i) => {
        if (!isTightString(b)) {
          issues.push(
            issue("FIELD_INVALID", "blocks entries must be non-empty strings.", `${path}.manifestBody.blocks[${i}]`)
          );
        }
      });
      if (!isSortedUniqueStrings(blocks)) {
        issues.push(issue("FIELD_INVALID", "blocks must be stable-sorted and unique.", `${path}.manifestBody.blocks`));
      }
    }

    if (body.evidenceJournalHead !== undefined && !isTightString(body.evidenceJournalHead)) {
      issues.push(
        issue(
          "FIELD_INVALID",
          "evidenceJournalHead must be a non-empty string when present.",
          `${path}.manifestBody.evidenceJournalHead`
        )
      );
    }
    if (body.tartarusJournalHead !== undefined && !isTightString(body.tartarusJournalHead)) {
      issues.push(
        issue(
          "FIELD_INVALID",
          "tartarusJournalHead must be a non-empty string when present.",
          `${path}.manifestBody.tartarusJournalHead`
        )
      );
    }
    if (!isTightString(body.pathDigest)) {
      issues.push(
        issue(
          "FIELD_INVALID",
          "pathDigest must be a non-empty string.",
          `${path}.manifestBody.pathDigest`
        )
      );
    }
    if (body.buildInfo !== undefined) {
      if (!isRecord(body.buildInfo)) {
        issues.push(issue("FIELD_INVALID", "buildInfo must be an object.", `${path}.manifestBody.buildInfo`));
      } else {
        const build = body.buildInfo as any;
        const allowedBuild = ["toolId", "toolVer"];
        if (!hasOnlyKeys(build, allowedBuild)) {
          issues.push(
            issue("FIELD_INVALID", "buildInfo contains disallowed fields.", `${path}.manifestBody.buildInfo`)
          );
        }
        if (!isTightString(build.toolId)) {
          issues.push(issue("FIELD_INVALID", "toolId must be a non-empty string.", `${path}.manifestBody.buildInfo.toolId`));
        }
        if (!isTightString(build.toolVer)) {
          issues.push(issue("FIELD_INVALID", "toolVer must be a non-empty string.", `${path}.manifestBody.buildInfo.toolVer`));
        }
      }
    }
  }

  if (!isArray(o.signatures) || o.signatures.length === 0) {
    issues.push(issue("FIELD_INVALID", "signatures must be a non-empty array.", `${path}.signatures`));
  } else {
    o.signatures.forEach((sig: unknown, i: number) => {
      const sigPath = `${path}.signatures[${i}]`;
      if (!isRecord(sig)) {
        issues.push(issue("FIELD_INVALID", "signature must be an object.", sigPath));
        return;
      }
      const allowedSig = ["sigKind", "keyId", "sigB64"];
      if (!hasOnlyKeys(sig, allowedSig)) {
        issues.push(issue("FIELD_INVALID", "signature contains disallowed fields.", sigPath));
      }
      const s = sig as any;
      if (!isTightString(s.sigKind)) {
        issues.push(issue("FIELD_INVALID", "sigKind must be a non-empty string.", `${sigPath}.sigKind`));
      }
      if (!isTightString(s.keyId)) {
        issues.push(issue("FIELD_INVALID", "keyId must be a non-empty string.", `${sigPath}.keyId`));
      }
      if (!isString(s.sigB64)) {
        issues.push(issue("FIELD_INVALID", "sigB64 must be a base64 string.", `${sigPath}.sigB64`));
      } else {
        const n = base64ByteLength(s.sigB64);
        if (n === null || n <= 0) {
          issues.push(issue("FIELD_INVALID", "sigB64 must be strict base64.", `${sigPath}.sigB64`));
        } else if (n > MAX_RELEASE_SIG_BYTES) {
          issues.push(
            issue(
              "FIELD_INVALID",
              `sigB64 exceeds max size ${MAX_RELEASE_SIG_BYTES} bytes.`,
              `${sigPath}.sigB64`
            )
          );
        }
      }
    });
  }

  if (isRecord(o.manifestBody) && isTightString(o.releaseId)) {
    try {
      const expected = computeReleaseIdV0(o.manifestBody);
      if (checkpointEqOrReasonV0(expected, o.releaseId, "RELEASE_ID_MISMATCH").length > 0) {
        issues.push(issue("RELEASE_ID_MISMATCH", "releaseId must match canonical hash.", `${path}.releaseId`));
      }
    } catch {
      issues.push(issue("CANONICAL_INVALID", "manifestBody must be canonicalizable.", `${path}.manifestBody`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateHostSelfManifestV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "HostSelfManifestV0 must be an object.", path)];

  const allowed = ["schema", "hostSelfId", "body", "signatures"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "HostSelfManifestV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.host.self/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.host.self/0.", `${path}.schema`));
  }
  if (!isTightString(o.hostSelfId)) {
    issues.push(issue("FIELD_INVALID", "hostSelfId must be a non-empty string.", `${path}.hostSelfId`));
  }

  if (!isRecord(o.body)) {
    issues.push(issue("FIELD_INVALID", "body must be an object.", `${path}.body`));
  } else {
    const bodyAllowed = [
      "hostVersion",
      "releaseId",
      "releaseManifestDigest",
      "runtimeBundleDigest",
      "evidenceDigest",
      "publicKeyDigest",
      "policyDigest",
    ];
    if (!hasOnlyKeys(o.body, bodyAllowed)) {
      issues.push(issue("FIELD_INVALID", "body contains disallowed fields.", `${path}.body`));
    }
    if (!isTightString(o.body.hostVersion)) {
      issues.push(issue("FIELD_INVALID", "hostVersion must be a non-empty string.", `${path}.body.hostVersion`));
    }
    if (!isTightString(o.body.releaseId)) {
      issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string.", `${path}.body.releaseId`));
    }
    if (!isTightString(o.body.releaseManifestDigest)) {
      issues.push(issue("FIELD_INVALID", "releaseManifestDigest must be a non-empty string.", `${path}.body.releaseManifestDigest`));
    }
    if (!isTightString(o.body.runtimeBundleDigest)) {
      issues.push(issue("FIELD_INVALID", "runtimeBundleDigest must be a non-empty string.", `${path}.body.runtimeBundleDigest`));
    }
    if (!isTightString(o.body.evidenceDigest)) {
      issues.push(issue("FIELD_INVALID", "evidenceDigest must be a non-empty string.", `${path}.body.evidenceDigest`));
    }
    if (!isTightString(o.body.publicKeyDigest)) {
      issues.push(issue("FIELD_INVALID", "publicKeyDigest must be a non-empty string.", `${path}.body.publicKeyDigest`));
    }
    if (o.body.policyDigest !== undefined && !isTightString(o.body.policyDigest)) {
      issues.push(issue("FIELD_INVALID", "policyDigest must be a non-empty string when present.", `${path}.body.policyDigest`));
    }
  }

  if (!Array.isArray(o.signatures)) {
    issues.push(issue("FIELD_INVALID", "signatures must be an array.", `${path}.signatures`));
  } else {
    o.signatures.forEach((sig: unknown, i: number) => {
      if (!isRecord(sig)) {
        issues.push(issue("FIELD_INVALID", "signature must be an object.", `${path}.signatures[${i}]`));
        return;
      }
      if (!isTightString((sig as any).sigKind)) {
        issues.push(issue("FIELD_INVALID", "sigKind must be a non-empty string.", `${path}.signatures[${i}].sigKind`));
      }
      if (!isTightString((sig as any).keyId)) {
        issues.push(issue("FIELD_INVALID", "keyId must be a non-empty string.", `${path}.signatures[${i}].keyId`));
      }
      if (!isTightString((sig as any).sigB64)) {
        issues.push(issue("FIELD_INVALID", "sigB64 must be a non-empty string.", `${path}.signatures[${i}].sigB64`));
      } else if (base64ByteLength((sig as any).sigB64) === null) {
        issues.push(issue("FIELD_INVALID", "sigB64 must be valid base64.", `${path}.signatures[${i}].sigB64`));
      }
    });
  }

  if (isRecord(o.body) && isTightString(o.hostSelfId)) {
    const expected = computeHostSelfIdV0(o.body);
    if (o.hostSelfId !== expected) {
      issues.push(issue("FIELD_INVALID", "hostSelfId must match canonical digest.", `${path}.hostSelfId`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export const computeEvidenceIdV0 = (record: {
  kind: string;
  payload: unknown;
  issuer?: unknown;
  subject?: unknown;
  meta?: unknown;
}): string => {
  const envelope: Record<string, unknown> = { kind: record.kind, payload: record.payload };
  if (record.issuer !== undefined) envelope.issuer = record.issuer;
  if (record.subject !== undefined) envelope.subject = record.subject;
  if (record.meta !== undefined) envelope.meta = record.meta;
  return `sha256:${sha256(canonicalJSON(envelope))}`;
};

export const computeEvidenceBundleDigestV0 = (bundle: unknown): string =>
  `sha256:${sha256(canonicalJSON(bundle))}`;

export const normalizePathSummaryV0 = (summary: any): any => {
  const packages = Array.isArray(summary?.packages) ? summary.packages : [];
  const artifacts = Array.isArray(summary?.artifacts) ? summary.artifacts : [];

  const pkgSeen = new Set<string>();
  const normalizedPackages = packages
    .map((entry: any) => ({ locator: entry.locator, digest: entry.digest }))
    .sort((a: any, b: any) => {
      const c0 = cmpStr(a.locator, b.locator);
      if (c0 !== 0) return c0;
      return cmpStr(a.digest, b.digest);
    })
    .filter((entry: any) => {
      const key = `${entry.locator}\u0000${entry.digest}`;
      if (pkgSeen.has(key)) return false;
      pkgSeen.add(key);
      return true;
    });

  const artSeen = new Set<string>();
  const normalizedArtifacts = artifacts
    .map((entry: any) => ({ ref: entry.ref, digest: entry.digest }))
    .sort((a: any, b: any) => {
      const c0 = cmpStr(a.ref, b.ref);
      if (c0 !== 0) return c0;
      return cmpStr(a.digest, b.digest);
    })
    .filter((entry: any) => {
      const key = `${entry.ref}\u0000${entry.digest}`;
      if (artSeen.has(key)) return false;
      artSeen.add(key);
      return true;
    });

  return {
    schema: summary?.schema,
    v: summary?.v,
    pipelineId: summary?.pipelineId,
    weftendVersion: summary?.weftendVersion,
    publishInputHash: summary?.publishInputHash,
    trustPolicyHash: summary?.trustPolicyHash,
    anchors: {
      a1Hash: summary?.anchors?.a1Hash,
      a2Hash: summary?.anchors?.a2Hash,
      a3Hash: summary?.anchors?.a3Hash,
    },
    plan: {
      planHash: summary?.plan?.planHash,
      trustHash: summary?.plan?.trustHash,
    },
    bundle: {
      bundleHash: summary?.bundle?.bundleHash,
    },
    packages: normalizedPackages,
    artifacts: normalizedArtifacts,
  };
};

export const computePathDigestV0 = (summary: any): string =>
  `sha256:${sha256(canonicalJSON(normalizePathSummaryV0(summary)))}`;

const normalizeRecoveryPlanActionsV0 = (actions: any): any[] => {
  const items = Array.isArray(actions) ? actions : [];
  return items
    .map((action: any) => ({
      kind: "restore" as const,
      target: action.target,
      expectedDigest: action.expectedDigest,
      ...(isNonEmptyString(action.expectedPlanDigest) ? { expectedPlanDigest: action.expectedPlanDigest } : {}),
      cacheKey: action.cacheKey,
      available: action.available === true,
      ...(Array.isArray(action.reasonCodes) && action.reasonCodes.length > 0
        ? { reasonCodes: stableSortUniqueReasonsV0(action.reasonCodes) }
        : {}),
    }))
    .sort((a, b) => {
      const c0 = cmpStr(a.target, b.target);
      if (c0 !== 0) return c0;
      const c1 = cmpStr(a.expectedDigest, b.expectedDigest);
      if (c1 !== 0) return c1;
      const c2 = cmpStr(a.expectedPlanDigest ?? "", b.expectedPlanDigest ?? "");
      if (c2 !== 0) return c2;
      const c3 = cmpStr(a.cacheKey, b.cacheKey);
      if (c3 !== 0) return c3;
      return Number(a.available) - Number(b.available);
    });
};

const normalizeRecoveryIssuesV0 = (issues: any): any[] => {
  const items = Array.isArray(issues) ? issues : [];
  return items
    .map((issue: any) => ({
      code: issue.code,
      message: issue.message,
      ...(isNonEmptyString(issue.path) ? { path: issue.path } : {}),
    }))
    .sort((a, b) => {
      const c0 = cmpStr(a.path ?? "\uffff", b.path ?? "\uffff");
      if (c0 !== 0) return c0;
      const c1 = cmpStr(a.code ?? "", b.code ?? "");
      if (c1 !== 0) return c1;
      return cmpStr(a.message ?? "", b.message ?? "");
    });
};

export const normalizeRecoveryPlanV0 = (plan: any): any => {
  return {
    schema: "weftend.recoveryPlan/0",
    ...(isNonEmptyString(plan?.releaseId) ? { releaseId: plan.releaseId } : {}),
    ...(isNonEmptyString(plan?.planDigest) ? { planDigest: plan.planDigest } : {}),
    actions: normalizeRecoveryPlanActionsV0(plan?.actions),
    ...(Array.isArray(plan?.issues) && plan.issues.length > 0
      ? { issues: normalizeRecoveryIssuesV0(plan.issues) }
      : {}),
  };
};

export const computeRecoveryPlanDigestV0 = (plan: any): string =>
  `sha256:${sha256(canonicalJSON(normalizeRecoveryPlanV0(plan)))}`;

export function validateBuildAttestationPayloadV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "BuildAttestationPayloadV0 must be an object.", path)];

  const allowed = [
    "v",
    "alg",
    "pipelineId",
    "weftendVersion",
    "anchors",
    "planHash",
    "trustHash",
    "pathDigest",
    "bundleHash",
    "manifestHash",
    "inputs",
    "packages",
    "artifacts",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "BuildAttestationPayloadV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.v !== 0) issues.push(issue("FIELD_INVALID", "v must be 0.", `${path}.v`));
  if (!isBoundedTightString(o.alg, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "alg must be a non-empty string.", `${path}.alg`));
  } else if (o.alg !== "sha256") {
    issues.push(issue("FIELD_INVALID", "alg must be sha256.", `${path}.alg`));
  }
  if (!isBoundedTightString(o.pipelineId, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "pipelineId must be a non-empty string.", `${path}.pipelineId`));
  }
  if (!isBoundedTightString(o.weftendVersion, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "weftendVersion must be a non-empty string.", `${path}.weftendVersion`));
  }

  if (!isRecord(o.anchors)) {
    issues.push(issue("FIELD_INVALID", "anchors must be an object.", `${path}.anchors`));
  } else {
    if (!hasOnlyKeys(o.anchors, ["a1Hash", "a2Hash", "a3Hash"])) {
      issues.push(issue("FIELD_INVALID", "anchors contains disallowed fields.", `${path}.anchors`));
    }
    if (!isBoundedTightString(o.anchors.a1Hash, MAX_ATTESTATION_STR_BYTES)) {
      issues.push(issue("FIELD_INVALID", "a1Hash must be a non-empty string.", `${path}.anchors.a1Hash`));
    }
    if (!isBoundedTightString(o.anchors.a2Hash, MAX_ATTESTATION_STR_BYTES)) {
      issues.push(issue("FIELD_INVALID", "a2Hash must be a non-empty string.", `${path}.anchors.a2Hash`));
    }
    if (!isBoundedTightString(o.anchors.a3Hash, MAX_ATTESTATION_STR_BYTES)) {
      issues.push(issue("FIELD_INVALID", "a3Hash must be a non-empty string.", `${path}.anchors.a3Hash`));
    }
  }

  if (!isBoundedTightString(o.planHash, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "planHash must be a non-empty string.", `${path}.planHash`));
  }
  if (!isBoundedTightString(o.trustHash, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "trustHash must be a non-empty string.", `${path}.trustHash`));
  }
  if (!isBoundedTightString(o.pathDigest, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "pathDigest must be a non-empty string.", `${path}.pathDigest`));
  }
  if (!isBoundedTightString(o.bundleHash, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "bundleHash must be a non-empty string.", `${path}.bundleHash`));
  }
  if (!isBoundedTightString(o.manifestHash, MAX_ATTESTATION_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "manifestHash must be a non-empty string.", `${path}.manifestHash`));
  }

  if (!isRecord(o.inputs)) {
    issues.push(issue("FIELD_INVALID", "inputs must be an object.", `${path}.inputs`));
  } else {
    if (!hasOnlyKeys(o.inputs, ["publishInputHash", "trustPolicyHash"])) {
      issues.push(issue("FIELD_INVALID", "inputs contains disallowed fields.", `${path}.inputs`));
    }
    if (!isBoundedTightString(o.inputs.publishInputHash, MAX_ATTESTATION_STR_BYTES)) {
      issues.push(issue("FIELD_INVALID", "publishInputHash must be a non-empty string.", `${path}.inputs.publishInputHash`));
    }
    if (!isBoundedTightString(o.inputs.trustPolicyHash, MAX_ATTESTATION_STR_BYTES)) {
      issues.push(issue("FIELD_INVALID", "trustPolicyHash must be a non-empty string.", `${path}.inputs.trustPolicyHash`));
    }
  }

  if (!isArray(o.packages)) {
    issues.push(issue("FIELD_INVALID", "packages must be an array.", `${path}.packages`));
  } else {
    if (o.packages.length > MAX_ATTESTATION_ITEMS) {
      issues.push(
        issue("FIELD_INVALID", `packages must not exceed ${MAX_ATTESTATION_ITEMS} entries.`, `${path}.packages`)
      );
    }
    const items: { locator: string; digest: string }[] = [];
    o.packages.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "package entry must be an object.", `${path}.packages[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isBoundedTightString(entry.locator, MAX_ATTESTATION_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "locator must be a non-empty string.", `${path}.packages[${i}].locator`));
      }
      if (!isBoundedTightString(entry.digest, MAX_ATTESTATION_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.packages[${i}].digest`));
      }
      if (!hasOnlyKeys(entry, ["locator", "digest"])) {
        issues.push(issue("FIELD_INVALID", "package entry contains disallowed fields.", `${path}.packages[${i}]`));
      }
      items.push({ locator: entry.locator, digest: entry.digest });
    });
    if (items.length > 1 && !isSortedByLocatorDigest(items)) {
      issues.push(issue("FIELD_INVALID", "packages must be stable-sorted by locator then digest.", `${path}.packages`));
    }
  }

  if (!isArray(o.artifacts)) {
    issues.push(issue("FIELD_INVALID", "artifacts must be an array.", `${path}.artifacts`));
  } else {
    if (o.artifacts.length > MAX_ATTESTATION_ITEMS) {
      issues.push(
        issue("FIELD_INVALID", `artifacts must not exceed ${MAX_ATTESTATION_ITEMS} entries.`, `${path}.artifacts`)
      );
    }
    const items: { ref: string; digest: string }[] = [];
    o.artifacts.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "artifact entry must be an object.", `${path}.artifacts[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isBoundedTightString(entry.ref, MAX_ATTESTATION_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "ref must be a non-empty string.", `${path}.artifacts[${i}].ref`));
      }
      if (!isBoundedTightString(entry.digest, MAX_ATTESTATION_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.artifacts[${i}].digest`));
      }
      if (!hasOnlyKeys(entry, ["ref", "digest"])) {
        issues.push(issue("FIELD_INVALID", "artifact entry contains disallowed fields.", `${path}.artifacts[${i}]`));
      }
      items.push({ ref: entry.ref, digest: entry.digest });
    });
    if (items.length > 1 && !isSortedByRefDigest(items)) {
      issues.push(issue("FIELD_INVALID", "artifacts must be stable-sorted by ref then digest.", `${path}.artifacts`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateEvidenceRecord(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "EvidenceRecord must be an object.", path)];

  const allowed = ["evidenceId", "kind", "payload", "issuer", "subject", "meta"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("EVIDENCE_FIELDS_INVALID", "EvidenceRecord contains disallowed fields.", path));
  }

  const o = v as any;
  if (!isNonEmptyString(o.evidenceId)) {
    issues.push(issue("FIELD_INVALID", "evidenceId must be a non-empty string.", `${path}.evidenceId`));
  }
  if (!isNamespacedKind(o.kind)) {
    issues.push(issue("FIELD_INVALID", "kind must be a namespaced string.", `${path}.kind`));
  }
  if (!("payload" in o)) {
    issues.push(issue("FIELD_INVALID", "payload is required.", `${path}.payload`));
  } else if (o.payload === undefined) {
    issues.push(issue("FIELD_INVALID", "payload must not be undefined.", `${path}.payload`));
  }

  if (o.issuer !== undefined && !isNonEmptyString(o.issuer)) {
    issues.push(issue("FIELD_INVALID", "issuer must be a non-empty string when present.", `${path}.issuer`));
  }

  if (o.subject !== undefined) {
    if (!isRecord(o.subject)) {
      issues.push(issue("SHAPE_INVALID", "subject must be an object.", `${path}.subject`));
    } else {
      const subject = o.subject as any;
      const allowedSubject = ["nodeId", "contentHash"];
      if (!hasOnlyKeys(subject, allowedSubject)) {
        issues.push(issue("EVIDENCE_FIELDS_INVALID", "subject contains disallowed fields.", `${path}.subject`));
      }
      if (subject.nodeId !== undefined) {
        issues.push(...validateNodeId(subject.nodeId, `${path}.subject.nodeId`));
      }
      if (subject.contentHash !== undefined && !isNonEmptyString(subject.contentHash)) {
        issues.push(
          issue("FIELD_INVALID", "contentHash must be a non-empty string.", `${path}.subject.contentHash`)
        );
      }
    }
  }

  if (o.meta !== undefined) {
    if (!isRecord(o.meta)) {
      issues.push(issue("SHAPE_INVALID", "meta must be an object.", `${path}.meta`));
    } else {
      const meta = o.meta as any;
      const allowedMeta = ["issuedAt", "expiresAt", "issuedBy", "scope"];
      if (!hasOnlyKeys(meta, allowedMeta)) {
        issues.push(issue("EVIDENCE_FIELDS_INVALID", "meta contains disallowed fields.", `${path}.meta`));
      }
      if (meta.issuedAt !== undefined && !isString(meta.issuedAt)) {
        issues.push(issue("FIELD_INVALID", "issuedAt must be a string when present.", `${path}.meta.issuedAt`));
      }
      if (meta.expiresAt !== undefined && !isString(meta.expiresAt)) {
        issues.push(issue("FIELD_INVALID", "expiresAt must be a string when present.", `${path}.meta.expiresAt`));
      }
      if (meta.issuedBy !== undefined && !isNonEmptyString(meta.issuedBy)) {
        issues.push(issue("FIELD_INVALID", "issuedBy must be a non-empty string.", `${path}.meta.issuedBy`));
      }
      if (meta.scope !== undefined && !isString(meta.scope)) {
        issues.push(issue("FIELD_INVALID", "scope must be a string when present.", `${path}.meta.scope`));
      }
    }
  }

  if (o.kind === "build.attestation.v0") {
    issues.push(...validateBuildAttestationPayloadV0(o.payload, `${path}.payload`));
  }

  if (isNonEmptyString(o.evidenceId) && isNamespacedKind(o.kind)) {
    try {
      const expected = computeEvidenceIdV0({
        kind: o.kind,
        payload: o.payload,
        issuer: o.issuer,
        subject: o.subject,
        meta: o.meta,
      });
      if (checkpointEqOrReasonV0(expected, o.evidenceId, "EVIDENCE_DIGEST_MISMATCH").length > 0) {
        issues.push(
          issue("EVIDENCE_DIGEST_MISMATCH", "evidenceId must match canonical hash.", `${path}.evidenceId`)
        );
      }
    } catch {
      issues.push(issue("CANONICAL_INVALID", "EvidenceRecord must be canonicalizable.", path));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateEvidenceBundleV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "EvidenceBundleV0 must be an object.", path)];

  const allowed = ["schema", "records"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "EvidenceBundleV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.evidence/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.evidence/0.", `${path}.schema`));
  }

  if (!Array.isArray(o.records)) {
    issues.push(issue("FIELD_INVALID", "records must be EvidenceRecord[].", `${path}.records`));
  } else {
    const ids: string[] = [];
    o.records.forEach((rec: unknown, i: number) => {
      issues.push(...validateEvidenceRecord(rec, `${path}.records[${i}]`));
      if (isRecord(rec) && isTightString((rec as any).evidenceId)) {
        ids.push((rec as any).evidenceId);
      }
    });
    if (!isSortedUniqueStrings(ids)) {
      issues.push(issue("FIELD_INVALID", "records must be stable-sorted and unique by evidenceId.", `${path}.records`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateTartarusRecordV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "TartarusRecordV0 must be an object.", path)];

  const allowed = [
    "schema",
    "recordId",
    "planDigest",
    "blockHash",
    "kind",
    "severity",
    "remedy",
    "reasonCodes",
    "stampDigest",
    "evidenceDigests",
    "seq",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "TartarusRecordV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.tartarus/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.tartarus/0.", `${path}.schema`));
  }
  if (!isTightString(o.recordId))
    issues.push(issue("FIELD_INVALID", "recordId must be a non-empty string.", `${path}.recordId`));
  if (!isTightString(o.planDigest))
    issues.push(issue("FIELD_INVALID", "planDigest must be a non-empty string.", `${path}.planDigest`));
  if (!isTightString(o.blockHash))
    issues.push(issue("FIELD_INVALID", "blockHash must be a non-empty string.", `${path}.blockHash`));

  const kinds = new Set([
    "stamp.missing",
    "stamp.invalid",
    "tier.violation",
    "membrane.selftest.failed",
    "cap.replay",
    "secretzone.unavailable",
    "secret.leak.attempt",
    "privacy.field.forbidden",
    "privacy.timestamp.forbidden",
    "privacy.string.untrusted",
    "privacy.receipt.oversize",
    "privacy.receipt.unbounded",
    "artifact.mismatch",
    "pkg.locator.mismatch",
    "evidence.digest.mismatch",
    "release.manifest.invalid",
    "release.manifest.mismatch",
    "release.signature.bad",
    "history.invalid",
    "history.signature.bad",
    "history.link.mismatch",
    "market.takedown.active",
    "market.ban.active",
    "market.allowlist.missing",
    "market.evidence.missing",
  ]);
  if (!isString(o.kind) || !kinds.has(o.kind))
    issues.push(issue("ENUM_INVALID", "kind must be a known Tartarus kind.", `${path}.kind`));

  const severities = new Set(["INFO", "WARN", "DENY", "QUARANTINE"]);
  if (!isString(o.severity) || !severities.has(o.severity))
    issues.push(issue("ENUM_INVALID", "severity must be INFO|WARN|DENY|QUARANTINE.", `${path}.severity`));

  const remedies = new Set([
    "PROVIDE_EVIDENCE",
    "DOWNGRADE_MODE",
    "MOVE_TIER_DOWN",
    "REBUILD_FROM_TRUSTED",
    "CONTACT_SHOP",
    "NONE",
  ]);
  if (!isString(o.remedy) || !remedies.has(o.remedy))
    issues.push(issue("ENUM_INVALID", "remedy must be a known Tartarus remedy.", `${path}.remedy`));

  const reasons = asStringArray(o.reasonCodes);
  if (!reasons) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
  } else {
    reasons.forEach((r, i) => {
      if (!isTightString(r))
        issues.push(issue("FIELD_INVALID", "reasonCodes entries must be non-empty strings.", `${path}.reasonCodes[${i}]`));
    });
    if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
    }
  }

  if (o.stampDigest !== undefined && !isTightString(o.stampDigest)) {
    issues.push(issue("FIELD_INVALID", "stampDigest must be a non-empty string when present.", `${path}.stampDigest`));
  }

  if (o.evidenceDigests !== undefined) {
    const digests = asStringArray(o.evidenceDigests);
    if (!digests) {
      issues.push(issue("FIELD_INVALID", "evidenceDigests must be string[] when present.", `${path}.evidenceDigests`));
    } else {
      digests.forEach((d, i) => {
        if (!isTightString(d))
          issues.push(
            issue("FIELD_INVALID", "evidenceDigests entries must be non-empty strings.", `${path}.evidenceDigests[${i}]`)
          );
      });
      if (!isSortedUniqueStrings(digests)) {
        issues.push(issue("FIELD_INVALID", "evidenceDigests must be stable-sorted and unique.", `${path}.evidenceDigests`));
      }
    }
  }

  if (o.seq !== undefined && (!Number.isInteger(o.seq) || o.seq < 0)) {
    issues.push(issue("FIELD_INVALID", "seq must be an integer >= 0 when present.", `${path}.seq`));
  }

  return sortIssuesDeterministically(issues);
}

const checkReceiptSummary = (value: unknown, path: string, issues: ValidationIssue[]): void => {
  if (!isRecord(value)) {
    issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary must be an object.", path));
    return;
  }
  const allowed = ["schema", "v", "total", "denies", "quarantines", "lastReceiptId", "bindTo", "receiptDigest"];
  if (!hasOnlyKeys(value, allowed)) {
    issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary contains disallowed fields.", path));
  }
  if ((value as any).schema !== undefined && (value as any).schema !== "weftend.receiptSummary/0") {
    issues.push(
      issue("RECEIPT_UNBOUNDED", "receiptSummary.schema must be weftend.receiptSummary/0.", `${path}.schema`)
    );
  }
  if ((value as any).v !== undefined && (value as any).v !== 0) {
    issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary.v must be 0.", `${path}.v`));
  }
  if (!isNumber((value as any).total) || (value as any).total < 0) {
    issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary.total must be a non-negative number.", `${path}.total`));
  }
  if (!isNumber((value as any).denies) || (value as any).denies < 0) {
    issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary.denies must be a non-negative number.", `${path}.denies`));
  }
  if (!isNumber((value as any).quarantines) || (value as any).quarantines < 0) {
    issues.push(
      issue("RECEIPT_UNBOUNDED", "receiptSummary.quarantines must be a non-negative number.", `${path}.quarantines`)
    );
  }
  if ((value as any).lastReceiptId !== undefined) {
    if (!isTightString((value as any).lastReceiptId)) {
      issues.push(
        issue("RECEIPT_UNBOUNDED", "receiptSummary.lastReceiptId must be a non-empty string.", `${path}.lastReceiptId`)
      );
    } else if (utf8ByteLength((value as any).lastReceiptId) > PRIVACY_MAX_STRING_BYTES) {
      issues.push(issue("RECEIPT_OVERSIZE", "receiptSummary.lastReceiptId exceeds max size.", `${path}.lastReceiptId`));
    }
  }
  if ((value as any).bindTo !== undefined) {
    const bindTo = (value as any).bindTo;
    if (!isRecord(bindTo)) {
      issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary.bindTo must be an object.", `${path}.bindTo`));
    } else {
      if (!hasOnlyKeys(bindTo, ["releaseId", "pathDigest"])) {
        issues.push(issue("RECEIPT_UNBOUNDED", "receiptSummary.bindTo contains disallowed fields.", `${path}.bindTo`));
      }
      if (!isBoundedTightString((bindTo as any).releaseId, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(
          issue(
            "RECEIPT_UNBOUNDED",
            "receiptSummary.bindTo.releaseId must be a non-empty string.",
            `${path}.bindTo.releaseId`
          )
        );
      }
      if (!isBoundedTightString((bindTo as any).pathDigest, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(
          issue(
            "RECEIPT_UNBOUNDED",
            "receiptSummary.bindTo.pathDigest must be a non-empty string.",
            `${path}.bindTo.pathDigest`
          )
        );
      }
    }
  }
  if ((value as any).receiptDigest !== undefined) {
    if (!isTightString((value as any).receiptDigest)) {
      issues.push(
        issue(
          "RECEIPT_UNBOUNDED",
          "receiptSummary.receiptDigest must be a non-empty string.",
          `${path}.receiptDigest`
        )
      );
    } else if (utf8ByteLength((value as any).receiptDigest) > PRIVACY_MAX_STRING_BYTES) {
      issues.push(issue("RECEIPT_OVERSIZE", "receiptSummary.receiptDigest exceeds max size.", `${path}.receiptDigest`));
    }
  }
};

const validateWeftendBuildV0 = (v: unknown, path: string): ValidationIssue[] => {
  if (!isRecord(v)) return [issue("FIELD_INVALID", "weftendBuild must be an object.", path)];
  const o = v as any;
  const issues: ValidationIssue[] = [];
  const allowed = ["algo", "digest", "source", "reasonCodes"];
  if (!hasOnlyKeys(v as Record<string, unknown>, allowed)) {
    issues.push(issue("FIELD_INVALID", "weftendBuild contains disallowed fields.", path));
  }
  if (o.algo !== "sha256") {
    issues.push(issue("FIELD_INVALID", "weftendBuild.algo must be sha256.", `${path}.algo`));
  }
  if (!isBoundedTightString(o.digest, PRIVACY_MAX_STRING_BYTES)) {
    issues.push(issue("FIELD_INVALID", "weftendBuild.digest must be a non-empty string.", `${path}.digest`));
  }
  if (o.source !== "HOST_BINARY_PATH" && o.source !== "NODE_MAIN_JS" && o.source !== "UNKNOWN") {
    issues.push(issue("FIELD_INVALID", "weftendBuild.source must be a known source.", `${path}.source`));
  }
  if (o.reasonCodes !== undefined) {
    const codes = asStringArray(o.reasonCodes);
    if (!codes) {
      issues.push(issue("FIELD_INVALID", "weftendBuild.reasonCodes must be string[].", `${path}.reasonCodes`));
    } else {
      codes.forEach((code, i) => {
        if (!isBoundedTightString(code, PRIVACY_MAX_STRING_BYTES)) {
          issues.push(
            issue(
              "FIELD_INVALID",
              "weftendBuild.reasonCodes entries must be non-empty strings.",
              `${path}.reasonCodes[${i}]`
            )
          );
        }
      });
      if (!isSortedUniqueStrings(codes)) {
        issues.push(
          issue("FIELD_INVALID", "weftendBuild.reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`)
        );
      }
      if (codes.length > MAX_REASONS_PER_BLOCK) {
        issues.push(
          issue(
            "FIELD_INVALID",
            `weftendBuild.reasonCodes must not exceed ${MAX_REASONS_PER_BLOCK} entries.`,
            `${path}.reasonCodes`
          )
        );
      }
    }
  }
  return issues;
};

export function validateReceiptSummaryV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkReceiptSummary(v, path, issues);
  return sortIssuesDeterministically(issues);
}

export function validatePulseV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "PulseV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "pulseSeq",
    "kind",
    "subject",
    "capId",
    "reasonCodes",
    "digests",
    "counts",
    "pulseDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "PulseV0 contains disallowed fields.", path));
  }

  const o = v as any;
  let canDigest = true;

  if (o.schema !== "weftend.pulse/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.pulse/0.", `${path}.schema`));
    canDigest = false;
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must be 0.", `${path}.v`));
    canDigest = false;
  }
  if (!Number.isInteger(o.pulseSeq) || o.pulseSeq < 0) {
    issues.push(issue("FIELD_INVALID", "pulseSeq must be an integer >= 0.", `${path}.pulseSeq`));
    canDigest = false;
  }

  const kinds = new Set(["PUBLISH", "LOAD", "CAP_REQUEST", "CAP_DENY", "CAP_ALLOW", "EXIT"]);
  if (!isString(o.kind) || !kinds.has(o.kind)) {
    issues.push(issue("ENUM_INVALID", "kind must be a known pulse kind.", `${path}.kind`));
    canDigest = false;
  }

  if (!isRecord(o.subject)) {
    issues.push(issue("FIELD_INVALID", "subject must be an object.", `${path}.subject`));
    canDigest = false;
  } else {
    const subject = o.subject as any;
    if (subject.kind !== "release" && subject.kind !== "block") {
      issues.push(issue("ENUM_INVALID", "subject.kind must be release|block.", `${path}.subject.kind`));
      canDigest = false;
    }
    if (!isBoundedTightString(subject.id, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "subject.id must be a non-empty string.", `${path}.subject.id`));
      canDigest = false;
    }
  }

  if (o.capId !== undefined && !isBoundedTightString(o.capId, PRIVACY_MAX_STRING_BYTES)) {
    issues.push(issue("FIELD_INVALID", "capId must be a non-empty string when present.", `${path}.capId`));
  }

  if (o.reasonCodes !== undefined) {
    const codes = asStringArray(o.reasonCodes);
    if (!codes) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
    } else {
      if (codes.length > MAX_REASONS_PER_BLOCK) {
        issues.push(
          issue("FIELD_INVALID", `reasonCodes must not exceed ${MAX_REASONS_PER_BLOCK} entries.`, `${path}.reasonCodes`)
        );
      }
      if (!isSortedUniqueStrings(codes)) {
        issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
      }
    }
  }

  if (o.digests !== undefined) {
    if (!isRecord(o.digests)) {
      issues.push(issue("FIELD_INVALID", "digests must be an object when present.", `${path}.digests`));
    } else if (!hasOnlyKeys(o.digests as Record<string, unknown>, ["releaseId", "pathDigest", "planHash", "evidenceHead"])) {
      issues.push(issue("FIELD_INVALID", "digests contains disallowed fields.", `${path}.digests`));
    } else {
      const d = o.digests as any;
      const check = (val: unknown, key: string) => {
        if (val !== undefined && !isBoundedTightString(val, PRIVACY_MAX_STRING_BYTES)) {
          issues.push(
            issue("FIELD_INVALID", `${key} must be a non-empty string when present.`, `${path}.digests.${key}`)
          );
        }
      };
      check(d.releaseId, "releaseId");
      check(d.pathDigest, "pathDigest");
      check(d.planHash, "planHash");
      check(d.evidenceHead, "evidenceHead");
    }
  }

  if (o.counts !== undefined) {
    if (!isRecord(o.counts)) {
      issues.push(issue("FIELD_INVALID", "counts must be an object when present.", `${path}.counts`));
    } else if (!hasOnlyKeys(o.counts as Record<string, unknown>, ["capsRequested", "capsDenied", "tartarusNew"])) {
      issues.push(issue("FIELD_INVALID", "counts contains disallowed fields.", `${path}.counts`));
    } else {
      const c = o.counts as any;
      const check = (val: unknown, key: string) => {
        if (val !== undefined) {
          const n = typeof val === "number" ? val : NaN;
          if (!Number.isInteger(n) || n < 0) {
          issues.push(
            issue("FIELD_INVALID", `${key} must be an integer >= 0 when present.`, `${path}.counts.${key}`)
          );
          }
        }
      };
      check(c.capsRequested, "capsRequested");
      check(c.capsDenied, "capsDenied");
      check(c.tartarusNew, "tartarusNew");
    }
  }

  if (!isBoundedTightString(o.pulseDigest, PRIVACY_MAX_STRING_BYTES)) {
    issues.push(issue("FIELD_INVALID", "pulseDigest must be a non-empty string.", `${path}.pulseDigest`));
  } else if (canDigest) {
    const expected = computePulseDigestV0(o as PulseBodyV0 | PulseV0);
    if (o.pulseDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "pulseDigest must match canonical body digest.", `${path}.pulseDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateVerifyReportExportV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "VerifyReportExportV0 must be an object.", path)];

  const allowed = ["schema", "ok", "status", "reasonCodes", "strictPolicy", "tartarusSummary"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "VerifyReportExportV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.verifyReport/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.verifyReport/0.", `${path}.schema`));
  }
  if (!isBoolean(o.ok)) {
    issues.push(issue("FIELD_INVALID", "ok must be boolean.", `${path}.ok`));
  }
  const statuses = new Set(["OK", "UNVERIFIED", "MAYBE"]);
  if (!isString(o.status) || !statuses.has(o.status)) {
    issues.push(issue("ENUM_INVALID", "status must be OK|UNVERIFIED|MAYBE.", `${path}.status`));
  }

  const codes = asStringArray(o.reasonCodes);
  if (!codes) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
  } else {
    if (codes.length > MAX_VERIFY_REASON_CODES) {
      issues.push(
        issue(
          "FIELD_INVALID",
          `reasonCodes must not exceed ${MAX_VERIFY_REASON_CODES} entries.`,
          `${path}.reasonCodes`
        )
      );
    }
    if (!isSortedUniqueStrings(codes)) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
    }
    codes.forEach((code, i) => {
      if (!isBoundedTightString(code, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(
          issue("FIELD_INVALID", "reasonCodes entries must be non-empty strings.", `${path}.reasonCodes[${i}]`)
        );
      }
    });
  }

  if (o.strictPolicy !== undefined) {
    if (!isRecord(o.strictPolicy)) {
      issues.push(issue("FIELD_INVALID", "strictPolicy must be an object when present.", `${path}.strictPolicy`));
    } else if (!hasOnlyKeys(o.strictPolicy as Record<string, unknown>, ["requireBuildAttestation"])) {
      issues.push(issue("FIELD_INVALID", "strictPolicy contains disallowed fields.", `${path}.strictPolicy`));
    } else if (
      o.strictPolicy.requireBuildAttestation !== undefined &&
      !isBoolean(o.strictPolicy.requireBuildAttestation)
    ) {
      issues.push(
        issue(
          "FIELD_INVALID",
          "requireBuildAttestation must be boolean when present.",
          `${path}.strictPolicy.requireBuildAttestation`
        )
      );
    }
  }

  if (o.tartarusSummary !== undefined) {
    if (!isRecord(o.tartarusSummary)) {
      issues.push(issue("FIELD_INVALID", "tartarusSummary must be an object when present.", `${path}.tartarusSummary`));
    } else if (!hasOnlyKeys(o.tartarusSummary as Record<string, unknown>, ["total", "bySeverity", "byKind"])) {
      issues.push(issue("FIELD_INVALID", "tartarusSummary contains disallowed fields.", `${path}.tartarusSummary`));
    } else {
      const summary = o.tartarusSummary as any;
      if (!Number.isInteger(summary.total) || summary.total < 0) {
        issues.push(
          issue("FIELD_INVALID", "tartarusSummary.total must be an integer >= 0.", `${path}.tartarusSummary.total`)
        );
      }
      if (!isRecord(summary.bySeverity)) {
        issues.push(
          issue(
            "FIELD_INVALID",
            "tartarusSummary.bySeverity must be an object.",
            `${path}.tartarusSummary.bySeverity`
          )
        );
      } else {
        const allowedSev = new Set(["DENY", "INFO", "WARN", "QUARANTINE"]);
        Object.keys(summary.bySeverity).forEach((key) => {
          if (!allowedSev.has(key)) {
            issues.push(
              issue(
                "FIELD_INVALID",
                "tartarusSummary.bySeverity contains unknown key.",
                `${path}.tartarusSummary.bySeverity.${key}`
              )
            );
          }
          const val = summary.bySeverity[key];
          if (!Number.isInteger(val) || val < 0) {
            issues.push(
              issue(
                "FIELD_INVALID",
                "tartarusSummary.bySeverity values must be integer >= 0.",
                `${path}.tartarusSummary.bySeverity.${key}`
              )
            );
          }
        });
      }
      if (!isRecord(summary.byKind)) {
        issues.push(
          issue("FIELD_INVALID", "tartarusSummary.byKind must be an object.", `${path}.tartarusSummary.byKind`)
        );
      } else {
        Object.keys(summary.byKind).forEach((key) => {
          const val = summary.byKind[key];
          if (!Number.isInteger(val) || val < 0) {
            issues.push(
              issue(
                "FIELD_INVALID",
                "tartarusSummary.byKind values must be integer >= 0.",
                `${path}.tartarusSummary.byKind.${key}`
              )
            );
          }
        });
      }
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateReceiptPackageV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "ReceiptPackageV0 must be an object.", path)];

  const allowed = ["schema", "v", "bind", "contents", "digests"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "ReceiptPackageV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.receiptPackage/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.receiptPackage/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must be 0.", `${path}.v`));
  }

  if (!isRecord(o.bind)) {
    issues.push(issue("FIELD_INVALID", "bind must be an object.", `${path}.bind`));
  } else {
    if (!isBoundedTightString(o.bind.releaseId, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "bind.releaseId must be a non-empty string.", `${path}.bind.releaseId`));
    }
    if (!isBoundedTightString(o.bind.pathDigest, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "bind.pathDigest must be a non-empty string.", `${path}.bind.pathDigest`));
    }
  }

  if (!isRecord(o.contents)) {
    issues.push(issue("FIELD_INVALID", "contents must be an object.", `${path}.contents`));
  } else {
    if (!hasOnlyKeys(o.contents as Record<string, unknown>, ["verifyReport", "receiptSummary", "pulses"])) {
      issues.push(issue("FIELD_INVALID", "contents contains disallowed fields.", `${path}.contents`));
    }
    const verifyReportIssues = validateVerifyReportExportV0(o.contents.verifyReport, `${path}.contents.verifyReport`);
    if (verifyReportIssues.length > 0) issues.push(...verifyReportIssues);

    if (o.contents.receiptSummary !== undefined) {
      issues.push(
        ...validateReceiptSummaryV0(o.contents.receiptSummary, `${path}.contents.receiptSummary`)
      );
    }

    if (o.contents.pulses !== undefined) {
      const pulsesObj = o.contents.pulses;
      if (!isRecord(pulsesObj)) {
        issues.push(issue("FIELD_INVALID", "pulses must be an object.", `${path}.contents.pulses`));
      } else if (!hasOnlyKeys(pulsesObj as Record<string, unknown>, ["schema", "v", "pulses"])) {
        issues.push(issue("FIELD_INVALID", "pulses contains disallowed fields.", `${path}.contents.pulses`));
      } else {
        if (pulsesObj.schema !== "weftend.pulseBuffer/0") {
          issues.push(
            issue("FIELD_INVALID", "pulses.schema must be weftend.pulseBuffer/0.", `${path}.contents.pulses.schema`)
          );
        }
        if (pulsesObj.v !== 0) {
          issues.push(issue("FIELD_INVALID", "pulses.v must be 0.", `${path}.contents.pulses.v`));
        }
        if (!isArray(pulsesObj.pulses)) {
          issues.push(issue("FIELD_INVALID", "pulses.pulses must be an array.", `${path}.contents.pulses.pulses`));
        } else {
          if (pulsesObj.pulses.length > MAX_PULSE_ITEMS) {
            issues.push(
              issue(
                "FIELD_INVALID",
                `pulses.pulses must not exceed ${MAX_PULSE_ITEMS} entries.`,
                `${path}.contents.pulses.pulses`
              )
            );
          }
          pulsesObj.pulses.forEach((pulse: unknown, i: number) => {
            const pulseIssues = validatePulseV0(pulse, `${path}.contents.pulses.pulses[${i}]`);
            if (pulseIssues.length > 0) issues.push(...pulseIssues);
          });
        }
      }
    }
  }

  if (!isRecord(o.digests)) {
    issues.push(issue("FIELD_INVALID", "digests must be an object.", `${path}.digests`));
  } else {
    if (
      !hasOnlyKeys(o.digests as Record<string, unknown>, [
        "verifyReportDigest",
        "receiptSummaryDigest",
        "pulsesDigest",
        "packageDigest",
      ])
    ) {
      issues.push(issue("FIELD_INVALID", "digests contains disallowed fields.", `${path}.digests`));
    }
    if (!isBoundedTightString(o.digests.verifyReportDigest, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(
        issue("FIELD_INVALID", "verifyReportDigest must be a non-empty string.", `${path}.digests.verifyReportDigest`)
      );
    }
    if (o.digests.receiptSummaryDigest !== undefined && !isBoundedTightString(o.digests.receiptSummaryDigest, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(
        issue(
          "FIELD_INVALID",
          "receiptSummaryDigest must be a non-empty string when present.",
          `${path}.digests.receiptSummaryDigest`
        )
      );
    }
    if (o.digests.pulsesDigest !== undefined && !isBoundedTightString(o.digests.pulsesDigest, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(
        issue(
          "FIELD_INVALID",
          "pulsesDigest must be a non-empty string when present.",
          `${path}.digests.pulsesDigest`
        )
      );
    }
    if (!isBoundedTightString(o.digests.packageDigest, PRIVACY_MAX_STRING_BYTES)) {
      issues.push(
        issue("FIELD_INVALID", "packageDigest must be a non-empty string.", `${path}.digests.packageDigest`)
      );
    }
  }

  return sortIssuesDeterministically(issues);
}

const checkGateReceipt = (value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void => {
  if (!hasOnlyKeys(value, ["receiptId", "body", "signatures"])) {
    issues.push(issue("RECEIPT_UNBOUNDED", "GateReceiptV0 contains disallowed fields.", path));
  }
  const body = (value as any).body;
  if (!isRecord(body)) {
    issues.push(issue("RECEIPT_UNBOUNDED", "GateReceiptV0.body must be an object.", `${path}.body`));
    return;
  }
  const allowedBody = [
    "schema",
    "gateId",
    "marketId",
    "marketPolicyDigest",
    "planDigest",
    "releaseId",
    "blockHash",
    "decision",
    "reasonCodes",
    "checkpointDigest",
  ];
  if (!hasOnlyKeys(body, allowedBody)) {
    issues.push(issue("RECEIPT_UNBOUNDED", "GateReceiptV0.body contains disallowed fields.", `${path}.body`));
  }
  const reasons = (body as any).reasonCodes;
  if (Array.isArray(reasons) && reasons.length > MAX_REASONS_PER_BLOCK) {
    issues.push(
      issue(
        "RECEIPT_OVERSIZE",
        `GateReceiptV0.reasonCodes exceeds ${MAX_REASONS_PER_BLOCK}.`,
        `${path}.body.reasonCodes`
      )
    );
  }
  const sigs = (value as any).signatures;
  if (Array.isArray(sigs) && sigs.length > PRIVACY_MAX_RECEIPT_SIGNATURES) {
    issues.push(
      issue(
        "RECEIPT_OVERSIZE",
        `GateReceiptV0.signatures exceeds ${PRIVACY_MAX_RECEIPT_SIGNATURES}.`,
        `${path}.signatures`
      )
    );
  }
};

const isSortedRecoveryActions = (items: any[]): boolean => {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const next = items[i];
    const c0 = cmpStr(prev.target, next.target);
    if (c0 > 0) return false;
    if (c0 === 0) {
      const c1 = cmpStr(prev.expectedDigest, next.expectedDigest);
      if (c1 > 0) return false;
      if (c1 === 0) {
        const c2 = cmpStr(prev.expectedPlanDigest ?? "", next.expectedPlanDigest ?? "");
        if (c2 > 0) return false;
        if (c2 === 0) {
          const c3 = cmpStr(prev.cacheKey, next.cacheKey);
          if (c3 > 0) return false;
          if (c3 === 0 && Number(prev.available) > Number(next.available)) return false;
        }
      }
    }
  }
  return true;
};

const isSortedRecoveryIssues = (items: any[]): boolean => {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const next = items[i];
    const c0 = cmpStr(prev.path ?? "\uffff", next.path ?? "\uffff");
    if (c0 > 0) return false;
    if (c0 === 0) {
      const c1 = cmpStr(prev.code ?? "", next.code ?? "");
      if (c1 > 0) return false;
      if (c1 === 0 && cmpStr(prev.message ?? "", next.message ?? "") > 0) return false;
    }
  }
  return true;
};

const checkRecoveryPlan = (value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void => {
  if (!hasOnlyKeys(value, ["schema", "releaseId", "planDigest", "actions", "issues"])) {
    issues.push(issue("RECEIPT_UNBOUNDED", "RecoveryPlanV0 contains disallowed fields.", path));
  }
  const actions = (value as any).actions;
  if (Array.isArray(actions) && actions.length > MAX_RECOVERY_ACTIONS) {
    issues.push(
      issue("RECEIPT_OVERSIZE", `RecoveryPlanV0.actions exceeds ${MAX_RECOVERY_ACTIONS}.`, `${path}.actions`)
    );
  }
};

const checkRecoveryReceipt = (value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void => {
  if (!hasOnlyKeys(value, ["schema", "planDigest", "releaseId", "actions", "applied", "skipped", "failed"])) {
    issues.push(issue("RECEIPT_UNBOUNDED", "RecoveryReceiptV0 contains disallowed fields.", path));
  }
  const actions = (value as any).actions;
  if (Array.isArray(actions) && actions.length > MAX_RECOVERY_ACTIONS) {
    issues.push(
      issue("RECEIPT_OVERSIZE", `RecoveryReceiptV0.actions exceeds ${MAX_RECOVERY_ACTIONS}.`, `${path}.actions`)
    );
  }
};

export function validateRecoveryPlanV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "RecoveryPlanV0 must be an object.", path)];

  const allowed = ["schema", "releaseId", "planDigest", "actions", "issues"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "RecoveryPlanV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.recoveryPlan/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.recoveryPlan/0.", `${path}.schema`));
  }
  if (o.releaseId !== undefined && !isBoundedTightString(o.releaseId, MAX_RECOVERY_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string when present.", `${path}.releaseId`));
  }
  if (o.planDigest !== undefined && !isBoundedTightString(o.planDigest, MAX_RECOVERY_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "planDigest must be a non-empty string when present.", `${path}.planDigest`));
  }

  if (!isArray(o.actions)) {
    issues.push(issue("FIELD_INVALID", "actions must be an array.", `${path}.actions`));
  } else {
    if (o.actions.length > MAX_RECOVERY_ACTIONS) {
      issues.push(issue("FIELD_INVALID", `actions must not exceed ${MAX_RECOVERY_ACTIONS} entries.`, `${path}.actions`));
    }
    const items: any[] = [];
    o.actions.forEach((action: unknown, i: number) => {
      if (!isRecord(action)) {
        issues.push(issue("SHAPE_INVALID", "action must be an object.", `${path}.actions[${i}]`));
        return;
      }
      const entry = action as any;
      if (!hasOnlyKeys(entry, ["kind", "target", "expectedDigest", "expectedPlanDigest", "cacheKey", "available", "reasonCodes"])) {
        issues.push(issue("FIELD_INVALID", "action contains disallowed fields.", `${path}.actions[${i}]`));
      }
      if (entry.kind !== "restore") {
        issues.push(issue("FIELD_INVALID", "kind must be restore.", `${path}.actions[${i}].kind`));
      }
      if (entry.target !== "runtime_bundle.json" && entry.target !== "evidence.json") {
        issues.push(issue("FIELD_INVALID", "target must be runtime_bundle.json|evidence.json.", `${path}.actions[${i}].target`));
      }
      if (!isBoundedTightString(entry.expectedDigest, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "expectedDigest must be a non-empty string.", `${path}.actions[${i}].expectedDigest`));
      }
      if (entry.expectedPlanDigest !== undefined && !isBoundedTightString(entry.expectedPlanDigest, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "expectedPlanDigest must be a non-empty string when present.", `${path}.actions[${i}].expectedPlanDigest`));
      }
      if (!isBoundedTightString(entry.cacheKey, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "cacheKey must be a non-empty string.", `${path}.actions[${i}].cacheKey`));
      }
      if (!isBoolean(entry.available)) {
        issues.push(issue("FIELD_INVALID", "available must be a boolean.", `${path}.actions[${i}].available`));
      }
      if (entry.reasonCodes !== undefined) {
        const codes = asStringArray(entry.reasonCodes);
        if (!codes) {
          issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.actions[${i}].reasonCodes`));
        } else if (!isSortedUniqueStrings(codes)) {
          issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.actions[${i}].reasonCodes`));
        }
      }
      items.push({
        kind: "restore",
        target: entry.target,
        expectedDigest: entry.expectedDigest,
        ...(isNonEmptyString(entry.expectedPlanDigest) ? { expectedPlanDigest: entry.expectedPlanDigest } : {}),
        cacheKey: entry.cacheKey,
        available: entry.available,
        reasonCodes: Array.isArray(entry.reasonCodes) ? entry.reasonCodes : undefined,
      });
    });
    if (items.length > 1 && !isSortedRecoveryActions(items)) {
      issues.push(issue("FIELD_INVALID", "actions must be stable-sorted.", `${path}.actions`));
    }
  }

  if (o.issues !== undefined) {
    if (!isArray(o.issues)) {
      issues.push(issue("FIELD_INVALID", "issues must be an array.", `${path}.issues`));
    } else {
      if (o.issues.length > MAX_RECOVERY_ACTIONS) {
        issues.push(issue("FIELD_INVALID", `issues must not exceed ${MAX_RECOVERY_ACTIONS} entries.`, `${path}.issues`));
      }
      const items: any[] = [];
      o.issues.forEach((entry: unknown, i: number) => {
        if (!isRecord(entry)) {
          issues.push(issue("SHAPE_INVALID", "issue must be an object.", `${path}.issues[${i}]`));
          return;
        }
        if (!hasOnlyKeys(entry, ["code", "message", "path"])) {
          issues.push(issue("FIELD_INVALID", "issue contains disallowed fields.", `${path}.issues[${i}]`));
        }
        if (!isBoundedTightString((entry as any).code, MAX_RECOVERY_STR_BYTES)) {
          issues.push(issue("FIELD_INVALID", "code must be a non-empty string.", `${path}.issues[${i}].code`));
        }
        if (!isBoundedTightString((entry as any).message, MAX_RECOVERY_STR_BYTES)) {
          issues.push(issue("FIELD_INVALID", "message must be a non-empty string.", `${path}.issues[${i}].message`));
        }
        if ((entry as any).path !== undefined && !isBoundedTightString((entry as any).path, MAX_RECOVERY_STR_BYTES)) {
          issues.push(issue("FIELD_INVALID", "path must be a non-empty string when present.", `${path}.issues[${i}].path`));
        }
        items.push({
          code: (entry as any).code,
          message: (entry as any).message,
          ...(isNonEmptyString((entry as any).path) ? { path: (entry as any).path } : {}),
        });
      });
      if (items.length > 1 && !isSortedRecoveryIssues(items)) {
        issues.push(issue("FIELD_INVALID", "issues must be stable-sorted.", `${path}.issues`));
      }
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateRecoveryReceiptV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "RecoveryReceiptV0 must be an object.", path)];

  const allowed = ["schema", "planDigest", "releaseId", "actions", "applied", "skipped", "failed"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "RecoveryReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.recoveryReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.recoveryReceipt/0.", `${path}.schema`));
  }
  if (!isBoundedTightString(o.planDigest, MAX_RECOVERY_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "planDigest must be a non-empty string.", `${path}.planDigest`));
  }
  if (o.releaseId !== undefined && !isBoundedTightString(o.releaseId, MAX_RECOVERY_STR_BYTES)) {
    issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string when present.", `${path}.releaseId`));
  }

  if (!isArray(o.actions)) {
    issues.push(issue("FIELD_INVALID", "actions must be an array.", `${path}.actions`));
  } else {
    if (o.actions.length > MAX_RECOVERY_ACTIONS) {
      issues.push(issue("FIELD_INVALID", `actions must not exceed ${MAX_RECOVERY_ACTIONS} entries.`, `${path}.actions`));
    }
    const items: any[] = [];
    o.actions.forEach((action: unknown, i: number) => {
      if (!isRecord(action)) {
        issues.push(issue("SHAPE_INVALID", "action must be an object.", `${path}.actions[${i}]`));
        return;
      }
      const entry = action as any;
      if (!hasOnlyKeys(entry, ["kind", "target", "expectedDigest", "cacheKey", "observedDigest", "observedPlanDigest", "observedPathDigest", "ok", "reasonCodes"])) {
        issues.push(issue("FIELD_INVALID", "action contains disallowed fields.", `${path}.actions[${i}]`));
      }
      if (entry.kind !== "restore") {
        issues.push(issue("FIELD_INVALID", "kind must be restore.", `${path}.actions[${i}].kind`));
      }
      if (entry.target !== "runtime_bundle.json" && entry.target !== "evidence.json") {
        issues.push(issue("FIELD_INVALID", "target must be runtime_bundle.json|evidence.json.", `${path}.actions[${i}].target`));
      }
      if (!isBoundedTightString(entry.expectedDigest, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "expectedDigest must be a non-empty string.", `${path}.actions[${i}].expectedDigest`));
      }
      if (!isBoundedTightString(entry.cacheKey, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "cacheKey must be a non-empty string.", `${path}.actions[${i}].cacheKey`));
      }
      if (entry.observedDigest !== undefined && !isBoundedTightString(entry.observedDigest, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "observedDigest must be a non-empty string when present.", `${path}.actions[${i}].observedDigest`));
      }
      if (entry.observedPlanDigest !== undefined && !isBoundedTightString(entry.observedPlanDigest, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "observedPlanDigest must be a non-empty string when present.", `${path}.actions[${i}].observedPlanDigest`));
      }
      if (entry.observedPathDigest !== undefined && !isBoundedTightString(entry.observedPathDigest, MAX_RECOVERY_STR_BYTES)) {
        issues.push(issue("FIELD_INVALID", "observedPathDigest must be a non-empty string when present.", `${path}.actions[${i}].observedPathDigest`));
      }
      if (!isBoolean(entry.ok)) {
        issues.push(issue("FIELD_INVALID", "ok must be a boolean.", `${path}.actions[${i}].ok`));
      }
      if (entry.reasonCodes !== undefined) {
        const codes = asStringArray(entry.reasonCodes);
        if (!codes) {
          issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.actions[${i}].reasonCodes`));
        } else if (!isSortedUniqueStrings(codes)) {
          issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.actions[${i}].reasonCodes`));
        }
      }
      items.push({
        kind: "restore",
        target: entry.target,
        expectedDigest: entry.expectedDigest,
        cacheKey: entry.cacheKey,
        ...(isNonEmptyString(entry.observedDigest) ? { observedDigest: entry.observedDigest } : {}),
        ...(isNonEmptyString(entry.observedPlanDigest) ? { observedPlanDigest: entry.observedPlanDigest } : {}),
        ...(isNonEmptyString(entry.observedPathDigest) ? { observedPathDigest: entry.observedPathDigest } : {}),
        ok: entry.ok,
        reasonCodes: Array.isArray(entry.reasonCodes) ? entry.reasonCodes : undefined,
      });
    });
    if (items.length > 1 && !isSortedRecoveryActions(items.map((item) => ({ ...item, available: item.ok } as any)))) {
      issues.push(issue("FIELD_INVALID", "actions must be stable-sorted.", `${path}.actions`));
    }
  }

  const applied = Number.isInteger(o.applied) ? o.applied : -1;
  const skipped = Number.isInteger(o.skipped) ? o.skipped : -1;
  const failed = Number.isInteger(o.failed) ? o.failed : -1;
  if (applied < 0) issues.push(issue("FIELD_INVALID", "applied must be an integer >= 0.", `${path}.applied`));
  if (skipped < 0) issues.push(issue("FIELD_INVALID", "skipped must be an integer >= 0.", `${path}.skipped`));
  if (failed < 0) issues.push(issue("FIELD_INVALID", "failed must be an integer >= 0.", `${path}.failed`));
  if (applied >= 0 && skipped >= 0 && failed >= 0 && isArray(o.actions)) {
    const total = applied + skipped + failed;
    if (total !== o.actions.length) {
      issues.push(issue("FIELD_INVALID", "applied+skipped+failed must equal actions length.", `${path}.applied`));
    }
  }

  return sortIssuesDeterministically(issues);
}

// -----------------------------
// Mint package v1 (product output)
// -----------------------------

const isMintStatus = (v: unknown): v is MintGradeStatusV1 =>
  v === "OK" || v === "WARN" || v === "DENY" || v === "QUARANTINE";

const validateMintProbeV1 = (v: unknown, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "MintProbeResultV1 must be an object.", path)];

  const allowed = ["status", "reasonCodes", "deniedCaps", "attemptedCaps"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "MintProbeResultV1 contains disallowed fields.", path));
  }

  const o = v as MintProbeResultV1 & Record<string, unknown>;
  if (!isMintStatus(o.status)) {
    issues.push(issue("FIELD_INVALID", "status must be OK|WARN|DENY|QUARANTINE.", `${path}.status`));
  }

  const reasons = asStringArray(o.reasonCodes ?? []);
  if (!reasons) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
  } else {
    if (reasons.length > MAX_MINT_REASON_CODES) {
      issues.push(
        issue(
          "FIELD_INVALID",
          `reasonCodes must not exceed ${MAX_MINT_REASON_CODES} entries.`,
          `${path}.reasonCodes`
        )
      );
    }
    if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
    }
  }

  const checkCapMap = (value: unknown, p: string) => {
    if (!isRecord(value)) {
      issues.push(issue("FIELD_INVALID", "cap map must be an object.", p));
      return;
    }
    for (const key of Object.keys(value)) {
      if (!isBoundedTightString(key, MAX_MINT_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "capId must be a bounded string.", `${p}.${key}`));
      }
      const n = (value as any)[key];
      if (!Number.isFinite(n) || n < 0) {
        issues.push(issue("FIELD_INVALID", "cap count must be a finite number >= 0.", `${p}.${key}`));
      }
    }
  };

  checkCapMap(o.deniedCaps, `${path}.deniedCaps`);
  checkCapMap(o.attemptedCaps, `${path}.attemptedCaps`);

  return issues;
};

export function validateMintPackageV1(v: unknown, path: string = "mint"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "WeftendMintPackageV1 must be an object.", path)];

  const allowed = [
    "schema",
    "profile",
    "input",
    "capture",
    "observations",
    "executionProbes",
    "grade",
    "digests",
    "limits",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "WeftendMintPackageV1 contains disallowed fields.", path));
  }

  const o = v as WeftendMintPackageV1 & Record<string, unknown>;
  if (o.schema !== "weftend.mint/1") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.mint/1.", `${path}.schema`));
  }
  if (o.profile !== "web" && o.profile !== "mod" && o.profile !== "generic") {
    issues.push(issue("FIELD_INVALID", "profile must be web|mod|generic.", `${path}.profile`));
  }

  if (!isRecord(o.input)) {
    issues.push(issue("FIELD_INVALID", "input must be an object.", `${path}.input`));
  } else {
    const input = o.input as any;
    if (input.kind !== "file" && input.kind !== "dir" && input.kind !== "zip") {
      issues.push(issue("FIELD_INVALID", "input.kind must be file|dir|zip.", `${path}.input.kind`));
    }
    if (!isBoundedTightString(input.rootDigest, MAX_MINT_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "rootDigest must be a bounded string.", `${path}.input.rootDigest`));
    }
    if (!Number.isFinite(input.fileCount) || input.fileCount < 0) {
      issues.push(issue("FIELD_INVALID", "fileCount must be a number >= 0.", `${path}.input.fileCount`));
    }
    if (!Number.isFinite(input.totalBytes) || input.totalBytes < 0) {
      issues.push(issue("FIELD_INVALID", "totalBytes must be a number >= 0.", `${path}.input.totalBytes`));
    }
  }

  if (o.capture !== undefined) {
    if (!isRecord(o.capture)) {
      issues.push(issue("FIELD_INVALID", "capture must be an object.", `${path}.capture`));
    } else {
      const capture = o.capture as any;
      if (!isBoundedTightString(capture.captureDigest, MAX_MINT_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "captureDigest must be a bounded string.", `${path}.capture.captureDigest`));
      }
      if (capture.paths !== undefined) {
        const paths = asStringArray(capture.paths);
        if (!paths) {
          issues.push(issue("FIELD_INVALID", "paths must be string[].", `${path}.capture.paths`));
        } else {
          if (paths.length > MAX_MINT_PATHS) {
            issues.push(
              issue("FIELD_INVALID", `paths must not exceed ${MAX_MINT_PATHS} entries.`, `${path}.capture.paths`)
            );
          }
          if (!isSortedUniqueStrings(paths)) {
            issues.push(issue("FIELD_INVALID", "paths must be stable-sorted and unique.", `${path}.capture.paths`));
          }
            paths.forEach((p, i) => {
              if (!isBoundedString(p, MAX_MINT_STRING_BYTES)) {
                issues.push(issue("FIELD_INVALID", "path must be a bounded string.", `${path}.capture.paths[${i}]`));
              } else if (containsSensitiveMarker(p) || /\\/.test(p)) {
                issues.push(
                  issue(
                    "FIELD_INVALID",
                    "path must not contain sensitive markers or backslashes.",
                    `${path}.capture.paths[${i}]`
                  )
                );
              }
            });
        }
      }
    }
  }

  if (!isRecord(o.observations)) {
    issues.push(issue("FIELD_INVALID", "observations must be an object.", `${path}.observations`));
  } else {
    const obs = o.observations as any;
    if (!isRecord(obs.fileKinds)) {
      issues.push(issue("FIELD_INVALID", "fileKinds must be an object.", `${path}.observations.fileKinds`));
    } else {
      for (const key of ["html", "js", "css", "json", "wasm", "media", "binary", "other"]) {
        const value = (obs.fileKinds as any)[key];
        if (!Number.isFinite(value) || value < 0) {
          issues.push(
            issue("FIELD_INVALID", `${key} must be a number >= 0.`, `${path}.observations.fileKinds.${key}`)
          );
        }
      }
    }
    const refs = asStringArray(obs.externalRefs ?? []);
    if (!refs) {
      issues.push(issue("FIELD_INVALID", "externalRefs must be string[].", `${path}.observations.externalRefs`));
    } else {
      if (refs.length > MAX_MINT_EXTERNAL_REFS) {
        issues.push(
          issue(
            "FIELD_INVALID",
            `externalRefs must not exceed ${MAX_MINT_EXTERNAL_REFS} entries.`,
            `${path}.observations.externalRefs`
          )
        );
      }
      if (!isSortedUniqueStrings(refs)) {
        issues.push(
          issue(
            "FIELD_INVALID",
            "externalRefs must be stable-sorted and unique.",
            `${path}.observations.externalRefs`
          )
        );
      }
      refs.forEach((r, i) => {
        if (!isBoundedTightString(r, MAX_MINT_STRING_BYTES)) {
          issues.push(issue("FIELD_INVALID", "externalRef must be a bounded string.", `${path}.observations.externalRefs[${i}]`));
        }
      });
    }
    if (!isBoolean(obs.scriptsDetected)) {
      issues.push(issue("FIELD_INVALID", "scriptsDetected must be boolean.", `${path}.observations.scriptsDetected`));
    }
    if (!isBoolean(obs.wasmDetected)) {
      issues.push(issue("FIELD_INVALID", "wasmDetected must be boolean.", `${path}.observations.wasmDetected`));
    }
  }

  if (!isRecord(o.executionProbes)) {
    issues.push(issue("FIELD_INVALID", "executionProbes must be an object.", `${path}.executionProbes`));
  } else {
    const probes = o.executionProbes as any;
    if (!isBoolean(probes.strictAvailable)) {
      issues.push(
        issue("FIELD_INVALID", "strictAvailable must be boolean.", `${path}.executionProbes.strictAvailable`)
      );
    }
    if (probes.strictUnavailableReason !== undefined) {
      if (!isBoundedTightString(probes.strictUnavailableReason, MAX_MINT_STRING_BYTES)) {
        issues.push(
          issue(
            "FIELD_INVALID",
            "strictUnavailableReason must be a bounded string when present.",
            `${path}.executionProbes.strictUnavailableReason`
          )
        );
      }
    }
    issues.push(...validateMintProbeV1(probes.loadOnly, `${path}.executionProbes.loadOnly`));
    if (probes.interactionScript !== undefined) {
      issues.push(
        ...validateMintProbeV1(probes.interactionScript, `${path}.executionProbes.interactionScript`)
      );
    }
  }

  if (!isRecord(o.grade)) {
    issues.push(issue("FIELD_INVALID", "grade must be an object.", `${path}.grade`));
  } else {
    const grade = o.grade as any;
    if (!isMintStatus(grade.status)) {
      issues.push(issue("FIELD_INVALID", "status must be OK|WARN|DENY|QUARANTINE.", `${path}.grade.status`));
    }
    const reasonCodes = asStringArray(grade.reasonCodes ?? []);
    if (!reasonCodes) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.grade.reasonCodes`));
    } else {
      if (reasonCodes.length > MAX_MINT_REASON_CODES) {
        issues.push(
          issue(
            "FIELD_INVALID",
            `reasonCodes must not exceed ${MAX_MINT_REASON_CODES} entries.`,
            `${path}.grade.reasonCodes`
          )
        );
      }
      if (!isSortedUniqueStrings(reasonCodes)) {
        issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.grade.reasonCodes`));
      }
    }
    if (!isArray(grade.receipts)) {
      issues.push(issue("FIELD_INVALID", "receipts must be an array.", `${path}.grade.receipts`));
    } else {
      if (grade.receipts.length > MAX_MINT_RECEIPTS) {
        issues.push(
          issue("FIELD_INVALID", `receipts must not exceed ${MAX_MINT_RECEIPTS} entries.`, `${path}.grade.receipts`)
        );
      }
      grade.receipts.forEach((entry: unknown, i: number) => {
        const entryPath = `${path}.grade.receipts[${i}]`;
        if (!isRecord(entry)) {
          issues.push(issue("FIELD_INVALID", "receipt must be an object.", entryPath));
          return;
        }
        if (!hasOnlyKeys(entry as any, ["kind", "digest", "summaryCounts", "reasonCodes"])) {
          issues.push(issue("FIELD_INVALID", "receipt contains disallowed fields.", entryPath));
        }
        if (!isBoundedTightString((entry as any).kind, MAX_MINT_STRING_BYTES)) {
          issues.push(issue("FIELD_INVALID", "kind must be a bounded string.", `${entryPath}.kind`));
        }
        if (!isBoundedTightString((entry as any).digest, MAX_MINT_STRING_BYTES)) {
          issues.push(issue("FIELD_INVALID", "digest must be a bounded string.", `${entryPath}.digest`));
        }
        if ((entry as any).summaryCounts !== undefined && !isRecord((entry as any).summaryCounts)) {
          issues.push(issue("FIELD_INVALID", "summaryCounts must be an object.", `${entryPath}.summaryCounts`));
        }
        if ((entry as any).reasonCodes !== undefined) {
          const codes = asStringArray((entry as any).reasonCodes);
          if (!codes) {
            issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${entryPath}.reasonCodes`));
          } else if (!isSortedUniqueStrings(codes)) {
            issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${entryPath}.reasonCodes`));
          }
        }
      });
    }
    if (grade.scars !== undefined) {
      const scars = asStringArray(grade.scars);
      if (!scars) {
        issues.push(issue("FIELD_INVALID", "scars must be string[].", `${path}.grade.scars`));
      } else {
        if (!isSortedUniqueStrings(scars)) {
          issues.push(issue("FIELD_INVALID", "scars must be stable-sorted and unique.", `${path}.grade.scars`));
        }
      }
    }
  }

  if (!isRecord(o.digests)) {
    issues.push(issue("FIELD_INVALID", "digests must be an object.", `${path}.digests`));
  } else {
    const digests = o.digests as any;
    if (!isBoundedTightString(digests.mintDigest, MAX_MINT_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "mintDigest must be a bounded string.", `${path}.digests.mintDigest`));
    }
    if (!isBoundedTightString(digests.inputDigest, MAX_MINT_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "inputDigest must be a bounded string.", `${path}.digests.inputDigest`));
    }
    if (!isBoundedTightString(digests.policyDigest, MAX_MINT_STRING_BYTES)) {
      issues.push(issue("FIELD_INVALID", "policyDigest must be a bounded string.", `${path}.digests.policyDigest`));
    }
    if (isRecord(o.input) && isBoundedTightString((o.input as any).rootDigest, MAX_MINT_STRING_BYTES)) {
      if (digests.inputDigest !== (o.input as any).rootDigest) {
        issues.push(issue("FIELD_INVALID", "inputDigest must equal input.rootDigest.", `${path}.digests.inputDigest`));
      }
    }
  }

  if (!isRecord(o.limits)) {
    issues.push(issue("FIELD_INVALID", "limits must be an object.", `${path}.limits`));
  } else {
    const limits = o.limits as any;
    const fields = [
      "maxFiles",
      "maxTotalBytes",
      "maxFileBytes",
      "maxExternalRefs",
      "maxScriptBytes",
      "maxScriptSteps",
    ];
    for (const field of fields) {
      if (!Number.isFinite(limits[field]) || limits[field] <= 0) {
        issues.push(issue("FIELD_INVALID", `${field} must be a number > 0.`, `${path}.limits.${field}`));
      }
    }
  }

  const canonical = safeCanonicalJSON(v);
  if (canonical && utf8ByteLength(canonical) > MAX_MINT_JSON_BYTES) {
    issues.push(
      issue("FIELD_INVALID", `Mint package must not exceed ${MAX_MINT_JSON_BYTES} bytes.`, `${path}`)
    );
  }

  if (issues.length === 0) {
    const expected = computeMintDigestV1(o as WeftendMintPackageV1);
    if ((o as WeftendMintPackageV1).digests.mintDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "mintDigest must match canonical digest.", `${path}.digests.mintDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export const privacyValidateCoreTruthV0 = (input: unknown, path: string = "core"): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const seen = new Set<unknown>();

  const escapePointer = (token: string): string => token.replace(/~/g, "~0").replace(/\//g, "~1");
  const normalizeRoot = (base: string): string => {
    if (!base) return "";
    if (base.startsWith("/")) return base;
    return `/${escapePointer(base)}`;
  };
  const joinPointer = (base: string, token: string): string => {
    const safe = escapePointer(token);
    return base === "" ? `/${safe}` : `${base}/${safe}`;
  };

  const scan = (value: unknown, cursor: string): void => {
    if (value === null || value === undefined) return;
    if (isString(value)) {
      if (isForbiddenValue(value)) {
        issues.push(issue("PRIVACY_FIELD_FORBIDDEN", "Forbidden value detected.", cursor));
      }
      if (isUntrustedString(value)) {
        issues.push(issue("PRIVACY_STRING_UNTRUSTED", "Untrusted string detected.", cursor));
      }
      return;
    }
    if (!isRecord(value) && !isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (isArray(value)) {
      value.forEach((item, i) => scan(item, joinPointer(cursor, String(i))));
      return;
    }

    const record = value as Record<string, unknown>;

    const receiptBody = isRecord((record as any).body) ? (record as any).body : null;
    if (receiptBody && (receiptBody as any).schema === "weftend.gateReceipt/0") {
      checkGateReceipt(record, cursor, issues);
    }
    if ((record as any).schema === "weftend.recoveryPlan/0") {
      checkRecoveryPlan(record, cursor, issues);
    }
    if ((record as any).schema === "weftend.recoveryReceipt/0") {
      checkRecoveryReceipt(record, cursor, issues);
    }
    if ((record as any).receiptSummary !== undefined) {
      checkReceiptSummary((record as any).receiptSummary, joinPointer(cursor, "receiptSummary"), issues);
    }

    Object.keys(record).forEach((childKey) => {
      const nextPath = joinPointer(cursor, childKey);
      if (isForbiddenKey(childKey)) {
        issues.push(issue("PRIVACY_FIELD_FORBIDDEN", "Forbidden field detected.", nextPath));
      }
      if (isTimeKey(childKey)) {
        issues.push(issue("PRIVACY_TIMESTAMP_FORBIDDEN", "Timestamp fields are forbidden.", nextPath));
      }
      const child = record[childKey];
      scan(child, nextPath);
    });
  };

  scan(input, normalizeRoot(path));
  return sortIssuesDeterministically(issues);
};

export const computeGateReceiptIdV0 = (body: GateReceiptV0["body"]): string =>
  `sha256:${sha256(canonicalJSON(body))}`;

export const computeRunReceiptDigestV0 = (receipt: RunReceiptV0): string => {
  const payload = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export const computeHostRunReceiptDigestV0 = (receipt: HostRunReceiptV0): string => {
  const payload: any = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  if (Array.isArray(payload.artifactsWritten)) {
    payload.artifactsWritten = payload.artifactsWritten.map((entry: any) => {
      if (entry && entry.name === "host_run_receipt.json") {
        return { ...entry, digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
      }
      return entry;
    });
  }
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export const computeHostStatusReceiptDigestV0 = (receipt: HostStatusReceiptV0): string => {
  const payload: any = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  if (payload.signature) {
    delete payload.signature;
  }
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export const computeSafeRunReceiptDigestV0 = (receipt: SafeRunReceiptV0): string => {
  const payload = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export const computeOperatorReceiptDigestV0 = (receipt: OperatorReceiptV0): string => {
  const payload = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export const computeCompareReceiptDigestV0 = (receipt: CompareReceiptV0): string => {
  const payload = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export const computeHostSelfIdV0 = (body: HostSelfManifestV0["body"]): string =>
  `sha256:${sha256(canonicalJSON(body))}`;

export const computeHostUpdateReceiptDigestV0 = (receipt: HostUpdateReceiptV0): string => {
  const payload: any = { ...receipt, receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
  if (Array.isArray(payload.artifactsWritten)) {
    payload.artifactsWritten = payload.artifactsWritten.map((entry: any) => {
      if (entry && entry.name === "host_update_receipt.json") {
        return { ...entry, digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
      }
      return entry;
    });
  }
  return `sha256:${sha256(canonicalJSON(payload))}`;
};

export function validateRunReceiptV0(v: unknown, path: string = "runReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "RunReceiptV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "schemaVersion",
    "weftendBuild",
    "modeRequested",
    "modeEffective",
    "profile",
    "inputDigest",
    "contentSummary",
    "policyId",
    "mintDigest",
    "intakeDecisionDigest",
    "intakeAction",
    "intakeGrade",
    "envGates",
    "strictVerify",
    "strictExecute",
    "artifactsWritten",
    "execution",
    "receiptDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "RunReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.runReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.runReceipt/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must equal 0.", `${path}.v`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));

  if (o.modeRequested !== "strict" && o.modeRequested !== "compatible" && o.modeRequested !== "legacy") {
    issues.push(issue("ENUM_INVALID", "modeRequested must be strict|compatible|legacy.", `${path}.modeRequested`));
  }
  if (o.modeEffective !== "strict" && o.modeEffective !== "compatible" && o.modeEffective !== "legacy") {
    issues.push(issue("ENUM_INVALID", "modeEffective must be strict|compatible|legacy.", `${path}.modeEffective`));
  }
  if (o.profile !== "web" && o.profile !== "mod" && o.profile !== "generic") {
    issues.push(issue("ENUM_INVALID", "profile must be web|mod|generic.", `${path}.profile`));
  }

  const requireTight = (field: string, fieldPath: string) => {
    if (!isTightString(field)) {
      issues.push(issue("FIELD_INVALID", "must be a non-empty string without whitespace.", fieldPath));
    }
  };

  requireTight(o.inputDigest, `${path}.inputDigest`);
  issues.push(...validateContentSummaryV0(o.contentSummary, `${path}.contentSummary`));
  requireTight(o.policyId, `${path}.policyId`);
  requireTight(o.mintDigest, `${path}.mintDigest`);
  requireTight(o.intakeDecisionDigest, `${path}.intakeDecisionDigest`);

  if (!isIntakeActionV1(o.intakeAction)) {
    issues.push(issue("ENUM_INVALID", "intakeAction must be APPROVE|QUEUE|REJECT|HOLD.", `${path}.intakeAction`));
  }
  if (o.intakeGrade !== "OK" && o.intakeGrade !== "WARN" && o.intakeGrade !== "DENY" && o.intakeGrade !== "QUARANTINE") {
    issues.push(issue("ENUM_INVALID", "intakeGrade must be OK|WARN|DENY|QUARANTINE.", `${path}.intakeGrade`));
  }

  if (!isRecord(o.envGates)) {
    issues.push(issue("FIELD_INVALID", "envGates must be an object.", `${path}.envGates`));
  } else {
    if (!isBoolean(o.envGates.strictExecAllowed)) {
      issues.push(issue("FIELD_INVALID", "envGates.strictExecAllowed must be boolean.", `${path}.envGates.strictExecAllowed`));
    }
    if (!isBoolean(o.envGates.demoCryptoAllowed)) {
      issues.push(issue("FIELD_INVALID", "envGates.demoCryptoAllowed must be boolean.", `${path}.envGates.demoCryptoAllowed`));
    }
  }

  if (!isRecord(o.strictVerify)) {
    issues.push(issue("FIELD_INVALID", "strictVerify must be an object.", `${path}.strictVerify`));
  } else {
    if (!isStrictVerifyVerdictV0(o.strictVerify.verdict)) {
      issues.push(issue("ENUM_INVALID", "strictVerify.verdict must be ALLOW|DENY|QUARANTINE.", `${path}.strictVerify.verdict`));
    }
    const reasons = asStringArray(o.strictVerify.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "strictVerify.reasonCodes must be string[].", `${path}.strictVerify.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "strictVerify.reasonCodes must be stable-sorted and unique.", `${path}.strictVerify.reasonCodes`));
    }
    if (o.strictVerify.releaseStatus !== "OK" && o.strictVerify.releaseStatus !== "UNVERIFIED" && o.strictVerify.releaseStatus !== "MAYBE") {
      issues.push(issue("ENUM_INVALID", "strictVerify.releaseStatus must be OK|UNVERIFIED|MAYBE.", `${path}.strictVerify.releaseStatus`));
    }
    const releaseReasons = asStringArray(o.strictVerify.releaseReasonCodes);
    if (!releaseReasons) {
      issues.push(issue("FIELD_INVALID", "strictVerify.releaseReasonCodes must be string[].", `${path}.strictVerify.releaseReasonCodes`));
    } else if (!isSortedUniqueStrings(releaseReasons)) {
      issues.push(issue("FIELD_INVALID", "strictVerify.releaseReasonCodes must be stable-sorted and unique.", `${path}.strictVerify.releaseReasonCodes`));
    }
    if (o.strictVerify.releaseId !== undefined && !isTightString(o.strictVerify.releaseId)) {
      issues.push(issue("FIELD_INVALID", "strictVerify.releaseId must be a non-empty string when present.", `${path}.strictVerify.releaseId`));
    }
  }

  if (!isRecord(o.strictExecute)) {
    issues.push(issue("FIELD_INVALID", "strictExecute must be an object.", `${path}.strictExecute`));
  } else {
    if (!isBoolean(o.strictExecute.attempted)) {
      issues.push(issue("FIELD_INVALID", "strictExecute.attempted must be boolean.", `${path}.strictExecute.attempted`));
    }
    if (!isStrictExecuteOutcomeV0(o.strictExecute.result)) {
      issues.push(issue("ENUM_INVALID", "strictExecute.result must be ALLOW|DENY|SKIP.", `${path}.strictExecute.result`));
    }
    const reasons = asStringArray(o.strictExecute.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "strictExecute.reasonCodes must be string[].", `${path}.strictExecute.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "strictExecute.reasonCodes must be stable-sorted and unique.", `${path}.strictExecute.reasonCodes`));
    }
  }

  if (!isArray(o.artifactsWritten)) {
    issues.push(issue("FIELD_INVALID", "artifactsWritten must be an array.", `${path}.artifactsWritten`));
  } else {
    const items: Array<{ name: string; digest: string }> = [];
    o.artifactsWritten.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "artifactsWritten entry must be an object.", `${path}.artifactsWritten[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isTightString(entry.name)) {
        issues.push(issue("FIELD_INVALID", "name must be a non-empty string.", `${path}.artifactsWritten[${i}].name`));
      }
      if (!isTightString(entry.digest)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.artifactsWritten[${i}].digest`));
      }
      items.push({ name: entry.name, digest: entry.digest });
      if (!hasOnlyKeys(entry, ["name", "digest"])) {
        issues.push(issue("FIELD_INVALID", "artifactsWritten entry contains disallowed fields.", `${path}.artifactsWritten[${i}]`));
      }
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => {
        const c0 = cmpStr(a.name, b.name);
        if (c0 !== 0) return c0;
        return cmpStr(a.digest, b.digest);
      });
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].name !== sorted[i].name || items[i].digest !== sorted[i].digest) {
          issues.push(issue("FIELD_INVALID", "artifactsWritten must be stable-sorted by name then digest.", `${path}.artifactsWritten`));
          break;
        }
      }
    }
  }

  if (!isRecord(o.execution)) {
    issues.push(issue("FIELD_INVALID", "execution must be an object.", `${path}.execution`));
  } else {
    if (!isRunExecutionStatusV0(o.execution.status)) {
      issues.push(issue("ENUM_INVALID", "execution.status must be ALLOW|DENY|QUARANTINE|SKIP.", `${path}.execution.status`));
    }
    const reasons = asStringArray(o.execution.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "execution.reasonCodes must be string[].", `${path}.execution.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "execution.reasonCodes must be stable-sorted and unique.", `${path}.execution.reasonCodes`));
    }
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeRunReceiptDigestV0(o as RunReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateHostStatusReceiptV0(v: unknown, path: string = "hostStatusReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "HostStatusReceiptV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "schemaVersion",
    "weftendBuild",
    "hostBinaryDigest",
    "hostConfigDigest",
    "enforcementVersion",
    "outRootEffective",
    "outRootSource",
    "verifyResult",
    "reasonCodes",
    "timestampMs",
    "receiptDigest",
    "signature",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "HostStatusReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.host.statusReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.host.statusReceipt/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must equal 0.", `${path}.v`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));
  if (!isTightString(o.hostBinaryDigest)) {
    issues.push(issue("FIELD_INVALID", "hostBinaryDigest must be a non-empty string.", `${path}.hostBinaryDigest`));
  }
  if (!isTightString(o.hostConfigDigest)) {
    issues.push(issue("FIELD_INVALID", "hostConfigDigest must be a non-empty string.", `${path}.hostConfigDigest`));
  }
  if (!isTightString(o.enforcementVersion)) {
    issues.push(issue("FIELD_INVALID", "enforcementVersion must be a non-empty string.", `${path}.enforcementVersion`));
  }
  if (!isString(o.outRootEffective) || o.outRootEffective.length === 0) {
    issues.push(issue("FIELD_INVALID", "outRootEffective must be a non-empty string.", `${path}.outRootEffective`));
  } else if (utf8ByteLength(o.outRootEffective) > MAX_HOST_PATH_BYTES) {
    issues.push(
      issue(
        "FIELD_INVALID",
        `outRootEffective exceeds max size ${MAX_HOST_PATH_BYTES} bytes.`,
        `${path}.outRootEffective`
      )
    );
  } else if (looksLikeAbsPath(o.outRootEffective)) {
    issues.push(issue("FIELD_INVALID", "outRootEffective must be relative (no absolute paths).", `${path}.outRootEffective`));
  }
  if (!isHostOutRootSourceV0(o.outRootSource)) {
    issues.push(issue("ENUM_INVALID", "outRootSource must be ARG_OUT|ENV_OUT_ROOT.", `${path}.outRootSource`));
  }
  if (!isHostStatusResultV0(o.verifyResult)) {
    issues.push(issue("ENUM_INVALID", "verifyResult must be OK|UNVERIFIED.", `${path}.verifyResult`));
  }

  const reasons = asStringArray(o.reasonCodes);
  if (!reasons) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
  } else if (!isSortedUniqueStrings(reasons)) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
  }

  if (!isNumber(o.timestampMs) || !Number.isInteger(o.timestampMs) || o.timestampMs < 0) {
    issues.push(issue("FIELD_INVALID", "timestampMs must be a non-negative integer.", `${path}.timestampMs`));
  }

  if (o.signature !== undefined) {
    issues.push(...validateSignature(o.signature, `${path}.signature`));
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeHostStatusReceiptDigestV0(o as HostStatusReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateHostRunReceiptV0(v: unknown, path: string = "hostRunReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "HostRunReceiptV0 must be an object.", path)];

  const allowed = [
    "version",
    "schemaVersion",
    "weftendBuild",
    "gateModeRequested",
    "gateVerdict",
    "gateReasonCodes",
    "releaseDirDigest",
    "contentSummary",
    "releaseId",
    "hostSelfId",
    "hostSelfStatus",
    "hostSelfReasonCodes",
    "releaseStatus",
    "releaseReasonCodes",
    "verify",
    "execute",
    "entryUsed",
    "caps",
    "artifactDigests",
    "artifactsWritten",
    "receiptDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "HostRunReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.version !== "host_run_receipt_v0") {
    issues.push(issue("FIELD_INVALID", "version must be host_run_receipt_v0.", `${path}.version`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));
  if (o.gateModeRequested !== undefined && o.gateModeRequested !== "enforced") {
    issues.push(issue("ENUM_INVALID", "gateModeRequested must be enforced when present.", `${path}.gateModeRequested`));
  }
  if ((o.gateVerdict !== undefined || o.gateReasonCodes !== undefined) && o.gateModeRequested === undefined) {
    issues.push(issue("FIELD_INVALID", "gateModeRequested is required when gate fields are present.", `${path}.gateModeRequested`));
  }
  if (o.gateVerdict !== undefined && o.gateVerdict !== "ALLOW" && o.gateVerdict !== "BLOCK") {
    issues.push(issue("ENUM_INVALID", "gateVerdict must be ALLOW|BLOCK when present.", `${path}.gateVerdict`));
  }
  if (o.gateReasonCodes !== undefined) {
    const gateReasons = asStringArray(o.gateReasonCodes);
    if (!gateReasons) {
      issues.push(issue("FIELD_INVALID", "gateReasonCodes must be string[].", `${path}.gateReasonCodes`));
    } else if (!isSortedUniqueStrings(gateReasons)) {
      issues.push(issue("FIELD_INVALID", "gateReasonCodes must be stable-sorted and unique.", `${path}.gateReasonCodes`));
    }
  }
  issues.push(...validateContentSummaryV0(o.contentSummary, `${path}.contentSummary`));
  if (!isTightString(o.releaseDirDigest)) {
    issues.push(issue("FIELD_INVALID", "releaseDirDigest must be a non-empty string.", `${path}.releaseDirDigest`));
  }
  if (o.releaseId !== undefined && !isTightString(o.releaseId)) {
    issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string when present.", `${path}.releaseId`));
  }
  if (o.hostSelfId !== undefined && !isTightString(o.hostSelfId)) {
    issues.push(issue("FIELD_INVALID", "hostSelfId must be a non-empty string when present.", `${path}.hostSelfId`));
  }
  if (o.hostSelfStatus !== "OK" && o.hostSelfStatus !== "UNVERIFIED" && o.hostSelfStatus !== "MISSING") {
    issues.push(issue("ENUM_INVALID", "hostSelfStatus must be OK|UNVERIFIED|MISSING.", `${path}.hostSelfStatus`));
  }
  const hostSelfReasons = asStringArray(o.hostSelfReasonCodes);
  if (!hostSelfReasons) {
    issues.push(issue("FIELD_INVALID", "hostSelfReasonCodes must be string[].", `${path}.hostSelfReasonCodes`));
  } else if (!isSortedUniqueStrings(hostSelfReasons)) {
    issues.push(issue("FIELD_INVALID", "hostSelfReasonCodes must be stable-sorted and unique.", `${path}.hostSelfReasonCodes`));
  }
  if (o.releaseStatus !== "OK" && o.releaseStatus !== "UNVERIFIED" && o.releaseStatus !== "MAYBE") {
    issues.push(issue("ENUM_INVALID", "releaseStatus must be OK|UNVERIFIED|MAYBE.", `${path}.releaseStatus`));
  }
  const releaseReasons = asStringArray(o.releaseReasonCodes);
  if (!releaseReasons) {
    issues.push(issue("FIELD_INVALID", "releaseReasonCodes must be string[].", `${path}.releaseReasonCodes`));
  } else if (!isSortedUniqueStrings(releaseReasons)) {
    issues.push(issue("FIELD_INVALID", "releaseReasonCodes must be stable-sorted and unique.", `${path}.releaseReasonCodes`));
  }

  if (!isRecord(o.verify)) {
    issues.push(issue("FIELD_INVALID", "verify must be an object.", `${path}.verify`));
  } else {
    if (!isHostVerifyVerdictV0(o.verify.verdict)) {
      issues.push(issue("ENUM_INVALID", "verify.verdict must be ALLOW|DENY.", `${path}.verify.verdict`));
    }
    const reasons = asStringArray(o.verify.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "verify.reasonCodes must be string[].", `${path}.verify.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "verify.reasonCodes must be stable-sorted and unique.", `${path}.verify.reasonCodes`));
    }
  }

  if (!isRecord(o.execute)) {
    issues.push(issue("FIELD_INVALID", "execute must be an object.", `${path}.execute`));
  } else {
    if (!isBoolean(o.execute.attempted)) {
      issues.push(issue("FIELD_INVALID", "execute.attempted must be boolean.", `${path}.execute.attempted`));
    }
    if (!isHostExecuteOutcomeV0(o.execute.result)) {
      issues.push(issue("ENUM_INVALID", "execute.result must be ALLOW|DENY|SKIP.", `${path}.execute.result`));
    }
    const reasons = asStringArray(o.execute.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "execute.reasonCodes must be string[].", `${path}.execute.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "execute.reasonCodes must be stable-sorted and unique.", `${path}.execute.reasonCodes`));
    }
    if (o.execute.executionOk !== undefined && !isBoolean(o.execute.executionOk)) {
      issues.push(issue("FIELD_INVALID", "execute.executionOk must be boolean when present.", `${path}.execute.executionOk`));
    }
  }

  if (!isTightString(o.entryUsed)) {
    issues.push(issue("FIELD_INVALID", "entryUsed must be a non-empty string.", `${path}.entryUsed`));
  }

  if (!isRecord(o.caps)) {
    issues.push(issue("FIELD_INVALID", "caps must be an object.", `${path}.caps`));
  } else {
    const requested = asStringArray(o.caps.requested);
    const granted = asStringArray(o.caps.granted);
    const denied = asStringArray(o.caps.denied);
    if (!requested || !isSortedUniqueStrings(requested)) {
      issues.push(issue("FIELD_INVALID", "caps.requested must be stable-sorted string[].", `${path}.caps.requested`));
    }
    if (!granted || !isSortedUniqueStrings(granted)) {
      issues.push(issue("FIELD_INVALID", "caps.granted must be stable-sorted string[].", `${path}.caps.granted`));
    }
    if (!denied || !isSortedUniqueStrings(denied)) {
      issues.push(issue("FIELD_INVALID", "caps.denied must be stable-sorted string[].", `${path}.caps.denied`));
    }
  }

  if (!isRecord(o.artifactDigests)) {
    issues.push(issue("FIELD_INVALID", "artifactDigests must be an object.", `${path}.artifactDigests`));
  } else {
    const allowedDigests = ["releaseManifest", "runtimeBundle", "evidenceBundle", "publicKey"];
    if (!hasOnlyKeys(o.artifactDigests, allowedDigests)) {
      issues.push(issue("FIELD_INVALID", "artifactDigests contains disallowed fields.", `${path}.artifactDigests`));
    }
    allowedDigests.forEach((key) => {
      if (!isTightString(o.artifactDigests[key])) {
        issues.push(issue("FIELD_INVALID", `${key} must be a non-empty string.`, `${path}.artifactDigests.${key}`));
      }
    });
  }

  if (!isArray(o.artifactsWritten)) {
    issues.push(issue("FIELD_INVALID", "artifactsWritten must be an array.", `${path}.artifactsWritten`));
  } else {
    const items: Array<{ name: string; digest: string }> = [];
    o.artifactsWritten.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "artifactsWritten entry must be an object.", `${path}.artifactsWritten[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isTightString(entry.name)) {
        issues.push(issue("FIELD_INVALID", "name must be a non-empty string.", `${path}.artifactsWritten[${i}].name`));
      }
      if (!isTightString(entry.digest)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.artifactsWritten[${i}].digest`));
      }
      items.push({ name: entry.name, digest: entry.digest });
      if (!hasOnlyKeys(entry, ["name", "digest"])) {
        issues.push(issue("FIELD_INVALID", "artifactsWritten entry contains disallowed fields.", `${path}.artifactsWritten[${i}]`));
      }
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => {
        const c0 = cmpStr(a.name, b.name);
        if (c0 !== 0) return c0;
        return cmpStr(a.digest, b.digest);
      });
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].name !== sorted[i].name || items[i].digest !== sorted[i].digest) {
          issues.push(issue("FIELD_INVALID", "artifactsWritten must be stable-sorted by name then digest.", `${path}.artifactsWritten`));
          break;
        }
      }
    }
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeHostRunReceiptDigestV0(o as HostRunReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateSafeRunReceiptV0(v: unknown, path: string = "safeRunReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "SafeRunReceiptV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "schemaVersion",
    "weftendBuild",
    "inputKind",
    "artifactKind",
    "entryHint",
    "analysisVerdict",
    "executionVerdict",
    "topReasonCode",
    "inputDigest",
    "releaseId",
    "releaseDirDigest",
    "policyId",
    "intakeDecisionDigest",
    "hostReceiptDigest",
    "hostSelfId",
    "hostSelfStatus",
    "hostSelfReasonCodes",
    "execution",
    "contentSummary",
    "subReceipts",
    "receiptDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "SafeRunReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.safeRunReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.safeRunReceipt/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must equal 0.", `${path}.v`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));
  if (o.inputKind !== "raw" && o.inputKind !== "release") {
    issues.push(issue("ENUM_INVALID", "inputKind must be raw|release.", `${path}.inputKind`));
  }
  if (!isArtifactKindV0(o.artifactKind)) {
    issues.push(issue("ENUM_INVALID", "artifactKind must be a known ArtifactKindV0.", `${path}.artifactKind`));
  }
  if (o.entryHint !== undefined && o.entryHint !== null && !isTightString(o.entryHint)) {
    issues.push(issue("FIELD_INVALID", "entryHint must be a non-empty string|null when present.", `${path}.entryHint`));
  } else if (isTightString(o.entryHint) && (String(o.entryHint).includes("/") || String(o.entryHint).includes("\\"))) {
    issues.push(issue("FIELD_INVALID", "entryHint must be a filename only (no path separators).", `${path}.entryHint`));
  }
  if (!isSafeRunAnalysisVerdictV0(o.analysisVerdict)) {
    issues.push(issue("ENUM_INVALID", "analysisVerdict must be ALLOW|WITHHELD|DENY.", `${path}.analysisVerdict`));
  }
  if (!isSafeRunExecutionVerdictV0(o.executionVerdict)) {
    issues.push(issue("ENUM_INVALID", "executionVerdict must be NOT_ATTEMPTED|SKIP|ALLOW|DENY.", `${path}.executionVerdict`));
  }
  if (!isTightString(o.topReasonCode)) {
    issues.push(issue("FIELD_INVALID", "topReasonCode must be a non-empty string.", `${path}.topReasonCode`));
  }
  if (o.inputKind === "raw" && !isTightString(o.inputDigest)) {
    issues.push(issue("FIELD_INVALID", "inputDigest must be present for raw inputs.", `${path}.inputDigest`));
  }
  if (o.inputKind === "release" && !isTightString(o.releaseDirDigest)) {
    issues.push(issue("FIELD_INVALID", "releaseDirDigest must be present for release inputs.", `${path}.releaseDirDigest`));
  }
  if (o.inputDigest !== undefined && !isTightString(o.inputDigest)) {
    issues.push(issue("FIELD_INVALID", "inputDigest must be a non-empty string when present.", `${path}.inputDigest`));
  }
  if (o.releaseId !== undefined && !isTightString(o.releaseId)) {
    issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string when present.", `${path}.releaseId`));
  }
  if (o.releaseDirDigest !== undefined && !isTightString(o.releaseDirDigest)) {
    issues.push(issue("FIELD_INVALID", "releaseDirDigest must be a non-empty string when present.", `${path}.releaseDirDigest`));
  }
  if (!isTightString(o.policyId)) {
    issues.push(issue("FIELD_INVALID", "policyId must be a non-empty string.", `${path}.policyId`));
  }
  if (o.intakeDecisionDigest !== undefined && !isTightString(o.intakeDecisionDigest)) {
    issues.push(issue("FIELD_INVALID", "intakeDecisionDigest must be a non-empty string when present.", `${path}.intakeDecisionDigest`));
  }
  if (o.hostReceiptDigest !== undefined && !isTightString(o.hostReceiptDigest)) {
    issues.push(issue("FIELD_INVALID", "hostReceiptDigest must be a non-empty string when present.", `${path}.hostReceiptDigest`));
  }
  if (o.hostSelfId !== undefined && !isTightString(o.hostSelfId)) {
    issues.push(issue("FIELD_INVALID", "hostSelfId must be a non-empty string when present.", `${path}.hostSelfId`));
  }
  if (o.hostSelfStatus !== undefined && o.hostSelfStatus !== "OK" && o.hostSelfStatus !== "UNVERIFIED" && o.hostSelfStatus !== "MISSING") {
    issues.push(issue("ENUM_INVALID", "hostSelfStatus must be OK|UNVERIFIED|MISSING when present.", `${path}.hostSelfStatus`));
  }
  if (o.hostSelfReasonCodes !== undefined) {
    const reasons = asStringArray(o.hostSelfReasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "hostSelfReasonCodes must be string[] when present.", `${path}.hostSelfReasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "hostSelfReasonCodes must be stable-sorted and unique.", `${path}.hostSelfReasonCodes`));
    }
  }

  issues.push(...validateContentSummaryV0(o.contentSummary, `${path}.contentSummary`));

  if (!isRecord(o.execution)) {
    issues.push(issue("FIELD_INVALID", "execution must be an object.", `${path}.execution`));
  } else {
    if (!isSafeRunExecutionResultV0(o.execution.result)) {
      issues.push(issue("ENUM_INVALID", "execution.result must be ALLOW|DENY|SKIP|WITHHELD.", `${path}.execution.result`));
    }
    const reasons = asStringArray(o.execution.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "execution.reasonCodes must be string[].", `${path}.execution.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "execution.reasonCodes must be stable-sorted and unique.", `${path}.execution.reasonCodes`));
    }
  }

  if (!isArray(o.subReceipts)) {
    issues.push(issue("FIELD_INVALID", "subReceipts must be an array.", `${path}.subReceipts`));
  } else {
    const items: Array<{ name: string; digest: string }> = [];
    o.subReceipts.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "subReceipts entry must be an object.", `${path}.subReceipts[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isTightString(entry.name)) {
        issues.push(issue("FIELD_INVALID", "name must be a non-empty string.", `${path}.subReceipts[${i}].name`));
      }
      if (!isTightString(entry.digest)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.subReceipts[${i}].digest`));
      }
      items.push({ name: entry.name, digest: entry.digest });
      if (!hasOnlyKeys(entry, ["name", "digest"])) {
        issues.push(issue("FIELD_INVALID", "subReceipts entry contains disallowed fields.", `${path}.subReceipts[${i}]`));
      }
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => {
        const c0 = cmpStr(a.name, b.name);
        if (c0 !== 0) return c0;
        return cmpStr(a.digest, b.digest);
      });
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].name !== sorted[i].name || items[i].digest !== sorted[i].digest) {
          issues.push(issue("FIELD_INVALID", "subReceipts must be stable-sorted by name then digest.", `${path}.subReceipts`));
          break;
        }
      }
    }
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeSafeRunReceiptDigestV0(o as SafeRunReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateOperatorReceiptV0(v: unknown, path: string = "operatorReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "OperatorReceiptV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "schemaVersion",
    "weftendBuild",
    "command",
    "outRootDigest",
    "receipts",
    "warnings",
    "contentSummary",
    "receiptDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "OperatorReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.operatorReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.operatorReceipt/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must equal 0.", `${path}.v`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));

  if (!isOperatorCommandV0(o.command)) {
    issues.push(issue("FIELD_INVALID", "command must be a known operator command.", `${path}.command`));
  }

  if (!isTightString(o.outRootDigest)) {
    issues.push(issue("FIELD_INVALID", "outRootDigest must be a non-empty string.", `${path}.outRootDigest`));
  }

  if (!isArray(o.receipts)) {
    issues.push(issue("FIELD_INVALID", "receipts must be an array.", `${path}.receipts`));
  } else {
    const items: Array<{ kind: string; relPath: string; digest: string }> = [];
    o.receipts.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "receipt entry must be an object.", `${path}.receipts[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isTightString(entry.kind)) {
        issues.push(issue("FIELD_INVALID", "kind must be a non-empty string.", `${path}.receipts[${i}].kind`));
      }
      if (!isTightString(entry.relPath)) {
        issues.push(issue("FIELD_INVALID", "relPath must be a non-empty string.", `${path}.receipts[${i}].relPath`));
      } else if (looksLikeAbsPath(entry.relPath)) {
        issues.push(issue("FIELD_INVALID", "relPath must be relative (no absolute paths).", `${path}.receipts[${i}].relPath`));
      }
      if (!isTightString(entry.digest)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.receipts[${i}].digest`));
      }
      items.push({ kind: entry.kind, relPath: entry.relPath, digest: entry.digest });
      if (!hasOnlyKeys(entry, ["kind", "relPath", "digest"])) {
        issues.push(issue("FIELD_INVALID", "receipt entry contains disallowed fields.", `${path}.receipts[${i}]`));
      }
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => {
        const c0 = cmpStr(a.kind, b.kind);
        if (c0 !== 0) return c0;
        const c1 = cmpStr(a.relPath, b.relPath);
        if (c1 !== 0) return c1;
        return cmpStr(a.digest, b.digest);
      });
      for (let i = 0; i < items.length; i += 1) {
        if (
          items[i].kind !== sorted[i].kind ||
          items[i].relPath !== sorted[i].relPath ||
          items[i].digest !== sorted[i].digest
        ) {
          issues.push(issue("FIELD_INVALID", "receipts must be stable-sorted by kind then relPath then digest.", `${path}.receipts`));
          break;
        }
      }
    }
  }

  if (o.contentSummary !== undefined) {
    issues.push(...validateContentSummaryV0(o.contentSummary, `${path}.contentSummary`));
  }

  const warnings = asStringArray(o.warnings);
  if (!warnings) {
    issues.push(issue("FIELD_INVALID", "warnings must be string[].", `${path}.warnings`));
  } else {
    warnings.forEach((w, i) => {
      if (!isBoundedTightString(w, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "warnings entries must be non-empty strings.", `${path}.warnings[${i}]`));
      }
    });
    if (!isSortedUniqueStrings(warnings)) {
      issues.push(issue("FIELD_INVALID", "warnings must be stable-sorted and unique.", `${path}.warnings`));
    }
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeOperatorReceiptDigestV0(o as OperatorReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateCompareReceiptV0(v: unknown, path: string = "compareReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "CompareReceiptV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "schemaVersion",
    "weftendBuild",
    "kind",
    "left",
    "right",
    "verdict",
    "changeBuckets",
    "changes",
    "privacyLint",
    "reasonCodes",
    "receiptDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "CompareReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.compareReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.compareReceipt/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must equal 0.", `${path}.v`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  if (o.kind !== "CompareReceiptV0") {
    issues.push(issue("FIELD_INVALID", "kind must be CompareReceiptV0.", `${path}.kind`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));

  const validateSide = (side: unknown, sidePath: string) => {
    if (!isRecord(side)) {
      issues.push(issue("FIELD_INVALID", `${sidePath} must be an object.`, sidePath));
      return;
    }
    if (!isTightString((side as any).summaryDigest)) {
      issues.push(issue("FIELD_INVALID", "summaryDigest must be a non-empty string.", `${sidePath}.summaryDigest`));
    } else if (containsSensitiveMarker(String((side as any).summaryDigest))) {
      issues.push(issue("FIELD_INVALID", "summaryDigest contains sensitive markers.", `${sidePath}.summaryDigest`));
    }
    const kinds = asStringArray((side as any).receiptKinds);
    if (!kinds) {
      issues.push(issue("FIELD_INVALID", "receiptKinds must be string[].", `${sidePath}.receiptKinds`));
    } else {
      if (!isSortedUniqueStrings(kinds)) {
        issues.push(issue("FIELD_INVALID", "receiptKinds must be stable-sorted and unique.", `${sidePath}.receiptKinds`));
      }
      kinds.forEach((value, i) => {
        if (!isBoundedTightString(value, PRIVACY_MAX_STRING_BYTES)) {
          issues.push(issue("FIELD_INVALID", "receiptKinds entries must be non-empty strings.", `${sidePath}.receiptKinds[${i}]`));
        } else if (containsSensitiveMarker(value)) {
          issues.push(issue("FIELD_INVALID", "receiptKinds entry contains sensitive markers.", `${sidePath}.receiptKinds[${i}]`));
        }
      });
    }
    if (!hasOnlyKeys(side as Record<string, unknown>, ["summaryDigest", "receiptKinds"])) {
      issues.push(issue("FIELD_INVALID", `${sidePath} contains disallowed fields.`, sidePath));
    }
  };
  validateSide(o.left, `${path}.left`);
  validateSide(o.right, `${path}.right`);

  if (!isCompareVerdictV0(o.verdict)) {
    issues.push(issue("ENUM_INVALID", "verdict must be SAME|CHANGED.", `${path}.verdict`));
  }
  if (o.privacyLint !== "PASS" && o.privacyLint !== "FAIL") {
    issues.push(issue("ENUM_INVALID", "privacyLint must be PASS|FAIL.", `${path}.privacyLint`));
  }

  const changeBuckets = asStringArray(o.changeBuckets);
  if (!changeBuckets) {
    issues.push(issue("FIELD_INVALID", "changeBuckets must be string[].", `${path}.changeBuckets`));
  } else {
    if (!isSortedUniqueStrings(changeBuckets)) {
      issues.push(issue("FIELD_INVALID", "changeBuckets must be stable-sorted and unique.", `${path}.changeBuckets`));
    }
    if (changeBuckets.length > MAX_COMPARE_BUCKETS) {
      issues.push(issue("FIELD_INVALID", `changeBuckets exceeds ${MAX_COMPARE_BUCKETS}.`, `${path}.changeBuckets`));
    }
    changeBuckets.forEach((bucket, i) => {
      if (!isBoundedTightString(bucket, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "changeBuckets entries must be non-empty strings.", `${path}.changeBuckets[${i}]`));
      } else if (containsSensitiveMarker(bucket)) {
        issues.push(issue("FIELD_INVALID", "changeBuckets entry contains sensitive markers.", `${path}.changeBuckets[${i}]`));
      }
    });
  }

  if (!isArray(o.changes)) {
    issues.push(issue("FIELD_INVALID", "changes must be an array.", `${path}.changes`));
  } else {
    if (o.changes.length > MAX_COMPARE_BUCKETS) {
      issues.push(issue("FIELD_INVALID", `changes exceeds ${MAX_COMPARE_BUCKETS}.`, `${path}.changes`));
    }
    const items: Array<{ bucket: string }> = [];
    o.changes.forEach((entry: unknown, i: number) => {
      const entryPath = `${path}.changes[${i}]`;
      if (!isRecord(entry)) {
        issues.push(issue("SHAPE_INVALID", "change entry must be an object.", entryPath));
        return;
      }
      if (!hasOnlyKeys(entry, ["bucket", "added", "removed", "counts"])) {
        issues.push(issue("FIELD_INVALID", "change entry contains disallowed fields.", entryPath));
      }
      const bucket = (entry as any).bucket;
      if (!isBoundedTightString(bucket, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "bucket must be a non-empty string.", `${entryPath}.bucket`));
      } else if (containsSensitiveMarker(bucket)) {
        issues.push(issue("FIELD_INVALID", "bucket contains sensitive markers.", `${entryPath}.bucket`));
      } else {
        items.push({ bucket });
      }
      const checkList = (key: "added" | "removed") => {
        const values = asStringArray((entry as any)[key]);
        const keyPath = `${entryPath}.${key}`;
        if (!values) {
          issues.push(issue("FIELD_INVALID", `${key} must be string[].`, keyPath));
          return;
        }
        if (!isSortedUniqueStrings(values)) {
          issues.push(issue("FIELD_INVALID", `${key} must be stable-sorted and unique.`, keyPath));
        }
        if (values.length > MAX_COMPARE_CHANGE_ITEMS) {
          issues.push(issue("FIELD_INVALID", `${key} exceeds ${MAX_COMPARE_CHANGE_ITEMS}.`, keyPath));
        }
        values.forEach((value, j) => {
          if (!isBoundedTightString(value, PRIVACY_MAX_STRING_BYTES)) {
            issues.push(issue("FIELD_INVALID", `${key} entries must be non-empty strings.`, `${keyPath}[${j}]`));
          } else if (containsSensitiveMarker(value)) {
            issues.push(issue("FIELD_INVALID", `${key} entry contains sensitive markers.`, `${keyPath}[${j}]`));
          }
        });
      };
      checkList("added");
      checkList("removed");

      const counts = (entry as any).counts;
      if (counts !== undefined) {
        if (!isRecord(counts)) {
          issues.push(issue("FIELD_INVALID", "counts must be an object when present.", `${entryPath}.counts`));
        } else {
          const countKeys = Object.keys(counts).sort((a, b) => cmpStr(a, b));
          countKeys.forEach((key) => {
            const value = (counts as Record<string, unknown>)[key];
            if (!isBoundedTightString(key, PRIVACY_MAX_STRING_BYTES)) {
              issues.push(issue("FIELD_INVALID", "counts key must be a non-empty string.", `${entryPath}.counts.${key}`));
            } else if (containsSensitiveMarker(key)) {
              issues.push(issue("FIELD_INVALID", "counts key contains sensitive markers.", `${entryPath}.counts.${key}`));
            }
            if (!isNumber(value) || value < 0) {
              issues.push(issue("FIELD_INVALID", "counts values must be non-negative numbers.", `${entryPath}.counts.${key}`));
            }
          });
        }
      }
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => cmpStr(a.bucket, b.bucket));
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].bucket !== sorted[i].bucket) {
          issues.push(issue("FIELD_INVALID", "changes must be stable-sorted by bucket.", `${path}.changes`));
          break;
        }
      }
    }
  }

  const reasons = asStringArray(o.reasonCodes);
  if (!reasons) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
  } else {
    if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
    }
    if (reasons.length > MAX_COMPARE_REASON_CODES) {
      issues.push(issue("FIELD_INVALID", `reasonCodes exceeds ${MAX_COMPARE_REASON_CODES}.`, `${path}.reasonCodes`));
    }
    reasons.forEach((value, i) => {
      if (!isBoundedTightString(value, PRIVACY_MAX_STRING_BYTES)) {
        issues.push(issue("FIELD_INVALID", "reasonCodes entries must be non-empty strings.", `${path}.reasonCodes[${i}]`));
      } else if (containsSensitiveMarker(value)) {
        issues.push(issue("FIELD_INVALID", "reasonCodes entry contains sensitive markers.", `${path}.reasonCodes[${i}]`));
      }
    });
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeCompareReceiptDigestV0(o as CompareReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateHostUpdateReceiptV0(v: unknown, path: string = "hostUpdateReceipt"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "HostUpdateReceiptV0 must be an object.", path)];

  const allowed = [
    "schema",
    "v",
    "schemaVersion",
    "weftendBuild",
    "hostRootDigest",
    "releaseId",
    "hostSelfId",
    "decision",
    "reasonCodes",
    "verify",
    "apply",
    "artifactsWritten",
    "receiptDigest",
  ];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "HostUpdateReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (o.schema !== "weftend.host.updateReceipt/0") {
    issues.push(issue("FIELD_INVALID", "schema must be weftend.host.updateReceipt/0.", `${path}.schema`));
  }
  if (o.v !== 0) {
    issues.push(issue("FIELD_INVALID", "v must equal 0.", `${path}.v`));
  }
  if (o.schemaVersion !== 0) {
    issues.push(issue("RECEIPT_SCHEMA_VERSION_BAD", "schemaVersion must equal 0.", `${path}.schemaVersion`));
  }
  issues.push(...validateWeftendBuildV0(o.weftendBuild, `${path}.weftendBuild`));
  if (!isTightString(o.hostRootDigest)) {
    issues.push(issue("FIELD_INVALID", "hostRootDigest must be a non-empty string.", `${path}.hostRootDigest`));
  }
  if (o.releaseId !== undefined && !isTightString(o.releaseId)) {
    issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string when present.", `${path}.releaseId`));
  }
  if (o.hostSelfId !== undefined && !isTightString(o.hostSelfId)) {
    issues.push(issue("FIELD_INVALID", "hostSelfId must be a non-empty string when present.", `${path}.hostSelfId`));
  }
  if (o.decision !== "ALLOW" && o.decision !== "DENY") {
    issues.push(issue("ENUM_INVALID", "decision must be ALLOW|DENY.", `${path}.decision`));
  }
  const reasons = asStringArray(o.reasonCodes);
  if (!reasons) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.reasonCodes`));
  } else if (!isSortedUniqueStrings(reasons)) {
    issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.reasonCodes`));
  }

  if (!isRecord(o.verify)) {
    issues.push(issue("FIELD_INVALID", "verify must be an object.", `${path}.verify`));
  } else {
    if (o.verify.status !== "OK" && o.verify.status !== "UNVERIFIED") {
      issues.push(issue("ENUM_INVALID", "verify.status must be OK|UNVERIFIED.", `${path}.verify.status`));
    }
    const vReasons = asStringArray(o.verify.reasonCodes);
    if (!vReasons) {
      issues.push(issue("FIELD_INVALID", "verify.reasonCodes must be string[].", `${path}.verify.reasonCodes`));
    } else if (!isSortedUniqueStrings(vReasons)) {
      issues.push(issue("FIELD_INVALID", "verify.reasonCodes must be stable-sorted and unique.", `${path}.verify.reasonCodes`));
    }
  }

  if (!isRecord(o.apply)) {
    issues.push(issue("FIELD_INVALID", "apply must be an object.", `${path}.apply`));
  } else {
    if (!isBoolean(o.apply.attempted)) {
      issues.push(issue("FIELD_INVALID", "apply.attempted must be boolean.", `${path}.apply.attempted`));
    }
    if (o.apply.result !== "APPLIED" && o.apply.result !== "ROLLED_BACK" && o.apply.result !== "SKIP") {
      issues.push(issue("ENUM_INVALID", "apply.result must be APPLIED|ROLLED_BACK|SKIP.", `${path}.apply.result`));
    }
    const aReasons = asStringArray(o.apply.reasonCodes);
    if (!aReasons) {
      issues.push(issue("FIELD_INVALID", "apply.reasonCodes must be string[].", `${path}.apply.reasonCodes`));
    } else if (!isSortedUniqueStrings(aReasons)) {
      issues.push(issue("FIELD_INVALID", "apply.reasonCodes must be stable-sorted and unique.", `${path}.apply.reasonCodes`));
    }
  }

  if (!isArray(o.artifactsWritten)) {
    issues.push(issue("FIELD_INVALID", "artifactsWritten must be an array.", `${path}.artifactsWritten`));
  } else {
    const items: Array<{ name: string; digest: string }> = [];
    o.artifactsWritten.forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        issues.push(issue("SHAPE_INVALID", "artifactsWritten entry must be an object.", `${path}.artifactsWritten[${i}]`));
        return;
      }
      const entry = item as any;
      if (!isTightString(entry.name)) {
        issues.push(issue("FIELD_INVALID", "name must be a non-empty string.", `${path}.artifactsWritten[${i}].name`));
      }
      if (!isTightString(entry.digest)) {
        issues.push(issue("FIELD_INVALID", "digest must be a non-empty string.", `${path}.artifactsWritten[${i}].digest`));
      }
      items.push({ name: entry.name, digest: entry.digest });
      if (!hasOnlyKeys(entry, ["name", "digest"])) {
        issues.push(issue("FIELD_INVALID", "artifactsWritten entry contains disallowed fields.", `${path}.artifactsWritten[${i}]`));
      }
    });
    if (items.length > 1) {
      const sorted = items.slice().sort((a, b) => {
        const c0 = cmpStr(a.name, b.name);
        if (c0 !== 0) return c0;
        return cmpStr(a.digest, b.digest);
      });
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].name !== sorted[i].name || items[i].digest !== sorted[i].digest) {
          issues.push(issue("FIELD_INVALID", "artifactsWritten must be stable-sorted by name then digest.", `${path}.artifactsWritten`));
          break;
        }
      }
    }
  }

  if (!isTightString(o.receiptDigest)) {
    issues.push(issue("FIELD_INVALID", "receiptDigest must be a non-empty string.", `${path}.receiptDigest`));
  }

  if (issues.length === 0) {
    const expected = computeHostUpdateReceiptDigestV0(o as HostUpdateReceiptV0);
    if (o.receiptDigest !== expected) {
      issues.push(issue("FIELD_INVALID", "receiptDigest must match canonical digest.", `${path}.receiptDigest`));
    }
  }

  return sortIssuesDeterministically(issues);
}

export function validateGateReceiptV0(v: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(v)) return [issue("SHAPE_INVALID", "GateReceiptV0 must be an object.", path)];

  const allowed = ["receiptId", "body", "signatures"];
  if (!hasOnlyKeys(v, allowed)) {
    issues.push(issue("FIELD_INVALID", "GateReceiptV0 contains disallowed fields.", path));
  }

  const o = v as any;
  if (!isTightString(o.receiptId)) {
    issues.push(issue("FIELD_INVALID", "receiptId must be a non-empty string.", `${path}.receiptId`));
  }

  if (!isRecord(o.body)) {
    issues.push(issue("FIELD_INVALID", "body must be an object.", `${path}.body`));
  } else {
    const bodyAllowed = [
      "schema",
      "gateId",
      "marketId",
      "marketPolicyDigest",
      "planDigest",
      "releaseId",
      "blockHash",
      "decision",
      "reasonCodes",
      "checkpointDigest",
    ];
    if (!hasOnlyKeys(o.body, bodyAllowed)) {
      issues.push(issue("FIELD_INVALID", "GateReceiptV0.body contains disallowed fields.", `${path}.body`));
    }

    if (o.body.schema !== "weftend.gateReceipt/0") {
      issues.push(issue("FIELD_INVALID", "schema must be weftend.gateReceipt/0.", `${path}.body.schema`));
    }

    const gates = new Set(["market.admission.v0", "market.install.v0", "runtime.grant.v0", "market.takedown.v0"]);
    if (!isString(o.body.gateId) || !gates.has(o.body.gateId)) {
      issues.push(issue("ENUM_INVALID", "gateId must be a known gate.", `${path}.body.gateId`));
    }
    if (!isTightString(o.body.marketId)) {
      issues.push(issue("FIELD_INVALID", "marketId must be a non-empty string.", `${path}.body.marketId`));
    }
    if (!isTightString(o.body.marketPolicyDigest)) {
      issues.push(
        issue("FIELD_INVALID", "marketPolicyDigest must be a non-empty string.", `${path}.body.marketPolicyDigest`)
      );
    }
    if (!isTightString(o.body.planDigest)) {
      issues.push(issue("FIELD_INVALID", "planDigest must be a non-empty string.", `${path}.body.planDigest`));
    }
    if (!isTightString(o.body.releaseId)) {
      issues.push(issue("FIELD_INVALID", "releaseId must be a non-empty string.", `${path}.body.releaseId`));
    }
    if (!isTightString(o.body.blockHash)) {
      issues.push(issue("FIELD_INVALID", "blockHash must be a non-empty string.", `${path}.body.blockHash`));
    }
    if (o.body.decision !== "ALLOW" && o.body.decision !== "DENY") {
      issues.push(issue("ENUM_INVALID", "decision must be ALLOW|DENY.", `${path}.body.decision`));
    }
    const reasons = asStringArray(o.body.reasonCodes);
    if (!reasons) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be string[].", `${path}.body.reasonCodes`));
    } else if (!isSortedUniqueStrings(reasons)) {
      issues.push(issue("FIELD_INVALID", "reasonCodes must be stable-sorted and unique.", `${path}.body.reasonCodes`));
    }
    if (!isTightString(o.body.checkpointDigest)) {
      issues.push(
        issue("FIELD_INVALID", "checkpointDigest must be a non-empty string.", `${path}.body.checkpointDigest`)
      );
    }
  }

  if (isRecord(o.body) && isTightString(o.receiptId)) {
    const expected = computeGateReceiptIdV0(o.body);
    if (o.receiptId !== expected) {
      issues.push(issue("RECEIPT_ID_MISMATCH", "receiptId must match canonical body digest.", `${path}.receiptId`));
    }
  }

  if (o.signatures !== undefined) {
    if (!isArray(o.signatures)) {
      issues.push(issue("FIELD_INVALID", "signatures must be an array when present.", `${path}.signatures`));
    } else {
      if (o.signatures.length > PRIVACY_MAX_RECEIPT_SIGNATURES) {
        issues.push(
          issue(
            "RECEIPT_OVERSIZE",
            `GateReceiptV0.signatures exceeds ${PRIVACY_MAX_RECEIPT_SIGNATURES}.`,
            `${path}.signatures`
          )
        );
      }
      o.signatures.forEach((sig: unknown, i: number) => {
        const sigPath = `${path}.signatures[${i}]`;
        if (!isRecord(sig)) {
          issues.push(issue("FIELD_INVALID", "signature must be an object.", sigPath));
          return;
        }
        const allowedSig = ["sigKind", "keyId", "sigB64"];
        if (!hasOnlyKeys(sig, allowedSig)) {
          issues.push(issue("FIELD_INVALID", "signature contains disallowed fields.", sigPath));
        }
        const s = sig as any;
        if (!isTightString(s.sigKind)) {
          issues.push(issue("FIELD_INVALID", "sigKind must be a non-empty string.", `${sigPath}.sigKind`));
        }
        if (!isTightString(s.keyId)) {
          issues.push(issue("FIELD_INVALID", "keyId must be a non-empty string.", `${sigPath}.keyId`));
        }
        if (!isString(s.sigB64)) {
          issues.push(issue("FIELD_INVALID", "sigB64 must be a base64 string.", `${sigPath}.sigB64`));
        } else {
          const n = base64ByteLength(s.sigB64);
          if (n === null) {
            issues.push(issue("FIELD_INVALID", "sigB64 must be strict base64.", `${sigPath}.sigB64`));
          } else if (n > MAX_RELEASE_SIG_BYTES) {
            issues.push(
              issue(
                "FIELD_INVALID",
                `sigB64 exceeds max size ${MAX_RELEASE_SIG_BYTES} bytes.`,
                `${sigPath}.sigB64`
              )
            );
          }
        }
      });
    }
  }

  return sortIssuesDeterministically(issues);
}

export const validateWeftendEntitlementV1 = (
  value: unknown
): Result<WeftendEntitlementV1, ValidationIssue[]> => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return err([issue("TYPE_INVALID", "entitlement must be an object.", "entitlement")]);
  }
  const allowed = [
    "schema",
    "schemaVersion",
    "licenseId",
    "customerId",
    "tier",
    "features",
    "issuedAt",
    "expiresAt",
    "issuer",
    "signature",
  ];
  if (!hasOnlyKeys(value, allowed)) {
    issues.push(issue("FIELD_INVALID", "entitlement contains disallowed fields.", "entitlement"));
  }
  if (value.schema !== "weftend.entitlement/1") {
    issues.push(issue("ENUM_INVALID", "schema must be weftend.entitlement/1.", "schema"));
  }
  if (value.schemaVersion !== 0) {
    issues.push(issue("ENUM_INVALID", "schemaVersion must be 0.", "schemaVersion"));
  }
  if (!isBoundedTightString(value.licenseId, 128)) {
    issues.push(issue("FIELD_INVALID", "licenseId must be a bounded non-empty string.", "licenseId"));
  }
  if (!isBoundedTightString(value.customerId, 128)) {
    issues.push(issue("FIELD_INVALID", "customerId must be a bounded non-empty string.", "customerId"));
  }
  if (value.tier !== "community" && value.tier !== "enterprise") {
    issues.push(issue("ENUM_INVALID", "tier must be community|enterprise.", "tier"));
  }
  const features = asStringArray(value.features);
  if (!features) {
    issues.push(issue("FIELD_INVALID", "features must be string[].", "features"));
  } else {
    if (features.length > 64) {
      issues.push(issue("FIELD_INVALID", "features exceeds 64 entries.", "features"));
    }
    if (!features.every((f) => isBoundedTightString(f, 64))) {
      issues.push(issue("FIELD_INVALID", "features entries must be bounded tight strings.", "features"));
    }
    if (!isSortedUniqueStrings(features)) {
      issues.push(issue("FIELD_INVALID", "features must be stable-sorted and unique.", "features"));
    }
  }
  if (!isDateYmd(value.issuedAt)) {
    issues.push(issue("FIELD_INVALID", "issuedAt must be YYYY-MM-DD.", "issuedAt"));
  }
  if (value.expiresAt !== undefined && !isDateYmd(value.expiresAt)) {
    issues.push(issue("FIELD_INVALID", "expiresAt must be YYYY-MM-DD when present.", "expiresAt"));
  }
  if (!isRecord(value.issuer)) {
    issues.push(issue("FIELD_INVALID", "issuer must be an object.", "issuer"));
  } else {
    if (!hasOnlyKeys(value.issuer, ["keyId", "algo"])) {
      issues.push(issue("FIELD_INVALID", "issuer contains disallowed fields.", "issuer"));
    }
    if (!isBoundedTightString(value.issuer.keyId, 128)) {
      issues.push(issue("FIELD_INVALID", "issuer.keyId must be bounded.", "issuer.keyId"));
    }
    if (value.issuer.algo !== "sig.ed25519.v0") {
      issues.push(issue("ENUM_INVALID", "issuer.algo must be sig.ed25519.v0.", "issuer.algo"));
    }
  }
  if (!isRecord(value.signature)) {
    issues.push(issue("FIELD_INVALID", "signature must be an object.", "signature"));
  } else {
    if (!hasOnlyKeys(value.signature, ["sigKind", "sigB64"])) {
      issues.push(issue("FIELD_INVALID", "signature contains disallowed fields.", "signature"));
    }
    if (value.signature.sigKind !== "sig.ed25519.v0") {
      issues.push(issue("ENUM_INVALID", "signature.sigKind must be sig.ed25519.v0.", "signature.sigKind"));
    }
    if (!isBoundedString(value.signature.sigB64, 2048)) {
      issues.push(issue("FIELD_INVALID", "signature.sigB64 must be bounded base64.", "signature.sigB64"));
    }
  }

  if (issues.length > 0) return err(issues);
  return ok(value as unknown as WeftendEntitlementV1);
};
