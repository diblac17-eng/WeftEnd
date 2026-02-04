# docs/PHASES_2_TO_COMPLETE_WORKPLAN.md — WeftEnd / WebLayers v2.6 (Non-authoritative build plan)

Status: guidance only. This file must not conflict with:
- `docs/weblayers-v2-spec.md`
- `docs/PROJECT_STATE.md`
- `docs/INTEGRATION_CONTRACT.md`

If conflict is found, stop and write a Proposal. Do not “patch around” authority.

---

## 0) Why this file exists

Codex and humans drift for the same reason: the work is bigger than short-term memory.

This page keeps the program deterministic:
- it expands Phase 2–4 into concrete workstreams
- it repeats the non-negotiables (pillars + laws) in execution-friendly form
- it defines “stop conditions” so bad code does not quietly ship

This is not new design. It is the continuation of the existing spine.

---

## 1) Pillars that must remain true to the end of the project

P1 — No ambient authority  
Blocks never receive implicit access to network/storage/crypto/time/randomness/secrets/session/DOM/fs/process.

P2 — Capabilities are the only power  
All privileged actions flow through a host kernel surface built from **grants**.

P3 — Trust gates execution and power  
Trust logic decides `allowExecute`, tier, eligible grants, and denial reasons. Runtime enforces it.

P4 — Determinism is mandatory  
Canonical JSON + stable sort rules apply to anything that can be hashed, signed, compared, or fixture-tested.

P5 — Publish ≠ trust  
Publishing never grants power. Policy grants power.

P6 — Fail closed  
Missing/unclear/invalid => deny execution and/or deny grants with explicit reasons.

P7 — Trust evidence is append-only and bindable  
Evidence is carried only in stable envelopes with an evidenceId/digest that prevents swapping.

P8 — Portal cannot lie  
Portal is a pure projection from manifest + verified evidence + verifier outputs + plan digest.
Failure must render as `UNVERIFIED` with reason codes.

P9 — Cycles only “over time” (reactor split)  
The Outer DAG remains acyclic. Continuous loops live in the reactor boundary and consume approved snapshots.

---

## 2) Laws for all future code generation (Codex guardrails)

L1 — Respect the layer import graph (hard law)  
core → ports → engine → runtime/devkit/cli → tests

L2 — Boundary types live only in `src/core/types.ts`  
No local copies. Additive only unless a Proposal.

L3 — Public/pure anchors return `Result<T, E[]>` and never throw  
Runtime may throw only for programmer errors; policy outcomes are data.

L4 — All arrays with security/fixture impact are deterministically ordered  
Use canonical JSON tie-breakers; never rely on JS map order.

L5 — Reason codes are stable, minimal, and ordered deterministically  
When you add a new reason code, also add:
- ordering rule (code, then nodeId, then path, then evidenceId)
- a fixture or unit test pinning the order

L6 — Unknown required evidence fails closed  
If policy requires a kind that has no verifier, the cap is **not eligible**.

L7 — “Suggested” is not “granted”  
Heuristics may recommend block surfaces/anchors, but final admission is a deterministic fit check.

---

## 3) Phase 2 (Pure logic) — complete the deterministic kernel

Phase 2 ends when:
- TypeScript compiles
- unit tests pass
- fixtures pin deterministic outputs
- no side effects exist in core/engine

### 3.A Engine: graph correctness + stable order
Target: `src/engine/graph.ts`

Deliverables:
- DAG validation:
  - detect cycles
  - detect dangling deps
  - detect duplicates
- stable topo order
- project graph across pages (if implemented) is stable-sorted

Proof obligations:
- cycle fixture yields `CYCLE_DETECTED` deterministically
- topo order stable across object-key reordering and insertion order differences

Stop condition:
- Any graph operation that depends on JS iteration order is a hard stop.

---

### 3.B Engine: Blockifier v1 implementation (from Appendix A)
Target: `src/engine/build.ts` (or `src/engine/blockifier.ts` if you split, but keep imports legal)

Deliverables (exactly matching spec):
- normalize DOM deterministically
- produce Block Plan:
  - nodePath anchor (1-based element indices)
  - stable blockId = hash(pageSeed + nodePath + rootTag + firstStableAttrHint)
  - deterministic naming rules
- dependency extraction:
  - CSS/JS/assets: missing inputs are explicit errors (fail-closed)
  - network-attempt detection is deterministic (string/AST heuristics allowed, but must be stable)

Proof obligations:
- given the same HTML paste, produced plan is byte-identical (canonicalized)
- missing external CSS/JS/assets yields stable error list order
- “sealed / warn / missing” statuses are deterministic

Stop condition:
- If block boundary decisions can vary between runs, Phase 2 is not done.

---

### 3.C Engine: docking surfaces + anchors (compatibility sockets)
We assume blocks have real surfaces and anchors.

Targets:
- Types: `src/core/types.ts` (additive)
- Logic: `src/engine/dock.ts` (pure)
- Tests: `src/engine/dock.test.ts` or equivalent

