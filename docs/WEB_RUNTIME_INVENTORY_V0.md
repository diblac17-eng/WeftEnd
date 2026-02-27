# WEB_RUNTIME_INVENTORY_V0.md
Status: design contract for implementation. Not yet wired to a shipped CLI lane.

This document defines a deterministic runtime-script inventory artifact that can be
baselined and compared by WeftEnd to detect runtime drift (including polymorphic
script behavior that mutates on execution).

If this document conflicts with `docs/PROJECT_STATE.md`, `docs/INTEGRATION_CONTRACT.md`,
or `docs/PRIVACY_PILLARS.md`, stop and raise a proposal.

---

## 0) Purpose

Provide a bounded, privacy-clean, deterministic runtime evidence artifact for web
execution surfaces where static file analysis is not sufficient.

Core model:
- prevention controls reduce remote mutation risk (`CSP`, `SRI`, Trusted Types)
- runtime inventory records what executed
- WeftEnd baseline/compare turns runtime drift into explicit evidence

---

## 1) Non-goals

- No malware verdicts.
- No network reputation lookups.
- No telemetry upload or phone-home behavior.
- No raw script source retention.
- No timestamps, durations, or user identifiers.

---

## 2) Artifact Schema (v0)

Schema id:
- `weftend.webRuntimeInventory/0`

Required top-level fields:
- `schema`: `"weftend.webRuntimeInventory/0"`
- `schemaVersion`: `0`
- `captureMode`: `"strict_replay"` | `"live_observe"`
- `targetDigest`: deterministic digest of the declared target under test
- `runtimeSurface`: object (counts + policy evidence only)
- `scripts`: array of bounded script records (stable-sorted)
- `summary`: bounded aggregate counts
- `reasonCodes`: stable-sorted unique reason codes
- `truncation`: `{ status: "NONE" | "TRUNCATED", markers: string[] }`

Optional top-level fields:
- `policyDigest`: digest of active runtime-capture policy
- `bundleDigest`: digest of static artifact bundle used for capture
- `captureNonce`: optional opaque nonce (validated, never used for compare identity)

---

## 3) Script Record (bounded)

Each `scripts[]` item:
- `scriptId`: deterministic id (derived from normalized source locator + index)
- `sourceKind`: `"inline"` | `"external"` | `"blob"` | `"eval"` | `"function_ctor"` | `"timer_string"`
- `originClass`: `"self"` | `"third_party"` | `"unknown"`
- `sourceDigest`: digest of normalized captured source bytes (when available)
- `locatorDigest`: digest of normalized locator token (no raw URL/path)
- `integrityPresent`: `0 | 1`
- `integrityValid`: `0 | 1`
- `executedCount`: bounded integer
- `mutationObserved`: `0 | 1`
- `dynamicSinkFlags`: object of bounded integer counters:
  - `evalCount`
  - `functionCtorCount`
  - `setTimeoutStringCount`
  - `setIntervalStringCount`
  - `documentWriteCount`
  - `domScriptInjectionCount`

Forbidden in records:
- raw source text
- raw URLs
- cookies, tokens, storage values
- stack traces with host paths
- timestamps

---

## 4) Runtime Surface Summary

`runtimeSurface` includes deterministic policy posture:
- `cspPresent`: `0 | 1`
- `cspStrictEnough`: `0 | 1`
- `sriCoveragePercent`: integer (0-100)
- `trustedTypesEnforced`: `0 | 1`
- `remoteScriptCount`: integer
- `inlineScriptCount`: integer
- `dynamicExecutionCount`: integer
- `mutatingScriptCount`: integer

`summary` includes:
- `scriptTotal`
- `scriptUniqueDigestCount`
- `thirdPartyScriptCount`
- `sriMissingCount`
- `integrityMismatchCount`
- `mutationObservedCount`
- `dynamicSinkTotal`
- `boundedScriptCount`

---

## 5) Determinism Rules

1. Canonical JSON only for artifact digest and compare identity.
2. Sort `scripts` by `scriptId`, then `sourceDigest`, then `locatorDigest`.
3. Normalize missing values to explicit tokens:
- `NOT_AVAILABLE`
- `NOT_APPLICABLE`
- `NONE`
4. Bounded caps (v0 defaults):
- max scripts: 2048
- max reason codes: 64
- max string bytes per token field: 128
5. Truncation is deterministic:
- keep lowest stable sort order entries
- emit truncation markers

---

## 6) Privacy Rules

Hard bans:
- user identifiers
- hostnames/absolute local paths
- account/session ids
- timestamps/durations
- raw remote URLs

Allowed:
- digests
- bounded counts
- coarse source classes and policy flags

Violation behavior:
- fail closed with `WEB_RUNTIME_PRIVACY_FORBIDDEN`

---

## 7) Compare Policy (v0)

Baseline identity:
- compare by canonical digest of full runtime inventory artifact

Primary status:
- `SAME`: no drift buckets
- `CHANGED`: one or more drift buckets
- `BLOCKED`: policy threshold exceeded

Suggested drift buckets:
- `RUNTIME_SCRIPT_SET_CHANGED`
- `RUNTIME_SCRIPT_DIGEST_CHANGED`
- `RUNTIME_SOURCE_KIND_CHANGED`
- `RUNTIME_DYNAMIC_SINK_CHANGED`
- `RUNTIME_MUTATION_CHANGED`
- `RUNTIME_CSP_POSTURE_CHANGED`
- `RUNTIME_SRI_COVERAGE_CHANGED`
- `RUNTIME_TRUNCATION_CHANGED`

Suggested block conditions (default policy):
- any `integrityMismatchCount > 0`
- any new dynamic execution sink class appears
- any new `mutationObserved` script appears
- `cspStrictEnough` falls from `1` to `0`

Baseline transitions remain operator-mediated; never auto-accept.

---

## 8) Reason Codes (v0 minimum)

- `WEB_RUNTIME_SCHEMA_INVALID`
- `WEB_RUNTIME_BOUNDS_EXCEEDED`
- `WEB_RUNTIME_PRIVACY_FORBIDDEN`
- `WEB_RUNTIME_CAPTURE_UNSUPPORTED`
- `WEB_RUNTIME_CAPTURE_PARTIAL`
- `WEB_RUNTIME_POLICY_INVALID`
- `WEB_RUNTIME_POLICY_BLOCKED`
- `WEB_RUNTIME_SAME`
- `WEB_RUNTIME_CHANGED`

---

## 9) Capture Modes

`strict_replay`:
- deterministic harnessed execution
- fixed inputs and policy
- preferred mode for baselines

`live_observe`:
- real environment observation
- still deterministic formatting, but expected to drift more
- should not auto-promote to baseline without operator review

---

## 10) Implementation Notes (planned)

Planned CLI surface (not yet shipped):
- `weftend web-runtime capture <input> --out <dir> [--mode strict_replay|live_observe]`

Planned output files:
- `web_runtime_inventory_v0.json`
- `web_runtime_summary.txt`

Integration target:
- WeftEnd baseline/compare receipts and report card lanes, reusing existing deterministic compare semantics.

---

## 11) Test Obligations

1. Determinism:
- same runtime fixture input twice => identical artifact digest

2. Bounded behavior:
- oversized script set truncates deterministically and marks truncation

3. Privacy:
- forbidden fields cause fail-closed denial

4. Compare:
- controlled drift fixtures trigger expected bucket set and status

5. Policy block:
- integrity mismatch/dynamic sink mutation triggers `BLOCKED` under default strict policy
