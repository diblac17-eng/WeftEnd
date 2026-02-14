/* src/engine/evidence.ts */
/**
 * Evidence registry + verification (minimal, deterministic).
 */

import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { cmpStrV0 } from "../core/order";
import { validateEvidenceRecord } from "../core/validate";
import type { EvidenceRecord, EvidenceVerifyResult, EvidenceKind } from "../core/types";

export type EvidenceVerifyContext = {
  planDigest?: string;
  callerBlockHash?: string;
};

export interface EvidenceVerifier {
  kind: EvidenceKind;
  verifierId: string;
  verifierVersion?: string;
  verify: (record: EvidenceRecord, context: EvidenceVerifyContext) => EvidenceVerifyResult;
}

export type EvidenceRegistry = Map<string, EvidenceVerifier>;

const safeCanonical = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "CANONICAL_INVALID";
  }
};

const sortEvidenceRecords = (records: EvidenceRecord[]): EvidenceRecord[] =>
  records
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ak = cmpStrV0(a.v.kind ?? "", b.v.kind ?? "");
      if (ak !== 0) return ak;
      const ai = cmpStrV0(a.v.issuer ?? "", b.v.issuer ?? "");
      if (ai !== 0) return ai;
      const ap = safeCanonical(a.v.payload);
      const bp = safeCanonical(b.v.payload);
      const ac = cmpStrV0(ap, bp);
      if (ac !== 0) return ac;
      const ae = cmpStrV0(a.v.evidenceId ?? "", b.v.evidenceId ?? "");
      if (ae !== 0) return ae;
      return a.i - b.i;
    })
    .map((x) => x.v);

export function buildEvidenceRegistry(verifiers: EvidenceVerifier[]): EvidenceRegistry {
  const registry: EvidenceRegistry = new Map();
  const sorted = [...verifiers].sort((a, b) => {
    const ck = cmpStrV0(String(a.kind), String(b.kind));
    if (ck !== 0) return ck;
    return cmpStrV0(a.verifierId, b.verifierId);
  });

  for (const verifier of sorted) {
    if (!registry.has(String(verifier.kind))) registry.set(String(verifier.kind), verifier);
  }

  return registry;
}

export function verifyEvidenceRecords(
  records: EvidenceRecord[],
  registry: EvidenceRegistry,
  context: EvidenceVerifyContext
): EvidenceVerifyResult[] {
  const ordered = sortEvidenceRecords(records);
  const results: EvidenceVerifyResult[] = [];

  for (const record of ordered) {
    const bindingIssues = validateEvidenceRecord(record, "evidence");
    if (bindingIssues.length > 0) {
      results.push({
        evidenceId: record.evidenceId || "",
        kind: record.kind,
        status: "UNVERIFIED",
        reasonCodes: stableSortUniqueReasonsV0(bindingIssues.map((i) => i.code)),
        verifierId: "invalid",
      });
      continue;
    }

    const verifier = registry.get(String(record.kind));
    if (!verifier) {
      results.push({
        evidenceId: record.evidenceId || "",
        kind: record.kind,
        status: "UNVERIFIED",
        reasonCodes: ["EVIDENCE_KIND_UNSUPPORTED"],
        verifierId: "unverified",
      });
      continue;
    }

    const out = verifier.verify(record, context);
    results.push({
      evidenceId: out.evidenceId || record.evidenceId || "",
      kind: record.kind,
      status: out.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
      reasonCodes: stableSortUniqueReasonsV0(out.reasonCodes ?? []),
      verifierId: out.verifierId || verifier.verifierId,
      verifierVersion: out.verifierVersion ?? verifier.verifierVersion,
      normalizedClaims: out.normalizedClaims,
    });
  }

  return results;
}

export function supportedEvidenceKinds(registry: EvidenceRegistry): string[] {
  return stableSortUniqueStringsV0(Array.from(registry.keys()));
}
