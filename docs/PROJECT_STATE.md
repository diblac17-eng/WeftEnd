# PROJECT_STATE — WeftEnd / WebLayers v2.6 (authoritative sync spine)

Authoritative coordination spine.

Authority:
- Top: `docs/PROJECT_STATE.md` and `docs/weblayers-v2-spec.md` (co-equal). If they conflict, stop and write a Proposal.
- `docs/INTEGRATION_CONTRACT.md` must not conflict with either; it operationalizes cross-section rules.

If worker output conflicts with the authorities above, stop and write a Proposal.

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
- `docs/NON_GOALS.md`
- `docs/TIER_MARKETS.md`
- `docs/DEVKIT_STRICT_LOAD.md`

Guidance (supporting contracts + workflows):
- `docs/PROGRAM_FLOW.md`
- `docs/PHASES_2_TO_COMPLETE_WORKPLAN.md`
- `docs/CLI_PUBLISH.md`
- `docs/CLI_IMPORT.md`
- `docs/CLI_MARKETS.md`
- `docs/DEMO_GOLDEN_PATH.md`
- `docs/DEMO_STEAM_LANE.md`
- `docs/TELEMETRY_STREAMS.md`
- `docs/TELEMETRY_CONDUITS_V0.md`
- `docs/LOCAL_TESTING.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/DEV_END_TO_END.md`
- `docs/SECURITY_ECONOMICS.md`
- `docs/RECOVERY_LANE_HARDENING.md`
- `docs/VISION_SCOPE_NEXT_STEPS.md`

## 0) North Star

WeftEnd blockifies the web by making **pages publishable portals** into a block economy:
- publish a page => reveal DAG + provenance + trust/grants/tier decisions
- publish blocks => populate the economy
- compose pages from blocks => safe by trust + capabilities + tiers
- crypto trust evidence => supply-chain visible and policy-gated

Publishing never grants power. Policy grants power.

---

## 0.1) Portal projection caps (proof-only view)

Portal output is a **projection**, not a source of truth. It must never reject or mutate truth artifacts.
When the view would exceed bounds, it truncates deterministically and adds explicit truncation metadata.

Rules:
- Never reject because the portal view is large.
- Never mutate underlying truth artifacts (plan, release, Tartarus store).
- Truncation is explicit and stable: add `PORTAL_PROJECTION_TRUNCATED` entries with `{section, kept, dropped}`.
- Truncation metadata is bounded (no dropped lists).

Caps (v2.6):
- MAX_PORTAL_BLOCKS = 512
- MAX_TARTARUS_PER_BLOCK = 16
- MAX_TARTARUS_TOTAL = 1024
- MAX_STAMPS_PER_BLOCK = 16
- MAX_CAPS_PER_BLOCK = 64
- MAX_STR_BYTES = 512 (any portal-facing string fields)

Projection truncation lives on `PortalModelV0.projectionTruncations[]`.

---

## 1) Shared spine file manifest (minimum set to generate outward)

Docs
1. `docs/weblayers-v2-spec.md` (authoritative design + philosophy)
2. `docs/INTEGRATION_CONTRACT.md` (cross-section laws)
3. `docs/PROJECT_STATE.md` (this file)
4.`PROGRAM_FLOW.md is the narrative gate model; not normative over the spec.

Core
4. `src/core/types.ts` (canonical schemas)
5. `src/core/canon.ts` (determinism primitives; MUST match reference below)
6. `src/core/validate.ts` (fail-closed validators + binding invariants)

Ports
7.  `src/ports/logger-port.ts`
8.  `src/ports/diag-port.ts`
9.  `src/ports/clock-port.ts`
10. `src/ports/id-port.ts`
11. `src/ports/crypto-port.ts`
12. `src/ports/identity-port.ts`
13. `src/ports/ports-bundle.ts`

Guidance
14. `How to build with AI .txt`

Everything else (engine/runtime/devkit/cli/tests) is generated outward from this spine.

---

## 2) Determinism reference implementations (COPY EXACTLY into src/core/canon.ts)

### 2.1 canonicalJSON (exact)

```ts
export function canonicalJSON(obj: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null || v === undefined) return null;

    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;

    if (t === "function" || t === "symbol") return null;

    if (Array.isArray(v)) return v.map(normalize);

    if (t === "object") {
      if (seen.has(v)) throw new Error("CYCLE_IN_CANONICAL_JSON");
      seen.add(v);

      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
      return out;
    }

    return null;
  };

  return JSON.stringify(normalize(obj));
}

