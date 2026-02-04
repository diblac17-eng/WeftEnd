# docs/shadow_audit_v0.md - Shadow Audit v0 (bounded, deterministic, non-tracking)

Status: normative for Shadow Audit v0 scaffolding.
This document must not conflict with:
- docs/PROJECT_STATE.md
- docs/weblayers-v2-spec.md
- docs/INTEGRATION_CONTRACT.md
- docs/PRIVACY_PILLARS.md

If any conflict is found, stop and write a Proposal.

---

## 0) Purpose

Define a minimal, bounded shadow audit lane that produces proof-only outputs
without introducing identity, time, or telemetry drift. This is an optional
module invoked only by explicit CLI usage.

---

## 1) Non-Goals

- No live gameplay enforcement in v0.
- No raw event logs emitted or exported by default.
- No user/device/account identifiers.
- No timestamps or durations.

---

## 2) Core Principles

S1 - Deterministic
- Same inputs produce identical outputs and digests.

S2 - Privacy bounded
- No stable identifiers. No timestamps. No untrusted strings.

S3 - Bounded
- Hard caps on events, keys, and strings. Deterministic truncation drops oldest.

S4 - Proof-only outputs
- Outputs are counts + reason families + Tartarus kind counts only.

S5 - Explicit invocation only
- Shadow audit is never run by default. Only explicit CLI usage.

---

## 3) Types (v0)

ShadowAuditRequestV0
- schema: "weftend.shadowAudit.request/0"
- v: 0
- rulesetId: string (bounded, stable tag)
- releaseId?: string (optional, digest-like)
- pathDigest?: string (optional, digest-like)
- policy?: {
    denyThresholds?: {
      missing, extra, reordered, duplicate,
      attemptedWithoutRequest, allowedWithoutEvidence, inconsistent
    }
  }
- stream: ShadowAuditMatchStreamV0

ShadowAuditMatchStreamV0
- schema: "weftend.shadowAudit.stream/0"
- v: 0
- streamNonce?: string (ephemeral; optional)
- events: ShadowAuditEventV0[] (bounded, deterministic order)

ShadowAuditEventV0
- seq: number (monotonic, non-negative)
- kind: string (bounded, stable tag)
- side: "expected" | "observed" (optional; for sequence integrity)
- data?: object (bounded keys, primitive values only; reasonCodes may be string[] when key is "reasonCodes")

Cap event kinds (v2 verifier input):
- CAP_REQUEST (data: { capId })
- CAP_ALLOW   (data: { capId, reasonCodes?, evidenceOk? })
- CAP_DENY    (data: { capId, reasonCodes? })

ShadowAuditResultV0
- schema: "weftend.shadowAudit.result/0"
- v: 0
- status: "OK" | "WARN" | "DENY" | "QUARANTINE"
- reasonFamilies: string[] (stable sorted, unique, bounded)
- tartarusKindCounts: { [kind: string]: number } (bounded keys)
- counts: { events: number; warnings: number; denies: number; quarantines: number }
- sequenceCounts: { missing: number; extra: number; reordered: number; duplicate: number }
- capCounts: {
    attemptedWithoutRequest: number;
    allowedWithoutEvidence: number;
    inconsistent: number;
  }

---

## 4) Bounds (v0 defaults)

- max events: 512
- max event keys: 32
- max string bytes per field: 64
- max reasonFamilies: 32
- max tartarus kinds: 32

Truncation rule:
- If events exceed max, drop the tail (highest seq) deterministically.

---

## 5) Privacy Rules

- No stable identifiers (userId, deviceId, accountId, sessionId, playerId).
- No timestamps or duration fields.
- No raw URLs, absolute paths, or hostnames.
- Untrusted strings are rejected.

Privacy violations fail closed with privacy reason codes.

---

## 6) Reason Codes (v0 minimum)

- SHADOW_AUDIT_SCHEMA_INVALID
- SHADOW_AUDIT_BOUNDS_EXCEEDED
- SHADOW_AUDIT_PRIVACY_FORBIDDEN
- SHADOW_AUDIT_MISSING
- SHADOW_AUDIT_EXTRA
- SHADOW_AUDIT_REORDERED
- SHADOW_AUDIT_DUPLICATE
- SHADOW_AUDIT_CAP_ATTEMPT_WITHOUT_REQUEST
- SHADOW_AUDIT_CAP_ALLOWED_WITHOUT_EVIDENCE
- SHADOW_AUDIT_CAP_INCONSISTENT

Reason codes are stable-sorted.

Status rule:
- DENY when any denyThresholds are exceeded (including cap thresholds).
- WARN when any counts are non-zero but thresholds are not exceeded.

---

## 7) CLI Wiring (v0)

Command (explicit only):
- weftend shadow-audit <request.json>

Behavior:
- Validate request (schema + privacy + bounds).
- Emit proof-only ShadowAuditResultV0 (counts + reasons only).
- No storage or export by default.

---

## 8) Test Obligations

T1 Determinism under shuffle (event order does not change output).
T2 Boundedness and truncation (drop oldest deterministically).
T3 No stable ID / no time regression (privacy guardrails catch violations).
T4 Proof-only outputs (no raw event logs in result).
