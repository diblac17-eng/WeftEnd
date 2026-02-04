# PROGRAM_FLOW.md
WeftEnd — Program Story + Laws (WebLayers v2.6; Deterministic, Fail-Closed)

This document is both:
1) A readable story of how the program works end-to-end.
2) A binding constraint system for humans and AI. If code contradicts this doc, the code is wrong.

This document is subordinate to: weblayers-v2-spec.md, PROJECT_STATE.md, INTEGRATION_CONTRACT.md. If conflict: those win.

---

## Doc registry (normative + guidance)

Normative (must not be contradicted):
- `docs/LAWS_KEYS_AND_SECRETS.md`
- `docs/DRIFT_GUARDRAILS.md`
- `docs/STRICT_MEMBRANE.md`
- `docs/DOM_GATEWAY.md`
- `docs/BOUNDARY_HARDENING.md`
- `docs/FEATURE_ADMISSION_GATE.md`
- `docs/PRIVACY_PILLARS.md`
- `docs/TIER_MARKETS.md`
- `docs/DEVKIT_STRICT_LOAD.md`

Guidance (supporting contracts + workflows):
- `docs/PHASES_2_TO_COMPLETE_WORKPLAN.md`
- `docs/CLI_PUBLISH.md`
- `docs/CLI_IMPORT.md`
- `docs/CLI_MARKETS.md`
- `docs/DEMO_GOLDEN_PATH.md`
- `docs/DEMO_STEAM_LANE.md`
- `docs/TELEMETRY_STREAMS.md`
- `docs/LOCAL_TESTING.md`
- `docs/VISION_SCOPE_NEXT_STEPS.md`

## Developer End-to-End (Quick View)
Power requires proof; repairs leave scars.
1) Build a release (publish)
2) Verify a release (strict truth report)
3) Run in Strict (deny-by-default, proof-only caps)
4) Pulses (local, bounded, time-free)
5) Telemetry conduit snapshot (aggregate-only, k-floor)
6) Inspect with the harness (proof-only UI)
7) Recovery (explicit, scarred, provable)
Full walkthrough: `docs/DEV_END_TO_END.md`

## 0) The Prime Directive

### Purpose
Produce high-fidelity outputs from modular blocks, with:
- deterministic generation,
- explicit trust + capabilities,
- portable bundles,
- explainable provenance (portal overlay),
- refusal over guessing.

### Core Doctrine
**No step is “complete” unless its outputs can be reproduced byte-for-byte from its declared inputs.**

---

## 1) Immutable Pillars

P0 — Determinism  
Same inputs → same outputs. Determinism is not a preference; it is a requirement.

P1 — Fail-Closed  
Invalid, unknown, ambiguous, missing → deny/Err with explicit codes. Never “best effort.”

P2 — Explicit Capabilities  
No ambient authority. If it isn’t granted, it doesn’t exist.

P3 — Provenance First  
Every output is explainable: what node produced it, what inputs fed it, what evidence allowed it.

P4 — Anchors Are Sacred  
Exported signatures and named anchors do not drift. If ambiguous, write a Proposal instead of code.

P5 — Phase Law  
Do not implement Phase N+1 behavior until Phase N validates with fixtures.

P6 — Tests-First  
New behavior must ship with deterministic tests/fixtures proving it.

---

## 2) Canonical Artifacts (The Story Objects)

These are the only objects that advance through the pipeline. Everything else is derived.

A0 InputHtml  
- raw string as provided by user.

A1 DesignTree  
- normalized structural representation of content; no runtime decisions inside.

A2 GraphManifest  
- nodes + edges + resolved references; deterministic IDs; acyclic.

A3 TrustReport  
- evidence → grants → tier → allowExecute; fully explainable.

A4 ExecutionPlan  
- run order + denied nodes + capability budget; reproducible; hashable.

A5 RuntimeBundle  
- self-contained artifacts addressed by hash; no ambient fetch; portable.

A6 ExecTrace  
- recorded execution: calls, grants used, outputs, denials, hashes; deterministic trace rules.

A7 PortalModel  
- overlay data derived only from A2/A3/A6; no interpretive state.

---

## 3) Deterministic Keys and Ordering Laws (Global)

Wherever lists exist, they must be stable-sorted. No exceptions.