2.2 stable sorts (exact)

export const sortById = <T extends { id: string }>(arr: T[]) =>
  [...arr].sort((a, b) => a.id.localeCompare(b.id));

export const sortDependencies = (deps: { id: string; role: string }[]) =>
  [...deps].sort((a, b) => {
    const c = a.id.localeCompare(b.id);
    return c !== 0 ? c : a.role.localeCompare(b.role);
  });

export const sortCapRequests = (caps: { capId: string; params?: any }[]) =>
  [...caps].sort((a, b) => {
    const c = a.capId.localeCompare(b.capId);
    if (c !== 0) return c;
    return canonicalJSON(a.params ?? null).localeCompare(canonicalJSON(b.params ?? null));
  });

export const sortCapGrants = (caps: { capId: string; params?: any }[]) =>
  [...caps].sort((a, b) => {
    const c = a.capId.localeCompare(b.capId);
    if (c !== 0) return c;
    return canonicalJSON(a.params ?? null).localeCompare(canonicalJSON(b.params ?? null));
  });

export const sortByNodeId = <T extends { nodeId: string }>(arr: T[]) =>
  [...arr].sort((a, b) => a.nodeId.localeCompare(b.nodeId));

export const sortBlockPins = (pins: { nodeId: string; contentHash: string }[]) =>
  [...pins].sort((a, b) => {
    const c = a.nodeId.localeCompare(b.nodeId);
    return c !== 0 ? c : a.contentHash.localeCompare(b.contentHash);
  });

3) Canonical NodeId grammar (v2.6)

Strict forms:
	•	page:/path
	•	block:<name> or block:@publisher/name
	•	svc:<name> or svc:@publisher/name
	•	data:<name> or data:@publisher/name
	•	priv:<name>
	•	sess:<name>
	•	asset:<name>

No new prefixes. Use naming under block: instead (e.g. block:layout/<name>).

Validation rules:
	•	non-empty string
	•	no whitespace
	•	must match one of the prefixes above
	•	page: must be page:/... (slash required)

⸻

4) Error code registries (frozen; add only by Proposal + fixtures)

GraphErrorCode (minimum set):
	•	CYCLE_DETECTED
	•	DANGLING_DEPENDENCY
	•	INVALID_GRAPH
	•	INVALID_NODE
	•	INVALID_DEPENDENCY
	•	DUPLICATE_NODE
	•	MISSING_ROOT
	•	INVALID_NODE_ID

ImportErrorCode (minimum set):
	•	IMPORT_PARSE_ERROR
	•	IMPORT_INVALID_SCHEMA
	•	IMPORT_INVALID_NODE_ID
	•	IMPORT_UNSUPPORTED
	•	IMPORT_EMPTY

BuildErrorCode (minimum set):
	•	BUILD_INVALID_DESIGN
	•	BUILD_INVALID_NODE_ID
	•	BUILD_GRAPH_ERROR
	•	BUILD_DUPLICATE_NODE
	•	BUILD_MISSING_ROOT

TrustErrorCode (minimum set):
	•	TRUST_POLICY_INVALID
	•	TRUST_DENIED
	•	TRUST_SIGNATURE_REQUIRED
	•	TRUST_SIGNATURE_INVALID
	•	TRUST_HASH_MISMATCH
	•	TRUST_PKG_MISSING
	•	TRUST_PKG_AMBIGUOUS

