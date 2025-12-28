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
  GraphManifest,
  Result,
  RuntimeBundle,
  TrustNodeResult,
  TrustResult,
} from "./types";

import { canonicalJSON } from "./canon";

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

const asStringArray = (v: unknown): string[] | null => {
  if (!isArray(v)) return null;
  for (const x of v) if (!isString(x)) return null;
  return v as string[];
};

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