### Global stable sort keys (canonical defaults)
K0 Issues: (code, path, detail)
K1 Nodes: (nodeId)
K2 Edges: (fromId, toId, edgeType)
K3 Inputs within a node: (key, sourceNodeId, sourceOutputName)
K4 Grants: (capId, scope, constraintHash)
K5 Evidence: (kind, subjectId, issuer, digest)
K6 Plan run order tie-break: (topoIndex, nodeId)
K7 Bundle artifacts: (artifactType, artifactIdOrPath, digest)

### Canonical JSON law
All canonicalization uses the canonical JSON implementation. No substitutions, no "improvements."

### Canon parity fixture (TS/JS lock)
- Fixture: `tests/fixtures/canon_golden_v1.json`
- Guarantee: TS and JS canon outputs + digests are bit-identical.
- Run: `npm test`
- Failure implies: do not ship; hashes will diverge.
Canon is frozen. Any change is a versioned breaking change with an explicit migration story.

---

## 4) Error Code Doctrine (Global)

All failures are explicit, typed, and stable. Never throw unless a module is explicitly allowed.

Rules:
- Unknown input → Err(UNKNOWN_*)
- Invalid schema → Err(VALIDATION_*)
- Ambiguity → Err(AMBIGUOUS_*)
- Missing dependency → Err(MISSING_*)
- Denied capability → Err(CAP_DENIED)
- Non-deterministic attempt → Err(NONDETERMINISTIC_INPUT)

Errors must include:
- code
- path (where applicable)
- minimal detail (deterministic, no timestamps)

---

## 5) The Program Story (Step-by-Step)

Each step is a gate. You do not proceed until the laws pass.

---

### Step S0 — Boot (Create the world, but don’t act yet)

Intent:
- Construct the runtime boundary: ports + policies. Nothing executes here.

Inputs → Outputs:
- Inputs: Host environment
- Outputs: `ports`, `policy`, `sessionTraceHeader`

Variables:
- ports: capability interfaces
- policy: default-deny + constraints
- sessionId: trace correlation (not randomness)

Laws enforced here:
- L0 No ambient authority: only ports are allowed to touch the world.
- L1 Any nondeterministic host facts must be captured as declared inputs (in trace header) or forbidden.

Stop conditions:
- Missing required ports → Err(MISSING_PORT)

---

### Step S1 — Ingest (User provides HTML)

Intent:
- Capture content without interpretation.

Inputs → Outputs:
- A0 InputHtml → A0 InputHtml (stored) + ingest metadata

Variables:
- inputHtml

Laws:
- L2 Input capture is lossless.
- L3 Any preprocessing must be deterministic and declared.

Stop:
- None (ingest never “fixes” content; it only records).

---

### Step S2 — Import (HTML → DesignTree)

Intent:
- Convert raw HTML into a normalized design structure suitable for blockification.

Inputs → Outputs:
- A0 InputHtml → A1 DesignTree + issues

Variables:
- designTree
- importIssues

Laws:
- L4 Import is pure: same InputHtml → same DesignTree.
- L5 Ambiguity becomes issues; never guessed.
- L6 Output normalization is fixed (no time, no environment checks).

Stop:
- Fatal parse/unsupported structure → Err(IMPORT_UNSUPPORTED) or Err(IMPORT_INVALID)

---

### Step S3 — Validate + Canonicalize (DesignTree → Canon form)

Intent:
- Enforce schema, strip ambiguity, and produce a canonical representation.

Inputs → Outputs:
- A1 DesignTree → A1 DesignTree (canonical) + ValidationReport

Variables:
- canonDesignTree
- validationReport

Laws:
- L7 Canonical JSON rules apply.
- L8 Stable sorting applies to every list (see keys).
- L9 Fail-closed: if invalid → stop.

Stop:
- Any schema violation → Err(VALIDATION_FAILED)

---

### Step S4 — Blockify / Build Graph (DesignTree → GraphManifest)

Intent:
- Create deterministic block nodes and dependencies.

Inputs → Outputs:
- A1 canonDesignTree → A2 GraphManifest

Variables:
- nodes[]
- edges[]
- nodeIds

Laws:
- L10 Node identity is deterministic (derived from structure/content, not runtime).
- L11 Graph is a DAG; cycles are errors.
- L12 Deterministic ordering: K1 nodes, K2 edges, K3 inputs.
- L13 No hidden dependencies: all deps must appear as explicit edges.

Stop:
- Cycle detected → Err(GRAPH_CYCLE)
- Missing referenced node → Err(MISSING_NODE_REF)

---

### Step S5 — Trust Evaluation (Manifest → TrustReport)

Intent:
- Convert evidence into explicit permissions and execution eligibility.