Minimum types to lock (names may differ, semantics must match):
- `DockAnchor`:
  - `anchorId: string` (namespaced stable id)
  - `shapeHash: string` (hash of canonical shape contract)
  - optional `version`, `notes`
- `SurfaceDescriptor`:
  - `enabledCaps: string[]`
  - `deniedCaps: string[]`
  - `dockAnchors: DockAnchor[]`
- `RequirementsProfile`:
  - `needsCaps: string[]`
  - `needsAnchors: { anchorId: string; shapeHash: string }[]`
  - optional `exportsShapeHash`
- `DockFitResult`:
  - `ok: boolean`
  - `reasonCodes: string[]` (stable)
  - `missingCaps: string[]` (sorted)
  - `deniedCaps: string[]` (sorted)
  - `missingAnchors: string[]` (sorted)
  - `mismatchedAnchors: string[]` (sorted)

Pure admission function:
- `canDock(requirements, surface) -> DockFitResult`
Rules:
- `needsCaps ⊆ enabledCaps`
- `needsCaps ∩ deniedCaps = ∅`
- every required anchor exists and `shapeHash` matches
- all outputs sorted deterministically

“Learning” rule (allowed, but constrained):
- heuristics may propose candidate surfaces
- proposals never bypass `canDock`
- proposals are not inputs to hashing/trust decisions

Proof obligations:
- identical inputs yield identical `DockFitResult`, including order of reasonCodes
- adding irrelevant caps/anchors does not change result ordering

Stop condition:
- If docking can “sometimes work” without a deterministic proof, it is not docking.

---

### 3.D Engine: trust grammar completion (evidence + verifiers + evidence⇒caps)
Targets:
- Types already exist in `src/core/types.ts` (EvidenceRecord / VerifyResult / EvidenceExpr)
- New logic:
  - `src/engine/evidence.ts` (registry + verification orchestration; pure)
  - `src/engine/trust.ts` (policy evaluation; pure)

Deliverables:
1) Verifier registry
- keyed by EvidenceKind
- deterministic evaluation order:
  - evidence records sorted by `(kind, issuer, subject.nodeId, subject.contentHash, canonical(payload))`
- unknown kind behavior:
  - if required by policy => fail-closed for that cap’s eligibility
  - if not required => keep as “unverified evidence” for portal display

2) Deterministic verifier interface
- `verify(record, context) -> EvidenceVerifyResult`
- no side effects
- same input => same output, including reason ordering
- verifier identity + version recorded

3) Policy: evidence ⇒ eligible caps
- Evaluate `CapEvidenceRequirement.requires` (EvidenceExpr) deterministically
- Stable evaluation rules:
  - for `allOf/anyOf`, evaluate children in canonical order of their canonical JSON representation
  - short-circuit is allowed only if it is deterministic (same order always)
- Result must include:
  - which caps are eligible due to evidence
  - which failed, and why (reason codes)

Proof obligations:
- EvidenceExpr evaluation is stable regardless of authoring order
- Unknown required kind fails closed
- reasonCodes are ordered deterministically

Stop condition:
- If adding a new evidence kind requires kernel changes, Phase 2 is broken.

---

### 3.E Key lifecycle as first-class evidence (`key.status.v1`)
Targets:
- Types: `src/core/types.ts` (already has a recommended normalizedClaims shape; keep/extend additively)
- Logic: `src/engine/verifiers/key-status.ts` (or part of trust engine, but keep it pure)
- Tests: `src/engine/verifiers/key-status.test.ts`

Deliverables:
- A deterministic verifier that consumes either:
  - explicit key status evidence payloads, or
  - deterministic context provided in `EvidenceVerifyContext.extra`
- Output normalizedClaims at least:
  - `keyId`, `status`, optional validity window markers, `issuer`, `emergencyDisabled` flags
- Signature acceptance rule in trust logic:
  - if policy requires `key.status.v1`, signature evidence must be rejected unless key is eligible (active, not disabled/revoked/expired)

Proof obligations:
- same evidence + context => same key status claims
- rejection reasons stable ordered (e.g., `KEY_REVOKED`, `KEY_EXPIRED`, `KEY_DISABLED`)

Stop condition:
- If key lifecycle is “doc text” only, privileged caps are not safe.

---

### 3.F Anti-rollback + transparency hooks (pure rules)
Targets:
- `src/engine/trust.ts` or `src/engine/release-chain.ts` (pure)
- optionally verifiers: `antiRollback.ok`, `log.inclusion.v1`, `witness.quorum.v1`

Deliverables:
- ReleaseChain validation:
  - continuity checks by `sequenceNumber` and `previousHash`
  - do not use timestamps for ordering decisions
- policy primitive:
  - allow policies to require `antiRollback.ok` or `log.inclusion.v1` for elevated caps

Proof obligations:
- old-but-signed artifacts fail when antiRollback requirements exist
- witness requirement fails closed

Stop condition:
- If rollback defense depends on host time or mutable state inside engine, stop.

---

### 3.G Portal model (pure derivation contract)
Targets:
- Types: add `PortalModel` to `src/core/types.ts` (if not present yet)
- Logic: `src/engine/portal.ts` (pure)
- Tests: fixture pins portal outputs

