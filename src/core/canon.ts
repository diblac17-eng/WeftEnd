/* src/core/canon.ts */
/**
 * WeftEnd (WebLayers v2.6) — Determinism primitives
 *
 * MUST match the reference implementations in docs/PROJECT_STATE.md.
 *
 * Layer rules:
 * - core only (TS/stdlib)
 * - pure functions
 */

export function canonicalJSON(obj: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null || v === undefined) return null;

    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;

    if (t === "function" || t === "symbol") return null;

    if (Array.isArray(v)) return v.map(normalize);

    if (t === "object") {
      if (seen.has(v)) throw new Error("CYCLE_IN_CANONICAL_JSON");
      seen.add(v);

      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
      return out;
    }

    return null;
  };

  return JSON.stringify(normalize(obj));
}

export const sortById = <T extends { id: string }>(arr: T[]) =>
  stableWrap(arr)
    .sort((a, b) => {
      const c = a.v.id.localeCompare(b.v.id);
      if (c !== 0) return c;
      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortDependencies = (deps: { id: string; role: string }[]) =>
  stableWrap(deps)
    .sort((a, b) => {
      const c = a.v.id.localeCompare(b.v.id);
      if (c !== 0) return c;

      const r = a.v.role.localeCompare(b.v.role);
      if (r !== 0) return r;

      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortCapRequests = (caps: { capId: string; params?: any }[]) =>
  stableWrap(caps)
    .sort((a, b) => {
      const c = a.v.capId.localeCompare(b.v.capId);
      if (c !== 0) return c;

      const ap = canonicalJSON(a.v.params ?? null);
      const bp = canonicalJSON(b.v.params ?? null);

      // Explicitly ensure null params sort before objects (localeCompare would place "{" before "n").
      const aNull = ap === "null";
      const bNull = bp === "null";
      if (aNull !== bNull) return aNull ? -1 : 1;

      const cp = ap.localeCompare(bp);
      if (cp !== 0) return cp;

      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortCapGrants = (caps: { capId: string; params?: any }[]) =>
  stableWrap(caps)
    .sort((a, b) => {
      const c = a.v.capId.localeCompare(b.v.capId);
      if (c !== 0) return c;

      const ap = canonicalJSON(a.v.params ?? null);
      const bp = canonicalJSON(b.v.params ?? null);

      const aNull = ap === "null";
      const bNull = bp === "null";
      if (aNull !== bNull) return aNull ? -1 : 1;

      const cp = ap.localeCompare(bp);
      if (cp !== 0) return cp;

      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortByNodeId = <T extends { nodeId: string }>(arr: T[]) =>
  stableWrap(arr)
    .sort((a, b) => {
      const c = a.v.nodeId.localeCompare(b.v.nodeId);
      if (c !== 0) return c;
      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortBlockPins = (pins: { nodeId: string; contentHash: string }[]) =>
  stableWrap(pins)
    .sort((a, b) => {
      const c = a.v.nodeId.localeCompare(b.v.nodeId);
      if (c !== 0) return c;

      const h = a.v.contentHash.localeCompare(b.v.contentHash);
      if (h !== 0) return h;

      return a.i - b.i;
    })
    .map((x) => x.v);

const stableWrap = <T>(arr: T[]) => arr.map((v, i) => ({ v, i }));

export const sortEvidenceEnvelopes = (evidence: { kind: string; payload: unknown }[]) =>
  stableWrap(evidence)
    .sort((a, b) => {
      const ck = a.v.kind.localeCompare(b.v.kind);
      if (ck !== 0) return ck;

      const ap = canonicalJSON(a.v.payload ?? null);
      const bp = canonicalJSON(b.v.payload ?? null);

      const aNull = ap === "null";
      const bNull = bp === "null";
      if (aNull !== bNull) return aNull ? -1 : 1;

      const cp = ap.localeCompare(bp);
      if (cp !== 0) return cp;

      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortNormalizedClaims = (
  claims: { claimId: string; evidenceKind: string; normalized: unknown }[]
) =>
  stableWrap(claims)
    .sort((a, b) => {
      const cid = a.v.claimId.localeCompare(b.v.claimId);
      if (cid !== 0) return cid;

      const cek = a.v.evidenceKind.localeCompare(b.v.evidenceKind);
      if (cek !== 0) return cek;

      const cn = canonicalJSON(a.v.normalized ?? null).localeCompare(
        canonicalJSON(b.v.normalized ?? null)
      );
      if (cn !== 0) return cn;

      return a.i - b.i;
    })
    .map((x) => x.v);

export const sortPortalCollection = (
  items: {
    nodeId: string;
    evidenceKind?: string;
    claimId?: string;
    payload?: unknown;
  }[]
) =>
  stableWrap(items)
    .sort((a, b) => {
      const cn = a.v.nodeId.localeCompare(b.v.nodeId);
      if (cn !== 0) return cn;

      const cek = (a.v.evidenceKind ?? "").localeCompare(b.v.evidenceKind ?? "");
      if (cek !== 0) return cek;

      const cc = (a.v.claimId ?? "").localeCompare(b.v.claimId ?? "");
      if (cc !== 0) return cc;

      const cp = canonicalJSON(a.v.payload ?? null).localeCompare(
        canonicalJSON(b.v.payload ?? null)
      );
      if (cp !== 0) return cp;

      return a.i - b.i;
    })
    .map((x) => x.v);
