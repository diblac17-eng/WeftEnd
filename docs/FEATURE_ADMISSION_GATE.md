# docs/FEATURE_ADMISSION_GATE.md - WeftEnd Flow Guardrail (No Tension Additions)

Status: normative.
Purpose: keep WeftEnd coherent. Prevent "security idea pileups" that add friction without enforceable value.

This is the rulebook for admitting any new feature, security technique, mode, evidence kind, cap, or market behavior.

---

## 0) The Spine (everything must attach here)

WeftEnd has one core flow. Features are only valid if they strengthen one or more steps without breaking others.

S1) Blockify -> deterministic Plan
S2) Evidence grammar -> verifier results (deterministic)
S3) Policy -> eligible caps (deterministic)
S4) Ariadne String -> planDigest binds meaning
S5) Runtime -> one door enforcement (deny-by-default)
S6) Portal -> proof-only truth projection (no lies)
S7) Tartarus -> append-only violations (actionable)

If a feature does not attach cleanly to one of S1-S7, it is out-of-scope.

---

## 1) Admission Test (5-line requirement)

Every proposed feature MUST ship with a FEATURE_INTENT block in its PR description and in a short doc snippet:

1) Prevents: one concrete attack or failure mode (named)
2) Spine hook: which step(s) S1-S7 it attaches to
3) Developer feel: one sentence describing the user-visible benefit
4) Cost: one sentence describing friction/perf/compat cost
5) Proof: one deterministic unit test + one portal-visible indicator

If any line is vague, the feature is rejected.

---

## 2) Allowed Reasons to Add a Feature

A feature is admissible only if it yields at least one of these outcomes:

A) New enforceable guarantee
- It changes what the runtime can actually prevent, deny, or quarantine.

B) New developer power
- It enables a new safe capability or a new compositional pattern.

C) Simplification
- It removes ad-hoc rules and replaces them with a single deterministic rule.

If it provides only "more information" (logs, warnings) without enforcement or developer power, it is rejected unless it replaces something more complex.

---

## 3) Hard Rejection Criteria (tension flags)

Reject a feature if it triggers any of these:

R1) Multiple truth sources
- Two subsystems compute "truth" differently without a deterministic reconciliation rule.

R2) Silent downgrade
- Any path that weakens security without prominent portal labeling.

R3) Ambient authority leak
- Untrusted code can access privileged APIs outside caps.

R4) Non-determinism
- Outputs depend on time, randomness, iteration order, concurrency race, or environment quirks without explicit normalization.

R5) Secret leakage risk
- Portal/telemetry/logs can expose secrets, args, tokens, payloads, URLs with queries.

R6) Compatibility tax without a tier/mode escape hatch
- Breaks common code patterns without offering Compatible/Legacy modes with explicit UNGOVERNED labeling.

R7) State advance on partial knowledge
- Any flow that advances baseline/trust/release state without a full verification pass is rejected.

---

## 4) Determinism Contract (mandatory for all new logic)

All new logic that influences:
- hashes
- eligibility decisions
- portal display ordering
- denial reasons
MUST define stable ordering rules and must be test-pinned.

Rules:
- Arrays are stable-sorted + unique where order impacts meaning.
- Reason codes are stable-sorted, deterministic.
- Canonical JSON used for hashing inputs only (no secrets).

---

## 5) "Portal Can't Lie" Contract (mandatory for all new features)

Every feature must define:
- what proof-only data is rendered (digests/ids/status/reasonCodes)
- what must never be rendered (payload bodies, secrets, tokens, raw args)
- what happens on failure (UNVERIFIED / DOWNGRADED) with explicit reasons

If a feature cannot be rendered proof-only, it must not be rendered at all.

---

## 6) Minimal UX rule (security must feel like capability, not punishment)

A denial must always present:
- a single primary reason (first reason code) and
- a single primary remedy (enum)
and only then additional details.

Remedy enums are preferred over prose:
- PROVIDE_EVIDENCE
- DOWNGRADE_MODE
- MOVE_TIER_DOWN
- REBUILD_FROM_TRUSTED
- CONTACT_SHOP
- NONE

---

## 7) Merge Gate (PR checklist)

A PR is mergeable only if it includes:

- [ ] FEATURE_INTENT block (5 lines)
- [ ] Touches the correct "owner file set" for its technique (see TECHNIQUE_FILE_MAP)
- [ ] Adds/updates deterministic tests that would fail if drift occurs
- [ ] Portal truth updated (or explicitly unchanged) with proof-only rule satisfied
- [ ] Any downgrade is labeled prominently
- [ ] No new dependencies unless justified by a new enforceable guarantee
- [ ] No changes that weaken validation to "make tests green"

---

## 8) The one-line principle

If it doesn't improve enforcement truth or developer power, it doesn't belong.
