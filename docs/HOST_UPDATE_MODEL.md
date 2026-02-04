# Host Update Model (v0)

Status: Implemented (v0)

This document defines the minimal update model for the Node host. It is normative and enforced in code.

Enforcement links
- Implementation: `src/runtime/host/host_update.ts`
- Invariant test: `src/runtime/host/host_update.test.ts`
- Discipline rule: `docs/DRIFT_GUARDRAILS.md`

Goals
- Host updates are explicit and user-driven.
- Only trusted keys may authorize updates.
- Updates are atomic and must produce receipts.

Non-goals (v0)
- Automatic background updates.
- Network fetching.
- Telemetry or remote attestation.

HostReleaseManifest (planned)
- Schema: `weftend.host.release/0`
- Bound to:
  - host binary/artifact digest
  - host runtime bundle digest
  - update policy digest
- Signed by a pinned host key.

Pinned updater policy
- Accept updates only when:
  - signature validates against pinned key(s)
  - user explicitly invokes update command
- No trust-by-file-presence.

Receipts
- `HostUpdateReceiptV0`
  - includes input release id, expected digest, observed digest
  - includes decision ALLOW/DENY with reasons
  - includes install status + atomic switch outcome
  - Receipts missing `schemaVersion` or `weftendBuild` are old-contract and must not be used to assert current invariants.

Failure code (v0)
- `HOST_INPUT_OVERSIZE` is fail-closed. It means the update input exceeded a hard bound (size/count/path/etc).
- Not retryable by re-running; only by reducing input size or using a curated update package.
- Appears in `HostUpdateReceiptV0.reasonCodes`. It must only appear in host self status if self checks consume oversized inputs (normally they should not).

Operator note: what to do when `HOST_INPUT_OVERSIZE` appears
- Reduce the update input size (strip unused assets or split packages).
- Use a curated update package that conforms to bounds.
- Do not retry blindly without changing input size/shape.
- Confirm latest `host_status_*.json` is `OK` before attempting install/update.

Atomic install
- Verify to a staging directory.
- Move/swap to active directory in a single operation.
- Rollback if install receipt indicates failure.
