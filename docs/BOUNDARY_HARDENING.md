# Boundary Hardening Pack (Phase 3)

Status: normative for runtime boundaries. If this conflicts with `docs/weblayers-v2-spec.md`, `docs/PROJECT_STATE.md`, or `docs/INTEGRATION_CONTRACT.md`, stop and raise a Proposal.

---

## Why postMessage authenticity matters
The browser’s ambient `postMessage` is not an authenticated channel. Any code in the same realm can spoof messages.
Strict mode must not trust ambient channels.

---

## The nonce + port rule (BH1)
Every boundary must be authenticated by:
1) an explicitly created `MessagePort`, and
2) a session nonce bound at init, and
3) the bound plan digest/hash.

Messages that arrive on any other channel are ignored (fail closed).

---

## Required fields on boundary messages
Every boundary message must include:
- `executionMode` (Strict or Strict-Privacy)
- `planDigest` or `planHash` (as defined by the boundary)
- `sessionNonce`

No field, no trust.

---

## Fail-closed behavior
- Missing or mismatched nonce => deny.
- Missing or mismatched planDigest/planHash => deny.
- Messages not on the port => ignore/deny.
- Any failure must return deterministic reason codes.

---

## Strict self-test contract (BH2)
Strict must perform a self-test before running any untrusted code:
- verify forbidden globals are absent in the sandbox realm,
- verify caps are the only door.

If the self-test fails or times out, Strict refuses to start.
