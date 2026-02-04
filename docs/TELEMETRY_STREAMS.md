# docs/TELEMETRY_STREAMS.md - Telemetry Conduits v0 (Stream Market)

Status: normative for telemetry conduits. Implementation may follow in later phases.
This document must not conflict with:
- docs/PROJECT_STATE.md
- docs/weblayers-v2-spec.md
- docs/INTEGRATION_CONTRACT.md
- docs/FEATURE_ADMISSION_GATE.md

If any conflict is found, stop and write a Proposal.

---

## 0) Purpose

Define a bounded, opt-in telemetry stream that fits WeftEnd's determinism, proof-only,
capability, and privacy pillars. Telemetry is a conduit, not storage.

---

## 1) Non-Goals

- No raw event firehose.
- No per-player identifiers by default.
- No push to arbitrary URLs.
- No data warehousing inside WeftEnd.

---

## 2) Core Principles

T1 - Append-only
- Telemetry streams are append-only chains of chunks.

T2 - Windowed + TTL
- Chunks are windowed (time/tick buckets) and expire by TTL.

T3 - Content-addressed
- Each chunk has a deterministic chunkId (hash of canonical body).

T4 - Proof-only
- Payloads are canonical and schema-validated. Evidence is referenced by digest.

T5 - Capability-gated
- Publishing is a capability with strict budgets and rate limits.

T6 - Privacy-first
- Aggregate-only by default, no stable identifiers, no high-cardinality keys.

---

## 3) Types (v0)

TelemetryJournalV0
- schema: "weftend.telemetry.journal/0"
- streamId: string (namespaced, ex: "telemetry.match.v0")
- headChunkId: string | null
- updatedAtTick: number

TelemetryChunkV0
- schema: "weftend.telemetry.chunk/0"
- streamId: string
- chunkId: string
- prevChunkId: string | null
- windowStartTick: number
- windowEndTick: number
- payload: object (schema-validated per stream)
- evidenceRefs: string[] (digests only, stable-sorted)
- tartarusRefs: string[] (digests only, stable-sorted)
- ttlSeconds: number
- kAnonymityFloor: number
- coverage: number (0..1)

ChunkId rule
- chunkId = hash(canonicalJSON(chunkBody)) where chunkBody excludes chunkId itself.

---

## 4) Payload Rules

- Payload must be canonical JSON.
- No identifiers by default (no playerId, deviceId, ip, user agent, session ids).
- No unbounded cardinality fields.
- Use coarse windows (hour/day) unless explicitly approved.

If payload violates rules, reject with deterministic reason codes.

---

## 5) Privacy Guards

P1 - Aggregate-only default
- Only aggregates, distributions, and percentiles.

P2 - k-anonymity floor
- Do not emit any bucket with fewer than k contributors.
- Emit INSUFFICIENT_COVERAGE instead.

P3 - No cross-window linkage
- No stable IDs that can be linked across windows.

P4 - Secret Zone exclusion
- Secret Zone data never enters telemetry.

---

## 6) Capabilities

Publish caps (example)
- telemetry.publish.match.summary
- telemetry.publish.security.posture

Read caps (entitlement-gated, optional)
- telemetry.read.<streamId>
- telemetry.read.<streamId>.export

Publishing without a cap must fail closed.

---

## 7) Budget and Rate Limits

Required limits per stream:
- maxChunksPerMinute
- maxChunkBytes
- maxBucketsPerChunk
- ttlSeconds (max)

Violations deny publish with deterministic reasons.

---

## 8) Default Settings (v0)

Baseline defaults that match current privacy and operational norms:
- windowSizeSeconds: 3600 (1 hour)
- minWindowSizeSeconds: 60
- maxChunksPerMinute: 12
- maxChunkBytes: 262144 (256 KB)
- maxBucketsPerChunk: 200
- ttlSeconds: 86400 (24 hours)
- ttlSecondsMax: 604800 (7 days)
- kAnonymityFloor: 100
- regionBucket: country-level only (no city-level by default)

Any deviation requires an explicit policy rule and evidence/consent if it increases granularity.

---

## 9) Portal Truth

Portal must show:
- streamId
- chunkId
- window bounds
- coverage + kAnonymityFloor
- reason codes for suppressed buckets

Portal must never show raw payloads that could identify a person.

---

## 10) Reason Codes (minimum set)

- TELEMETRY_CAP_DENIED
- TELEMETRY_SCHEMA_INVALID
- TELEMETRY_RATE_LIMIT
- TELEMETRY_BUDGET_EXCEEDED
- TELEMETRY_K_ANONYMITY_FAIL
- TELEMETRY_TTL_INVALID

Reason codes are stable-sorted lex.

---

## 11) Conduit Ecosystem Model

WeftEnd emits bounded telemetry streams.
Third parties collect, index, and present them.
WeftEnd does not store telemetry beyond TTL.

---

## 12) Commercial Access (optional)

- Access is an entitlement-capped read capability.
- Entitlements are short-lived and scope-limited.
- Aggregates can be sold without identity tracking.

---

## 13) Compatibility Notes

Telemetry must not bypass core caps or trust gates.
If a stream depends on evidence, that dependency must be explicit.

---

## 14) Example Payload (aggregate)

WindowAggregateV0
- windowStart: number
- windowSize: number
- regionBucket: string
- metrics:
  - sessionsActive: number
  - matchesStarted: number
  - matchesFinished: number
  - avgSessionMinutes: number
  - crashRate: number
  - modePopularity: { [mode]: number }

All maps must be stable-sorted when serialized.
