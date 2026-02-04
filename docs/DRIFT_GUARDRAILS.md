# docs/DRIFT_GUARDRAILS.md - WeftEnd Laws Extension (Anti-Drift)

Status: normative for all work that extends core/engine/runtime/devkit/cli.
This document must not conflict with:
- docs/PROJECT_STATE.md
- docs/weblayers-v2-spec.md
- docs/INTEGRATION_CONTRACT.md
- docs/FEATURE_ADMISSION_GATE.md

If any conflict is found, stop and write a Proposal. Do not patch around authority.

---

## 0) Purpose

Prevent drift. Lock the spine before adding surface features. Every change must tighten determinism,
explicit authority, and portal truth. If a change does not improve enforceable guarantees or developer
power, it does not belong.

---

## 1) Pillars Extension (additive)

P10 - Anchor First
- If an authoritative anchor is missing, it must be implemented before any dependent feature ships.
- Anchors are defined in docs/PROJECT_STATE.md. No alternate entry points.

P11 - Proof-Only Surface
- Anything shown in UI/portal must be derived from canonical, validated data.
- No raw payloads, secrets, tokens, or opaque errors in the portal.

P12 - No Silent Downgrade
- Any compatibility or legacy path must be labeled in the portal with explicit warnings.
- A block cannot claim Strict if it ran outside the membrane.

P13 - Determinism Gate
- All lists that influence hashes, signatures, grants, or portal ordering are stable-sorted.
- Canonical JSON is the only input for hashing/signing.

P14 - Explicit Power
- No ambient authority ever. Any new capability must be declared, gated, and test-pinned.

P15 - Fail Closed, Always
- Missing or ambiguous inputs are explicit denials with stable reason codes.

---

## 2) Change Gates (must pass before merge)

G0 - Tests Before and After
- Run npm test before editing and after edits. If tests fail, stop and fix.

G1 - Anchor Check
- If a change touches an anchor or depends on one, verify the anchor exists and is test-pinned.

G2 - Reason Code Discipline
- Any new reason code requires:
  - deterministic ordering rule
  - at least one unit test
  - portal visibility rule (proof-only)
- Oversize inputs must be explicit fail-closed reason codes (e.g., HOST_INPUT_OVERSIZE) and documented as non-retryable without reducing input.

G3 - New Evidence/Policy/Cap Types
- Any new evidence kind, policy rule, or cap must include:
  - a validator or verifier
  - deterministic tests
  - portal projection rules

G4 - Runtime Mode Changes
- Any new mode must include a membrane proof or explicit downgrade labeling.

---

## 3) Proof Obligations

Each non-trivial change must ship with deterministic tests that would fail if drift occurs.
Preferred proofs:
- golden fixtures with canonical JSON
- explicit stable ordering assertions
- negative tests for missing/invalid inputs

---

## 4) Documentation Rules

- Update docs when changing behavior, not after.
- If behavior conflicts with authority docs, write a Proposal instead of code.

---

## 5) AI and Automation Rule

- AI suggestions are allowed only as non-authoritative hints.
- AI output must never change canonical hashes, ordering, or trust decisions.
- If AI touches a gate, it must be audited like any other feature.

---

## 6) Security Invariants (must always hold)

- Strict mode only runs inside a hardened sandbox realm.
- The only I/O path is the capability door.
- Boundary messages are authenticated by planDigest + sessionNonce + message port.
- Portal truth is derived only from validated inputs and execution trace.

If any invariant fails, the system must refuse to execute and report deterministic reasons.
