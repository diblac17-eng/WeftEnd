# VISION_SCOPE_NEXT_STEPS.md - WeftEnd v2.6 (Vision-aligned execution map)

Status: guidance. This document must not conflict with:
- docs/weblayers-v2-spec.md
- docs/PROJECT_STATE.md
- docs/INTEGRATION_CONTRACT.md
- docs/DRIFT_GUARDRAILS.md
- docs/PRIVACY_PILLARS.md
- docs/TELEMETRY_STREAMS.md
If conflict is found, stop and write a Proposal.

---

## 0) Purpose

Lock the vision, scope decisions, and next steps so ongoing work stays inside:
- determinism
- fail-closed enforcement
- proof-only portal truth
- production security requirements

This is not a new spec. It is a scoped execution map aligned to the spine.

---

## 1) Vision (North Star, restated)

WeftEnd blockifies the web into publishable portals where trust, provenance,
and capability grants are visible and enforceable. The system is deterministic,
fail-closed, and portable across environments.

---

## 2) Scope Decisions (non-negotiable)

D1 - Anchor-only pipeline  
All outputs (bundle, manifest, portal) are derived from A0-A7 anchors only.
No alternate assembly paths. If an anchor is missing, build it first.

D2 - Determinism is the product  
Canonical JSON and stable sorts are mandatory for any hashed, signed,
or portal-visible data. No ambient or order-dependent behavior.

D3 - Trust gates execution and power  
Publishing never grants power. Policy + evidence decide allowExecute,
capability grants, and tier.

D4 - Proof-only portal  
Portal and diagnostics never expose secrets or raw payloads.
Only canonical, validated facts and reason codes may surface.

D5 - Strict mode truth  
Strict claims require strict executor boundaries. Otherwise the portal
must label the downgrade (compatible/legacy) with explicit warnings.

D6 - Production crypto only  
Demo crypto is dev-only. Production release paths require a real CryptoPort
or must fail closed.

D7 - Telemetry is a conduit, not storage  
Streams are append-only, TTL-limited, pull-based, aggregate-only by default,
and capability-gated (see docs/TELEMETRY_STREAMS.md).

D8 - Market is protocol + stores  
The market protocol is canonical. Stores are implementations that index and
exchange blocks, but they never override trust, policy, or receipts.
Markets verify artifacts and receipts, but do not collect or embed user behavior
inside WeftEnd artifacts (no tracking by default).

---

## 3) Production Security Grade (definition)

WeftEnd may claim production security grade only when all items below are met.
If any item is missing, the system must explicitly label itself as non-production.

Core requirements
- Real CryptoPort with signature verification and key management.
- Release manifests are signed, verified, and bound to planDigest and block set.
- Strict runtime boundary enforced for strict mode (no ambient authority).
- Secret Zone and redaction pipeline are enforced and test-pinned.
- Deterministic evidence verification with stable reason codes.
- Fail-closed behavior for any ambiguity or missing inputs.

Supply-chain and build integrity
- Reproducible builds or build attestations with verifier evidence.
- Key status, key transparency, and witness quorum evidence for high-tier caps.
- Anti-rollback evidence validated and enforced.

Operational hardening
- Budget and rate limits enforced for bundles and telemetry.
- Redteam suites and adversarial tests are green.
- Release and policy upgrades are audited and reversible with receipts.

No claims of production security are allowed until these conditions are met.

---

## 4) Market model (protocol plus stores)

Protocol baseline (core)
- Pointer format and release manifest are the unit of distribution.
- Install flow validates manifest, evidence, and policy before use.
- Tier flow only moves down (never up) without explicit evidence.
- Receipts are deterministic and proof-only.

Store responsibilities (implementation)
- Index and serve market pointers and manifests.
- Provide discovery without granting authority.
- Enforce takedowns and bans via signed evidence and receipts.
- Never bypass policy or trust gates.

Non-goals
- No store-side execution authority.
- No silent upgrades or undisclosed policy changes.

---

## 5) Next steps (work orders aligned to pillars)

Work Order 1 - Production crypto and signing gate
Deliverables
- Real CryptoPort implementation (ed25519 or p256) and key allowlist support.
- Release manifest signing and verification enforced at runtime.
- Demo crypto blocked by default in all publish paths.
Proof
- Unit tests for signature validation and failure modes.
- End-to-end publish/import tests with real signatures.
Stop condition
- Any release path that can ship without valid signatures.

Work Order 2 - Strict runtime enforcement completeness
Deliverables
- Strict executor boundary hardening across web and server targets.
- Explicit downgrade labeling in portal for any non-strict run.
- Capability gate tests for secret, network, and storage caps.
Proof
- Strict membrane tests for denied caps and ambient access.
- Portal warnings for compatible/legacy runs are deterministic.
Stop condition
- Any strict claim outside strict boundary.

Work Order 3 - Supply-chain evidence and verifier packs
Deliverables
- Verifier Pack format with deterministic ordering contract tests.
- Key status, key transparency, and witness quorum verifiers in production mode.
- Anti-rollback and build attestation evidence flows.
Proof
- Deterministic verifier outputs and reason ordering fixtures.
Stop condition
- Any high-tier cap granted without required evidence.

