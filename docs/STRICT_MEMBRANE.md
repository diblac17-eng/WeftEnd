# Strict Membrane v0 (Phase 3 runtime contract)

Status: normative for Strict mode. If this conflicts with `docs/weblayers-v2-spec.md`, `docs/PROJECT_STATE.md`, or `docs/INTEGRATION_CONTRACT.md`, stop and raise a Proposal.

---

## Pillars (must hold)
- **MB1 — Two realms, one door:** Untrusted blocks run only in a Strict Sandbox realm. Privileged ops cross the boundary via Host messages.
- **MB2 — No ambient I/O:** Sandbox has no fetch/XHR/WebSocket/storage/etc. If any remain, Strict must refuse to start.
- **MB3 — Caps are explicit:** Blocks receive only a `caps` object whose methods marshal to the Host.
- **MB4 — Host is the only executor:** Host validates (planDigest + grants + capId) and performs/denies ops deterministically.
- **MB5 — Determinism:** Same input + same grants => same allow/deny + same reason ordering.
- **MB6 — No strict without membrane:** If code runs outside the sandbox realm, it is Compatible/Legacy, not Strict.

---

## Strict = Host + Sandbox + Hardening
Strict mode requires:
- a separate realm (Dedicated Worker) for untrusted code,
- a compartment with explicit endowments only (caps + safe intrinsics),
- a single message-based door (caps) to the Host.

Async I/O is required. If code assumes sync I/O, it is not Strict-compatible.

---

## Forbidden globals (minimum list)
The sandbox must not expose:
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`
- `importScripts`
- `localStorage`, `sessionStorage`, `indexedDB`, `caches`

If any remain callable inside the compartment, Strict fails closed.

---

## One-door policy (caps only)
The only sanctioned I/O path is:
- `caps.<namespace>.<method>(args)` → Host message → Host enforcement → result/deny.

No direct handles are passed into the sandbox.

---

## Guarantees (and non-guarantees)
Guaranteed:
- No ambient browser I/O visible inside the compartment when self-test succeeds.
- Host-side enforcement of grants with deterministic denial reasons.

Not guaranteed:
- Sync I/O in Strict (must be async).
- Security in Compatible/Legacy modes.

---

## Proof obligations (tests)
Strict mode must prove:
- forbidden globals absent,
- direct fetch fails,
- caps call path works and returns structured deny,
- hardening failure is fail-closed,
- reason ordering is deterministic.