Inputs → Outputs:
- A2 GraphManifest + evidence[] → A3 TrustReport

Variables:
- evidence[]
- grants[]
- tier
- allowExecute
- trustIssues[]

Laws:
- L14 Default deny: no evidence → no grants.
- L15 Evidence evaluation is deterministic + explainable (no fuzzy scoring).
- L16 Ordering keys: K5 evidence, K4 grants, K0 issues.
- L17 allowExecute is computed only from declared inputs and policy.

Stop:
- If policy requires signatures and evidence missing → Err(TRUST_INSUFFICIENT)
- If evidence ambiguous/conflicting → Err(AMBIGUOUS_EVIDENCE)

---

### Step S6 — Plan (Manifest + Trust → ExecutionPlan)

Intent:
- Produce the single allowed execution sequence and capability budget.

Inputs → Outputs:
- A2 GraphManifest + A3 TrustReport → A4 ExecutionPlan

Variables:
- runOrder[]
- deniedNodes[]
- capBudget

Laws:
- L18 Plan is reproducible; its hash is stable.
- L19 Topological order must be stable (K6 tie-break).
- L20 Nodes requiring denied/missing caps are excluded (record why).
- L21 No execution outside the plan.

Stop:
- If no runnable nodes and policy disallows empty run → Err(PLAN_EMPTY)

---

### Step S7 — Bundle (Plan → RuntimeBundle)

Intent:
- Make execution portable and tamper-evident.

Inputs → Outputs:
- A4 ExecutionPlan (+ artifacts) → A5 RuntimeBundle

Variables:
- bundle.artifacts[]
- bundle.digests[]
- bundle.signatures? (optional per phase)

Laws:
- L22 Bundle is self-contained: runtime performs no ambient fetch.
- L23 Everything is addressed by digest; mismatches are fatal.
- L24 Ordering keys: K7 artifacts.

Stop:
- Missing artifact → Err(MISSING_ARTIFACT)
- Digest mismatch → Err(DIGEST_MISMATCH)

---

### Step S8 — Runtime Execute (Bundle → Outputs + ExecTrace)

Intent:
- Execute exactly what’s allowed, with strict capability enforcement.

Inputs → Outputs:
- A5 RuntimeBundle → outputs + A6 ExecTrace

Variables:
- execContext
- capGuard
- outputs
- trace

Laws:
- L25 Every capability call is checked against grants (deny by default).
- L26 ExecTrace is deterministic given declared inputs.
- L27 Any nondeterministic host facts must be captured as explicit trace inputs or rejected.
- L28 Failure is recorded and stable-sorted in trace (K0).

Stop:
- Unauthorized cap call → Err(CAP_DENIED)
- Attempted nondeterminism → Err(NONDETERMINISTIC_INPUT)

---

### Step S9 — Portal Overlay (Trace + Reports → PortalModel)

Intent:
- Explain the run: provenance, denials, trust, and exact inputs.

Inputs → Outputs:
- A2 + A3 + A6 → A7 PortalModel (UI-ready)

Variables:
- provenanceByNode
- whyDenied
- hashLinks

Laws:
- L29 Portal derives only from recorded artifacts (no interpretation).
- L30 Portal ordering stable for all lists.

Stop:
- None (portal never “fixes”; it only explains).

---

## 6) AI Generation Guardrails (Binding Procedure)

When generating code, the assistant must obey this procedure.

### G0 — Contract First
Every code response begins by applying:
- Spec + PROJECT_STATE + integration contract as law.
- Anchors and phases as gates.
- Fail-closed.
- Tests-first.

### G1 — Work Order Required
No code changes without a Work Order defining:
- Phase
- Layer
- Target file path
- Allowed imports
- Anchors (exact signatures)
- Patch boundaries
- Proof obligations (tests and deterministic ordering keys)

If an anchor is missing/ambiguous:
- Produce a Proposal instead of code.

### G2 — Drift Prohibition
Never:
- rename exports
- reorder schemas
- “clean up” formatting
- touch unrelated files

### G3 — Determinism Prohibition
Never:
- add randomness
- read time/environment inside pure logic
- accept nondeterministic ordering (must stable-sort)

---

## 7) Proof Obligations (What must exist in tests)

Minimum fixture suite (golden, byte-for-byte):