Work Order 4 - Market protocol v0 + store interface
Deliverables
- Install pointer format and receipt flow.
- Deterministic store interface for listing, resolve, admit, and revoke.
- Tier flow rules enforced and test-pinned.
Proof
- Market tests for allowlist/takedown/ban receipts.
Stop condition
- Any store action that bypasses policy or trust gates.

Work Order 5 - Telemetry conduits v0
Deliverables
- Telemetry journal and chunk types with validators.
- Capability gates and budgets for publish/read.
- Privacy enforcement (aggregate-only, k-anonymity, TTL).
Proof
- Tests that reject identifiers, high-cardinality fields, and low coverage.
Stop condition
- Any telemetry emission that can identify individuals by default.

Work Order 6 - Portal truth and developer usability
Deliverables
- Provenance diff and policy diff views (proof-only).
- Capability request flow with explicit missing evidence reasons.
- Deterministic reason code mapping across trust, tartarus, and portal.
Proof
- Fixtures for portal projections and reason ordering.
Stop condition
- Any portal output not derivable from validated inputs.

Work Order 7 - Production readiness gate
Deliverables
- Threat model and security checklist.
- Deterministic redteam suite coverage and CI gating.
- Release signing and verification integrated in all tooling.
Proof
- All tests and redteam suites green on clean builds.
Stop condition
- Any release without auditable evidence or signatures.

Work Order 8 - Non-tracking privacy enforcement (identity/time/receipts)
Deliverables
- Extend privacy guardrails to forbid stable identifiers (user/device/account IDs, IPs, UAs) in core truth artifacts.
- Enforce "no time in core truth" (no wall-clock timestamps or durations in manifests, plans, evidence, portal).
- Define ReceiptSummaryV0 as a bounded privacy budget (counts, reason codes, digests only).
- Add explicit export-only receipt workflow (local-first by default, explicit export action).
- Ensure any continuity tokens are ephemeral and non-exported by default.
Proof
- Privacy guardrails tests for forbidden fields, time fields, receipt oversize, and untrusted strings.
- Verify/portal shows privacy violations as strict failures with deterministic reason codes.
Stop condition
- Any core artifact can carry stable identifiers or timestamps without a privacy failure.

Work Order 9 - Pulse checkpoints and receipt fast-path
Deliverables
- PulseRecordV0 (publish/load/cap/exit) bound to planDigest + pathDigest with stable sequence numbers.
- ReceiptSummaryV0 binds pulse digests and cap decisions for fast verification.
- Verify supports "cheap path" when receipt binds current artifacts and policy digest.
Proof
- Deterministic pulse digesting and receipt binding tests.
- Tamper tests: pulse/receipt mismatch fails closed with stable reason codes.
Stop condition
- Any fast-path bypass that skips manifest/artifact verification or policy digest binding.

Work Order 10 - Export + telemetry lane v0 (opt-in, non-tracking)
Deliverables
- Explicit export command that produces a bounded ReceiptPackageV0 (verify report subset + receipt summary + pulses).
- Preview-before-apply workflow with deterministic, reviewable output.
- Local-only telemetry aggregates (k-anonymity floor, aggregate-only, no identifiers).
- Portal warning when telemetry caps are granted (aggregate-only vs fine-grained).
Proof
- Export determinism tests and preview/apply parity fixtures.
- Telemetry k-floor enforcement tests and identifier rejection.
- Portal warning fixtures for telemetry-enabled states.
Stop condition
- Any export or telemetry output that includes identifiers, timestamps, or unbounded strings.

Work Order 11 - Shadow Audit lane v0 (optional module)
Deliverables
- MatchEventChunkV0 + MatchStreamJournalV0 (bounded, hash-chained, TTL, no wall-clock).
- Ephemeral-only identities in match records (no stable user/device IDs).
- Shadow audit verifiers that emit proof-only receipts and Tartarus records.
- Capability gates for publish/read and portal warnings for telemetry risk.
Proof
- Determinism fixtures for chunk digests and audit receipts.
- Privacy tests for forbidden fields and aggregate-only export defaults.
Stop condition
- Raw event export or stable identifiers allowed without explicit high-risk caps.

Work Order 12 - Explicit recovery lane (verify + recover, no silent correction)
Deliverables
- Deterministic RecoveryPlanV0 and RecoveryReceiptV0 (explicit, bounded, proof-only).
- recover restores only bytes that match manifest digests; never edits the manifest.
- Atomic writes + fsync where applicable; fail closed with stable reason codes.
Proof
- Tamper/missing artifacts produce stable recovery plans and receipts.
- recover --apply restores and strict verify passes, while preserving ARTIFACT_RECOVERED.
Stop condition
- Any implicit "correction" without explicit recovery receipts or stable reason codes.

---

## 6) How we continue from here

All new work must:
- state the anchor it extends
- add deterministic tests or fixtures
- include reason codes and portal projection rules
- preserve fail-closed behavior

This keeps the scope aligned to the vision and prevents drift.
