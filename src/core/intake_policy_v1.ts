// src/core/intake_policy_v1.ts
// Platform intake policy schema + canonicalization (v1).

import { canonicalJSON } from "./canon";
import { sha256HexV0 } from "./hash_v0";
import { truncateListWithMarker } from "./bounds";
import { cmpStrV0 } from "./order";
import type { EvidenceProfileV1, IntakeActionV1, IntakeSeverityV1, WeftEndPolicyV1 } from "./types";

export type { EvidenceProfileV1, IntakeActionV1, IntakeSeverityV1, WeftEndPolicyV1 };

const sha256 = (input: string): string => sha256HexV0(input);

const normalizeDomain = (value: string): string => value.trim().toLowerCase().replace(/\.+$/, "");

const normalizePath = (value: string): string =>
  value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const stableSortUnique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((v) => {
    if (v.length === 0 || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  out.sort((a, b) => cmpStrV0(a, b));
  return out;
};

const canonicalizeStringList = (values: string[], maxItems: number): string[] => {
  const normalized = stableSortUnique(values);
  const truncated = truncateListWithMarker(normalized, maxItems);
  return truncated.items;
};

export const canonicalizeWeftEndPolicyV1 = (policy: WeftEndPolicyV1): WeftEndPolicyV1 => {
  const capsPolicy = policy.capsPolicy ?? {};
  const maxCapsItems = policy.bounds.maxCapsItems;

  const net = capsPolicy.net
    ? {
        allowedDomains: canonicalizeStringList(
          (capsPolicy.net.allowedDomains ?? []).map(normalizeDomain),
          maxCapsItems
        ),
        ...(capsPolicy.net.allowIfUnsigned !== undefined
          ? { allowIfUnsigned: Boolean(capsPolicy.net.allowIfUnsigned) }
          : {}),
      }
    : undefined;

  const fs = capsPolicy.fs
    ? {
        allowedPaths: canonicalizeStringList(
          (capsPolicy.fs.allowedPaths ?? []).map(normalizePath),
          maxCapsItems
        ),
      }
    : undefined;

  const reasonSeverity: Record<string, IntakeSeverityV1> = {};
  Object.keys(policy.reasonSeverity ?? {})
    .sort((a, b) => cmpStrV0(a, b))
    .forEach((key) => {
      const trimmed = key.trim();
      if (!trimmed) return;
      reasonSeverity[trimmed] = policy.reasonSeverity[key];
    });

  const severityAction: Record<IntakeSeverityV1, IntakeActionV1> = {
    INFO: policy.severityAction.INFO,
    WARN: policy.severityAction.WARN,
    DENY: policy.severityAction.DENY,
    QUARANTINE: policy.severityAction.QUARANTINE,
  };

  return {
    schema: "weftend.intake.policy/1",
    profile: policy.profile,
    reasonSeverity,
    severityAction,
    capsPolicy: {
      ...(net ? { net } : {}),
      ...(fs ? { fs } : {}),
      ...(capsPolicy.storage ? { storage: { allow: Boolean(capsPolicy.storage.allow) } } : {}),
      ...(capsPolicy.childProcess ? { childProcess: { allow: Boolean(capsPolicy.childProcess.allow) } } : {}),
    },
    disclosure: {
      requireOnWARN: Boolean(policy.disclosure.requireOnWARN),
      requireOnDENY: Boolean(policy.disclosure.requireOnDENY),
      maxLines: Math.max(0, Math.floor(policy.disclosure.maxLines)),
    },
    bounds: {
      maxReasonCodes: Math.max(0, Math.floor(policy.bounds.maxReasonCodes)),
      maxCapsItems: Math.max(0, Math.floor(policy.bounds.maxCapsItems)),
      maxDisclosureChars: Math.max(0, Math.floor(policy.bounds.maxDisclosureChars)),
      maxAppealBytes: Math.max(0, Math.floor(policy.bounds.maxAppealBytes)),
    },
  };
};

export const computeWeftEndPolicyIdV1 = (policy: WeftEndPolicyV1): string => {
  const canonical = canonicalizeWeftEndPolicyV1(policy);
  return `sha256:${sha256(canonicalJSON(canonical))}`;
};
