# DOM Gateway v0 (Strict UI without DOM access)

Status: normative for Strict UI. If this conflicts with `docs/weblayers-v2-spec.md`, `docs/PROJECT_STATE.md`, or `docs/INTEGRATION_CONTRACT.md`, stop and raise a Proposal.

---

## Why Strict cannot touch DOM
Strict blocks run in a sandbox realm. DOM access would be a direct escape hatch.
Therefore, Strict blocks emit **RenderPlans** (pure data) and the Host applies them.

---

## RenderPlan is inert
RenderPlan is a whitelist-only, pure data structure:
- no executable strings,
- no event handlers,
- no inline JS URLs.
- targetPath uses 1-based element indices (e.g., root/1/3/2).

If a plan contains anything outside the allowlist, it is rejected.

---

## Host applies deterministically
The Host:
- validates the plan,
- applies ops in order,
- fails closed with deterministic reason ordering.

If it’s not in a validated plan, it doesn’t touch the DOM.
