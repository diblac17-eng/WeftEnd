# WeftEnd (WebLayers v2.6) — Integration Contract (Shared I/O + Pillars + Laws)

This document is the **cross-section anchoring layer**.
Every worker chat must treat this as **read-only law**.

If any worker output conflicts with `docs/PROJECT_STATE.md` or `docs/weblayers-v2-spec.md`, stop and write a Proposal. This contract must not conflict with either.

---

## 1) Vocabulary

- **Layer**: core | ports | engine | runtime | devkit | cli | tests
- **Anchor**: a frozen public entrypoint (signature + semantics must not drift)
- **Boundary type**: any type that crosses section/layer boundaries (must live in `src/core/types.ts`)
- **Determinism anchor**: canonical JSON + stable ordering rules (hash/signature correctness depends on this)
- **Fixture**: golden test that pins exact outputs and error ordering

---

## 2) Layer Import Graph (Hard Law)

- core: TS/stdlib only
- ports: may import core only
- engine: may import core + ports
- runtime/devkit/cli: may import core + ports + engine
- tests: may import all

Any import outside this graph is illegal.

---

## 3) Shared I/O Law: Single Source of Truth

### 3.1 Boundary types live only in Core
- All shared schemas must be declared in `src/core/types.ts`.
- No section may define “local copies” of boundary types.
- If a new shared type is needed, it must be added to Core and then imported.

### 3.2 Boundary functions use Result, never throw
- Public/pure anchors return `Result<T, E[]>` (error arrays).
- Runtime may throw only for programmer errors; policy/validation outcomes are data (Result / denied outputs).

### 3.3 Fail closed
If anything is missing/unclear/invalid:
- Engine returns `Err([...])` with stable codes and stable ordering.
- Runtime denies execution and/or denies capability use with explicit reasons (no silent success).

---

## 4) Determinism Contract (Hard Law)

### 4.1 Canonical JSON
All hashing/signing/planHash/manifestHash/trustHash must be computed over **canonical JSON**:
- canonical JSON implementation is defined in `docs/PROJECT_STATE.md` and must be copied verbatim into `src/core/canon.ts`.
- no alternative stringify is permitted for trust-relevant hashes.

### 4.2 Stable ordering (minimum set)
Any array that affects hashing, signatures, or golden fixtures must be stable-sorted deterministically:
- nodes by `id`
- dependencies by `(id, role)`
- capabilityRequests by `(capId, canonical(params))`
- capabilityGrants by `(capId, canonical(params))`
- trust nodes by `nodeId`
- plan nodes by `nodeId`
- blockPins by `(nodeId, contentHash)`

Tie-breakers must be explicit (lexicographic on ids/roles/hashes).

### 4.3 Error ordering
Error arrays must be deterministically ordered (e.g., by `code`, then `nodeId`, then `path`).
Never rely on JS object/map iteration order.

---

## 5) Canonical Identity Law

### 5.1 NodeId grammar is fixed (no new prefixes)
Strict forms:
- page:/path
- block:<name> or block:@publisher/name
- svc:<name> or svc:@publisher/name
- data:<name> or data:@publisher/name
- priv:<name>
- sess:<name>
- asset:<name>

No new prefixes. Use naming under existing prefixes (e.g. `block:layout/...`).

### 5.2 PackageRef locator law
`PackageRef.locator` MUST equal the target nodeId string.
Resolution is strict:
- match by `pkg.nodeId === ref.locator` AND `pkg.contentHash === ref.contentHash`
- missing => PKG_MISSING
- same nodeId with different hashes present => PKG_AMBIGUOUS

Runtime does **not** ambient-fetch packages.

---

## 6) Power & Security Contract (Hard Pillars)

### 6.1 No ambient authority
Blocks never receive direct access to:
network, storage, crypto, time, randomness, secrets, session, DOM, FS, process.

### 6.2 Capabilities are the only power
All privileged actions flow through a host kernel surface.
Runtime injects `cap` containing ONLY granted functions.
Ungranted call => `CAP_DENIED` + diag event.

### 6.3 Trust gates execution and power
Engine decides:
- trust status + reasons
- grants (capability surface)
- tier + allowExecute

Runtime enforces:
- allowExecute gating
- capability surface + constraints

### 6.4 Cyclic runtime reactors (gaming/streaming) are stateflow, not DAG dependency
If the system includes a continuous tick/frame loop (reactor):
- The **Outer DAG** remains acyclic and is the source of provenance/trust/plan decisions.
- The **Reactor** is runtime stateflow (“cycles over time”), not graph dependencies.
- The only coupling is an explicit boundary:
  - Outer → Reactor: approved snapshot (pinned artifacts + compiled plan/grants/constraints)
  - Reactor → Outer: telemetry/derived data blocks (no new authority)
- The reactor may never expand its authority beyond the compiled plan.

---

## 7) Change Protocol (Prevent anchor drift)

- Frozen anchors are defined in `docs/PROJECT_STATE.md`.
- Any anchor change requires:
  1) updating the registry in `docs/PROJECT_STATE.md`
  2) updating anchor typecheck tests (when they exist)
  3) updating or adding golden fixtures

Prefer additive changes (optional fields) over breaking changes.

---

## 8) Mint Adapter v1 (Product Output)

WeftEnd v1’s primary output is a deterministic mint package:

Schema: `weftend.mint/1`

Purpose:
- machine adapter (JSON) + human report (txt)
- time-free, bounded, reproducible

Hard rules:
- canonical JSON only
- stable-sorted arrays
- no timestamps, usernames, or machine IDs
- strict deny-by-default probes only (no network)

See `docs/MINT_PACKAGE_V1.md` for the full schema and limits.

---

## 9) Platform Intake Pipeline (v1)

WeftEnd v1 provides a deterministic intake decision for platform pipelines:

- Inputs: `weftend.mint/1` + `weftend.intake.policy/1`
- Outputs: `intake_decision.json`, `disclosure.txt`, `appeal_bundle.json`
- Actions: APPROVE | QUEUE | REJECT | HOLD with deterministic exit codes
- Requirements: no timestamps, bounded outputs, fail closed on invalid policy or mint

Policies map reason codes and probe denials into platform actions while preserving
appealable disclosures. See the CLI `weftend intake` for reference output.

---

## 10) Adapter Contract (v0)

Adapters are allowed to transform external artifacts into deterministic local folders
that WeftEnd can analyze. Adapters do not change core receipt schemas.

Hard rules:
- Adapter input/output is local only (no network side effects).
- Adapter outputs must be bounded and deterministic.
- Adapter outputs must not include host absolute paths or environment values.
- Core safe-run semantics remain unchanged after adapter transformation.

Current adapter commands:
- `weftend email unpack ...`
- `weftend email safe-run ...`
- `weftend summarize <outRoot>`
- `weftend export-json <outRoot> --format normalized_v0`

Adapter normalization notes:
- Email adapter outputs include `adapter_manifest.json` and required deterministic files.
- Missing or malformed adapter normalization markers must fail closed.
- Adapter outputs must remain path-clean and environment-clean under privacy lint.