T0 Canon JSON fixture: same object → same bytes  
T1 Validate fixture: invalid input fails with stable error ordering (K0)  
T2 Import fixture: HTML → DesignTree stable  
T3 Graph fixture: DesignTree → GraphManifest stable IDs + stable topo order  
T4 Trust fixture: evidence → grants stable; default deny  
T5 Plan fixture: stable run order; denied nodes recorded  
T6 Bundle fixture: digest addressing stable  
T7 Runtime fixture: CAP_DENIED and NONDETERMINISTIC_INPUT are enforced  
T8 Portal fixture: provenance stable and derived only from artifacts

---

## 8) Glossary (Short)

Deterministic:
- no hidden inputs, stable ordering, canonical serialization.

Fail-closed:
- refusal is the default; permission is explicit.

Artifact:
- an immutable object that can be hashed and reproduced.

Port:
- the only place the system touches the outside world.

---

## 9) Final Law

If a feature cannot be expressed as:
- an input artifact,
- a deterministic transformation,
- a validation gate,
- and a reproducible output,

then it does not belong in this phase.

---

## 10) Vision Guarantees (Binding)

These are not “nice to have.” They are the product’s identity. If a change violates one of these, it is rejected or deferred to a later Phase with an explicit Proposal.

### V0 — The Killer First Run (Developer Demo)
- A developer can paste HTML, press one button, and see:
  1) the page assembled from blocks,
  2) a visible DAG/provenance overlay,
  3) a deterministic rebuild when a block changes,
  4) a portable bundle that runs without a backend.

### V1 — Zero-Backend Operation
- The system must run fully offline once a `RuntimeBundle` exists.
- No implicit network fetches. Any remote content must be an explicit artifact with a digest and a policy decision.

### V2 — Block-Level Rebuild (The Core Selling Point)
- Editing a block only rebuilds its dependent nodes.
- Rebuild decisions are deterministic and explainable (visible in the Portal).

### V3 — Provenance Is Not Optional
- Every node’s output is traceable to:
  - inputs,
  - transforms,
  - evidence/grants,
  - exact digests/signatures (if enabled),
  - and execution events.
- The Portal must be derivable from recorded artifacts only.

### V4 — Determinism Over Convenience
- If something would introduce nondeterminism, it is:
  - either captured as an explicit declared input artifact,
  - or refused with `Err(NONDETERMINISTIC_INPUT)`.

### V5 — Trust Is Computed, Not Assumed
- Default deny stands everywhere.
- “Allow execute” is never a UI checkbox; it is a computed output of `TrustReport` under policy.

### V6 — Capability Control Is the Security Boundary
- Code cannot “reach the world” except through ports guarded by grants.
- Every denied capability call is:
  - blocked,
  - recorded,
  - and explainable in the Portal.

### V7 — Portability and Pinning
- Artifacts are addressed by digest.
- A bundle that validates today validates the same tomorrow (unless policy explicitly changes).
- When signatures are enabled (by Phase), they become part of the evidence chain, not a side-channel.

### V8 — Reuse Is a First-Class Outcome
- A block can be reused across pages/projects by reference to stable identity + digest.
- Ambiguous or missing package resolution is fail-closed (`PKG_AMBIGUOUS`, `PKG_MISSING`).

### V9 — The Story Must Match the Code
- Every pipeline step (S0–S9) must map to a real function/anchor, a type, and a deterministic fixture.
- If a step lacks an anchor, write a Proposal; do not “invent” glue code.

---

## 11) Artifact-to-Code Map (Binding)

This table prevents story drift. If a row cannot be pointed to in code, the implementation is incomplete.

> Notes:
> - “Anchor” means an exact exported signature that must not drift.
> - If your current code uses different names, keep the code names and adjust this table to match reality.
> - If an anchor does not exist yet, mark it “MISSING” and treat it as a Proposal gate.