CapabilityErrorCode (minimum set):
	•	CAP_DENIED
	•	CAP_INVALID_PARAMS
	•	CAP_HOST_ERROR

⸻

5) Reserved capability family: identity (v2.6 anchors)

Reserved cap IDs:
	•	id:present
	•	id:sign
	•	id:consent

Rules:
	•	any id:* implies origin.exec
	•	identity access is always mediated by runtime (blocks never get IdentityPort directly)
	•	consent is explicit and auditable

⸻

6) Ports (interfaces only)

Required ports:
	•	LoggerPort
	•	DiagPort
	•	ClockPort
	•	IdPort
	•	CryptoPort
	•	IdentityPort (optional at runtime; if absent then id:* caps are denied)
	•	PortsBundle
	•	CapabilityHostPort (only inside PortsBundle; runtime kernel uses it)

⸻

7) Frozen anchors (v2.6) — Registry spine

Every worker must target these exact signatures and contracts.

A1) Devkit — importHtmlToDesignTree

Owner: src/devkit/html-importer.ts
Signature:
	•	importHtmlToDesignTree(html: string, options?: unknown) -> Result<PageDesignTree, ImportError[]>
Contract:
	•	deterministic document-order parts
	•	fail closed with ImportErrorCode
	•	validate pageId NodeId

A2) Engine — blockifyPageDesign

Owner: src/engine/build.ts
Signature:
	•	blockifyPageDesign(design: PageDesignTree, options: { pageId: string }) -> Result<GraphManifest, BuildError[]>
Contract:
	•	pure (no ports, no IO)
	•	deterministic ids (no IdPort)
	•	nodes preserve document order; determinism via nodePath anchors and canonical hashing
	•	fail closed with BuildErrorCode

A3) Engine — evaluateTrustAndPlan

Owner: src/engine/trust.ts
Signature:
	•	evaluateTrustAndPlan(manifest: GraphManifest, policy: TrustPolicy) -> Result<{ trust: TrustResult; plan: ExecutionPlan }, TrustError[]>
Contract:
	•	fail closed on required signature/hash mismatch
	•	stable ordering: trust nodes by nodeId; plan nodes by nodeId; grants by capId+canonical(params)
	•	plan.planHash is hash over canonical(plan)

A4) Runtime — bootstrapRuntime

Owner: src/runtime/bootstrap.ts
Signature:
	•	bootstrapRuntime(rootElement: HTMLElement, bundle: RuntimeBundle, options?: unknown) -> void
Contract:
	•	refuse execution if bundle binding invariants fail
	•	execute only nodes with allowExecute true
	•	enforce capability surface (deny-by-default)
	•	executionMode defaults to legacy; strict only inside a strict executor boundary
	•	expose portal overlay data (DAG + provenance + trust/grants/tier decisions)

⸻

8) Cyclic runtime reactors (gaming/streaming) — recorded design constraint (not an anchor yet)

If the platform hosts a continuous tick/frame loop:
- The WebLayers DAG remains acyclic and is the provenance/trust/plan source of truth.
- Cycles exist only “over time” inside runtime stateflow (reactor), not as dependency edges.
- Outer → Reactor: approved snapshot (pinned artifacts + compiled plan/grants/constraints).
- Reactor → Outer: telemetry/derived data blocks (no new authority).

Phase note:
- The contract is documented now.
- The implementation + any new anchors/types are added only when Phase 2/3 work orders define them.

---

## 8) What “locked” means

The spine is locked when:
	•	tsc --noEmit passes
	•	canon reference == canon implementation (functionally identical)
	•	validators are fail-closed and deterministic
	•	IdentityPort compiles against core types
	•	docs are parseable and copyable (no broken fences)

---

## Quick re-check you should run now
- `tsc --noEmit`

If that passes, your spine is in the state you want: **enough law + enough schema + enough determinism** to generate the rest in parallel without semantic drift.

If you want the next “anti-drift” upgrade after this: add a single compile-time *anchor signature test* once engine/runtime anchors exist. That turns “should anchor” into “cannot drift.”