Deliverables:
- `PortalModel` must be derivable only from:
  - manifest
  - evidence records + verify results
  - trust result + plan digest
- Portal rendering semantics:
  - nodes/caps must be labeled `VERIFIED` or `UNVERIFIED`
  - when unverified, show reason codes (stable order)
- All portal lists stable-sorted deterministically (by nodeId, then capId, then evidenceId)

Proof obligations:
- identical inputs => identical PortalModel JSON
- swapping evidence payloads without matching evidenceId changes PortalModel (swap attack prevented)

Stop condition:
- If portal uses any data not committed by manifest/evidence/plan, it can lie. Stop.

---

## 4) Phase 3 (Runtime + Devkit + CLI) — enforce what Phase 2 decided

Phase 3 ends when:
- runtime denies what engine denies
- runtime grants only what engine grants
- devkit can import an HTML page and show the portal overlay with proofs

### 4.A Runtime: capability kernel + sandbox host
Targets: `src/runtime/*`

Deliverables:
- capability kernel injects only granted functions
- deny-by-default enforcement for:
  - network
  - storage
  - crypto
  - time/randomness (only via ports and only if granted)
  - identity (only via `id:*` and only in origin.exec)
- execution tier enforcement:
  - edge.exec and cache.global must not expose origin-only ports
- enforcement telemetry:
  - denied calls emit diag events with reason

Stop condition:
- Any “silent allow” is a breach. Deny with reason.

---

### 4.B Devkit: the “button” experience (Blockify → Seal → Build)
Targets: `src/devkit/*`

Deliverables:
- HTML paste/import UI
- run Blockifier v1, show:
  - blocks, sizes, nodePath, stable IDs
  - dependencies
  - status checklist (sealed/warn/missing)
- missing-input workflow:
  - paste CSS/JS/assets bytes
  - remain fail-closed until present
- portal overlay view:
  - DAG graph and per-block trust/grants/tier
  - unverified evidence displayed with reason codes

Stop condition:
- If devkit displays trust as “green” without showing evidence + verifier outputs, it becomes trust theater.

---

### 4.C CLI: publish/build artifacts + hashing + signing
Targets: `src/cli/*`

Deliverables:
- build:
  - compute content hashes using canonical JSON rules
  - produce publishable BlockPackage and PagePackage
- sign:
  - produce signature evidence (sig.* records)
  - never embed private keys in published artifacts
- store/cache:
  - local content-addressed store for artifacts (minimal)
- release chain:
  - append ChainStamp with monotonic sequence + previousHash

Stop condition:
- If hashing uses anything other than canonical JSON, signatures will become meaningless. Stop.

---

### 4.D Reactor service boundary (gaming/streaming option)
Targets: `src/ports/reactor-port.ts` + runtime implementation

Deliverables:
- runtime implements reactor loop consuming ApprovedSnapshot (pinned artifacts + compiled plan/grants/constraints)
- reactor outputs telemetry/data blocks only (no authority expansion)
- safe update boundaries (tick boundary)

Stop condition:
- Reactor must never be allowed to request new caps beyond the compiled plan.

---

## 5) Phase 4 (Tests + Fixtures) — prove determinism and enforcement

Phase 4 ends when:
- golden fixtures pin:
  - blockify plan from HTML paste
  - trust/grants/tier outcomes
  - portal projection outputs
  - runtime enforcement (CAP_DENIED) and denial reasons

Minimum fixture set:
1) HTML fixture (small but realistic)
- produces stable block plan + stable block IDs + stable deps list
2) Trust fixture
- same manifest, different evidence sets:
  - show caps become eligible only when evidence requirements satisfied
  - unknown required evidence fails closed
3) Portal fixture
- verifies portal displays VERIFIED vs UNVERIFIED with reason codes
4) Runtime fixture
- block attempts denied cap => CAP_DENIED with stable error
5) Release chain fixture
- out-of-order sequence => deterministic failure

Stop condition:
- If a test is flaky, it is a determinism breach; fix determinism, not the test.

---

## 6) “Definition of complete” (minimum shippable WeftEnd demo)

Complete (v1) means:
- A user can paste/import a static HTML page
- WeftEnd blockifies it deterministically
- The UI shows missing inputs and refuses to “seal” until they are provided
- The engine produces a manifest + plan + portal model deterministically
- The runtime enforces allowExecute + caps exactly as the engine decided
- The portal overlay proves:
  - DAG composition
  - provenance by contentHash
  - evidence envelopes and verifier results
  - eligible caps derived from evidence requirements
  - UNVERIFIED states are explicit and explained

Everything beyond that is iteration, not foundation.

---

## 7) Proposal template (when you must stop)

Title: Proposal — <short summary>

1) Conflict detected:
- which authoritative doc(s) conflict
- exact section headers and the mismatch

2) Why it matters (security/determinism/compatibility)

3) Options:
- A) additive change
- B) breaking change (requires migration)
- C) defer (with explicit risk)

4) Recommended path + required tests/fixtures

No code should be written until the Proposal is accepted.
