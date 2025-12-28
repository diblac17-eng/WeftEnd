Core Canon Laws & Pillars — WeftEnd (WebLayers v2.6)

Scope: This file governs only the Core Canon section: src/core/canon.ts and its direct responsibilities (deterministic canonicalization + stable ordering primitives).  

0) Authority & Conflict Rule

Hard authorities (co-equal):
	•	docs/PROJECT_STATE.md (authoritative coordination spine; determinism reference is frozen)  
	•	docs/weblayers-v2-spec.md (authoritative philosophy + generation order)  

Cross-section law (must not conflict with the above):
	•	docs/INTEGRATION_CONTRACT.md  

If anything conflicts: stop and write a Proposal (do not “best guess”).      

⸻

1) Purpose (Why Core Canon Exists)

Core Canon is the project’s determinism root:
	•	It defines the only allowed canonical JSON encoding for trust-relevant hashes/signatures/fixtures.    
	•	It defines stable sort helpers used anywhere ordering affects hashing, signatures, or golden fixtures.    
	•	If Canon drifts, the entire trust/plan system becomes non-reproducible (and therefore un-auditable).  

⸻

2) Pillars (Non-Negotiables)

P1 — Purity
	•	src/core/canon.ts must be pure functions only (no IO, no ports, no global state).    
	•	No dependence on time, randomness, environment, locale options, or host configuration beyond standard JS semantics.

P2 — Determinism is law
	•	Canonical JSON and stable ordering must match the reference implementations exactly.    
	•	No “improvements,” “cleanup,” “performance refactors,” or alternate stringify/sorting approaches.

P3 — Small surface area
	•	Canon exports only the minimal primitives the rest of the system must share:
	•	canonicalJSON
	•	stable sort helpers as defined in the spine    
	•	Any new export is a Proposal-level change (it propagates everywhere).

P4 — Canon is upstream of trust
	•	Anything that affects contentHash, planHash, trustHash, signature payloads, or fixtures must flow through Canon.    

⸻

3) Layer & Import Laws (Hard)
	•	core imports: TS/stdlib only. No imports from ports/engine/runtime/devkit/cli/tests.  
	•	src/core/canon.ts must not import anything (except TS/stdlib).  

⸻

4) Canonical JSON Law (Exact Semantics)

canonicalJSON(obj: unknown): string semantics are frozen by the spine and must remain identical.    

Required normalization
	•	null and undefined → null
	•	primitives (string|number|boolean) pass through
	•	function and symbol → null
	•	arrays preserve order; elements normalized recursively
	•	objects:
	•	keys sorted lexicographically (Object.keys(v).sort())
	•	values normalized recursively
	•	cycle detection: if a cycle is detected, throw Error("CYCLE_IN_CANONICAL_JSON")    

Consequence: throwing is allowed here

Core Canon may throw only for the explicit cycle guard. Everything else in boundaries should be Result-mode; callers that accept untrusted input must wrap Canon safely (as validate.ts already does).    

⸻

5) Stable Sort Law (Exact Order Keys)

The following helpers are frozen and must remain identical.    
	•	sortById: by id
	•	sortDependencies: by (id, role)
	•	sortCapRequests: by (capId, canonical(params))
	•	sortCapGrants: by (capId, canonical(params))
	•	sortByNodeId: by nodeId
	•	sortBlockPins: by (nodeId, contentHash)

No hidden tie-breakers. If tie-breaking is needed, it must be explicit and match the reference.    

⸻

6) How Canon Must Be Used Elsewhere (Interface Contract)
	•	Any hashing/signing/planHash/trustHash/manifestHash must hash canonical JSON strings, not raw objects.    
	•	Any trust-relevant arrays must be stable-sorted using these helpers (or wrappers that preserve the exact key order).  
	•	Validation on untrusted input must never rely on Canon not throwing; wrap it (as in safeCanonicalJSON in src/core/validate.ts).  

⸻

7) Change Protocol (For This Section)

Allowed without Proposal
	•	Comment clarifications that do not alter meaning.
	•	Type-only tightening that does not change runtime output.

Proposal-required
	•	Any semantic change to canonicalJSON
	•	Any semantic change to sort order or comparison keys
	•	Any new exported helper
	•	Any change that could affect a hash, signature payload, planHash, trustHash, or fixtures    

⸻

8) Proof Obligations (What Must Be True After Any Change)

Even small edits must preserve these invariants:
	•	canonicalJSON output is byte-identical for all previously valid inputs.
	•	All stable sort helpers produce identical ordering for all previously valid inputs.
	•	Cycle behavior remains: throw CYCLE_IN_CANONICAL_JSON.    
	•	tsc --noEmit passes.  

⸻

9) Canon’s Relationship to Core Types (Boundary Discipline)
	•	Canon defines mechanics (encoding + ordering).
	•	src/core/types.ts defines schemas (what exists).  
	•	Canon must never introduce new boundary schemas; it only supports them deterministically.  