| Artifact | Meaning | Type (TS) | Produced By (Anchor) | Validated By | Canon/Sort Law | Stored In Bundle |
|---|---|---|---|---|---|---|
| A0 InputHtml | raw user HTML | `string` | S1 Ingest (UI/devkit) | (none; capture only) | N/A | Optional (dev replay) |
| A1 DesignTree | normalized structure | `DesignTree` | **A1** `importHtmlToDesignTree(inputHtml, …) -> Result<DesignTree>` | `validateDesignTree(…)` (or `validate(…)`) | Canon JSON + stable list sort | Yes |
| A2 GraphManifest | nodes + edges + refs | `GraphManifest` | **A2** `buildManifestFromDesignTree(designTree, …) -> Result<GraphManifest>` | `validateGraphManifest(…)` + DAG check | K1/K2/K3 | Yes |
| A3 TrustReport | evidence→grants→tier | `TrustReport` | **A3** `evaluateTrust(manifest, evidence, policy, …) -> Result<TrustReport>` | `validateTrustReport(…)` | K5/K4/K0 | Yes |
| A4 ExecutionPlan | ordered run + denies | `ExecutionPlan` | `planExecution(manifest, trust, policy, …) -> Result<ExecutionPlan>` (Anchor recommended) | `validateExecutionPlan(…)` | K6 + K0 | Yes |
| A5 RuntimeBundle | portable run package | `RuntimeBundle` | `bundleRuntime(plan, artifacts, …) -> Result<RuntimeBundle>` (Anchor recommended) | `validateRuntimeBundle(…)` | K7 | Yes (it is the bundle) |
| A6 ExecTrace | recorded execution | `ExecTrace` | runtime executor `executeBundle(bundle, …) -> Result<{outputs, trace}>` (Anchor recommended) | `validateExecTrace(…)` | K0 (events/issues) | Optional (for audit/replay) |
| A7 PortalModel | overlay model | `PortalModel` | `derivePortalModel(manifest, trust, trace) -> PortalModel` | `validatePortalModel(…)` | stable sort for UI | No (derived) |

### Hard rule
- If `Type (TS)` cannot be pointed to in `src/core/types.ts`, it is not a real artifact type yet.
- If an Anchor does not exist, do not implement around it. Add the anchor first (or write a Proposal).

---

## 11.1) Runtime Loader Contract (Artifact Integrity)

This section is the runtime cross-exam. It is a hard contract for artifact load:

- Pre-sandbox check: the expected digest is verified before any untrusted execution.
- Mismatch behavior: emit Tartarus kind `artifact.mismatch` and deny execution.
- Rollback rule: only from known-good store entries for the same digest key; no heuristics, no clock ordering.
- No silent repair: every rollback emits Tartarus with reason codes `ARTIFACT_DIGEST_MISMATCH` and `ARTIFACT_RECOVERED`.
- If no known-good artifact exists, deny execution (fail closed).

### Artifact integrity mapping (stable)

| Condition | Reason code(s) | UI state | What user should do |
|---|---|---|---|
| Digest mismatch, no recovery | `ARTIFACT_DIGEST_MISMATCH` | QUARANTINE | Rebuild from trusted source. |
| Digest mismatch, recovered from known-good | `ARTIFACT_DIGEST_MISMATCH`, `ARTIFACT_RECOVERED` | ALLOW (RECOVERED) | Investigate tamper, then rebuild. |
| Artifact missing | `ARTIFACT_MISSING` | DENY | Provide the artifact or rebuild. |

---

## 12) Developer Experience Story (The Human Narrative, Bound to the Artifacts)

This is the minimum “developer journey” your system must support.

### DX0 — One-screen blockify loop
1) Developer pastes HTML → produces A0.
2) Click **Blockify** → produces A1 then A2 (with visible issues if any).
3) Overlay shows the DAG: nodes, edges, IDs, and per-node inputs.
4) Developer edits one block → only dependent nodes rebuild (A2/A4 delta visible).
5) Developer exports a `RuntimeBundle` (A5) and runs it offline.
6) Any denial (trust/caps) is explicit and clickable to its cause (A3/A6 → Portal).

### DX1 — Every denial is a teaching moment
- If something fails, the UI shows:
  - the exact error code,
  - the exact artifact step where it failed,
  - and the minimum action that would make it pass (add evidence, fix schema, grant cap, include artifact).

### DX2 — “No backend” must be demonstrable, not claimed
- The demo must run from local files (or equivalent) without network access once bundled.
- The trace must prove no ambient fetch occurred.

---

## 13) Fixture Map (Proof that Vision == Reality)

Each fixture ties a Vision Guarantee to an artifact gate.

- F0 Import fixture: A0 → A1 is stable (V4).
- F1 Graph fixture: A1 → A2 stable IDs + stable ordering (V2, V4).
- F2 Trust fixture: A2 + evidence → A3 default deny (V5).
- F3 Plan fixture: A2 + A3 → A4 stable topo + stable tie-breaks (V2, V4).
- F4 Bundle fixture: A4 → A5 digest addressing, no ambient fetch needed (V1, V7).
- F5 Runtime fixture: A5 enforces CAP_DENIED + records trace (V6).
- F6 Portal fixture: A2/A3/A6 → A7 derived-only provenance (V3).
