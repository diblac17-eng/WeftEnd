# COMMIT_GATE_360
Status: normative.

Purpose
- Prevent state advance on partial knowledge.
- Require one full verification spin before any reusable commit.
- Keep WeftEnd aligned to deterministic, fail-closed, privacy-clean guarantees.
- Ensure gate outputs are committed via two-phase finalize (no half-written run artifacts).

Core rule
- Unknown state must not advance baseline, trust, or release state.
- Any partial signal is treated as `WITHHELD` or `BLOCKED` until verified.

360 gate definition
0. Docs/update discipline check:
   - If code/shell/package paths changed, at least one operator-facing doc must be updated in the same working set.
0.1 Git/posting etiquette check:
   - README/release docs must pass communication hygiene rules (no AI self-reference, no mojibake, no odd hype language).
1. Compile succeeds.
2. Full test suite succeeds.
3. Proofcheck succeeds with release fixture coverage.
4. Determinism replay check succeeds:
   - same input
   - two independent safe-run outputs
   - deterministic artifacts byte-match.
5. Privacy lint succeeds on generated run outputs.
6. Compare lane succeeds on generated outputs.
7. A gate receipt/report is always written (including PARTIAL/FAIL runs).
8. Gate output commit is two-phase:
   - `stage` writes receipt/report/manifest into a staging folder
   - `finalize` atomically switches staged output into the run folder
9. Gate state is explicit and monotonic:
   - `INIT -> PRECHECKED -> COMPILE_DONE -> TEST_DONE -> PROOFCHECK_DONE -> DETERMINISM_DONE -> STAGED -> FINALIZED -> RECORDED`
10. Idempotence replay handling is explicit:
   - key is derived from deterministic gate context
   - duplicate key runs still write full evidence
   - duplicate key runs suppress `latest.txt` pointer update to avoid double-apply side effects
   - receipt includes `idempotence.mode`, `pointerPolicy`, and prior run linkage when present
11. Capability outcomes are explicit:
   - receipt includes a deterministic capability ledger for requested capabilities
   - each capability records `GRANTED` or `DENIED` with stable reason codes
   - missing capability decisions are fail-closed as `DENIED` with `VERIFY360_CAPABILITY_UNSET`
12. Explain layer is deterministic and versioned:
   - receipt includes `explain` with fixed, versioned interpretation text
   - report includes `explain.*` lines derived from stable receipt fields
   - explanation text is deterministic input-to-output mapping, not model-generated content
13. Observed vs interpreted split is explicit:
   - receipt records raw observations under `observed` (presence, counts, status summaries)
   - receipt records conclusions under `interpreted` (verdict, reason set, gate state, next policy semantics)
   - report mirrors this with `observed.*` and `interpreted.*` lines for quick review
14. Internal exception path is evidence-first:
   - unexpected gate exceptions still produce fail-closed receipt/report artifacts
   - normal writer failure automatically falls back to emergency writer path
   - `latest.txt` is never advanced on emergency/failure writes
   - exception reason codes include stable name token plus explicit `VERIFY360_*` message token when present
   - emergency write path enforces no-orphan output check
15. State path evidence is explicit:
   - receipt includes deterministic `stateHistory` for each run
   - interpreted section includes `gateState` and `stateHistory`
   - fail-closed exceptions add `VERIFY360_FAIL_CLOSED_AT_<STATE>` reason code
   - receipt includes `stateHistoryDigest` and interpreted mirror digest for integrity checks
16. Payload consistency is enforced before write:
   - state history root/tail/order checks fail closed
   - interpreted state fields must match top-level state fields
   - reason codes must be stable-sorted/unique at write time
17. Verify history chain is explicit:
   - receipt includes `historyLink.priorRunId` + `historyLink.priorReceiptFileDigest`
   - receipt includes `historyLinkDigest` over the prior-run link tuple
   - evidence chain mirrors history link fields
   - harness asserts prior-run continuity and digest match across pass/replay/fail runs
18. Harness validates receipt ordering/ledger invariants:
   - top-level `reasonCodes` must be stable-sorted/unique
   - capability ledger requested/decisions sets must match exactly
   - each capability decision status must be `GRANTED` or `DENIED`
19. History audit validates run-folder integrity:
   - receipt/report/manifest presence and digest integrity
   - history chain continuity and prior-receipt digest links
   - strict mode can fail on legacy warnings
   - non-strict mode permits legacy warning-only runs for backward compatibility
20. `verify:360` includes an internal non-strict history audit pass:
   - audit errors fail the gate (`VERIFY360_HISTORY_AUDIT_FAILED`)
   - legacy warnings are surfaced as reason codes (`VERIFY360_HISTORY_AUDIT_WARNINGS_PRESENT`) without forcing strict-mode failure
   - pre-write first-run lanes allow empty history (`WEFTEND_360_AUDIT_ALLOW_EMPTY=1`) so new isolated roots fail only on real integrity errors
   - strict behavior remains available via `WEFTEND_360_AUDIT_STRICT=1`

Command
- `npm run verify:360`
- `npm run verify:360:harness` (replay + forced-exception corridor validation)
- `npm run verify:360:audit` (history integrity audit)
- `npm run verify:360:audit:strict` (strict audit; warnings fail)
- Fault-injection check (optional): `WEFTEND_360_FORCE_EXCEPTION=1 node scripts/verify_360.js`
  - Expected: exit 1 with fail receipt/report written and no `latest.txt` advance.
- Optional output root override for isolated runs:
  - `WEFTEND_360_OUT_ROOT=<path>`
  - useful for isolated harness/testing lanes without touching default `out/verify_360`.

Output evidence
- `out/verify_360/history/run_<seq>/verify_360_receipt.json`
- `out/verify_360/history/run_<seq>/verify_360_report.txt`
- `out/verify_360/history/run_<seq>/verify_360_output_manifest.json`
- `out/verify_360/latest.txt` (pointer to latest run folder)
- Receipt includes evidence-chain links:
  - report/receipt chain digests
  - safe-run/compare artifact digests (when present)
  - deterministic idempotence key context
  - deterministic capability ledger (`capabilityLedger`)
  - deterministic observed/interpreted sections (`observed`, `interpreted`)

Expected behavior
- Fails fast on first invalidating condition.
- Uses stable local fixtures by default:
  - `WEFTEND_RELEASE_DIR=tests/fixtures/release_demo`
  - `WEFTEND_360_INPUT=tests/fixtures/intake/tampered_manifest/tampered.zip`
- Supports env override for controlled alternate fixtures:
  - `WEFTEND_RELEASE_DIR=<path>`
  - `WEFTEND_360_INPUT=<path>`

Policy
- No commit intended for reuse should be considered valid until `verify:360` passes.
- No merge/release should bypass `verify:360`.
- Host precondition misses must be explicit evidence (`PARTIAL`/`SKIP`) and must not silently drop receipts.
- Missing docs/update sync for code changes is a gate failure (`VERIFY360_DOC_SYNC_MISSING`).
- Etiquette violations are a gate failure (`VERIFY360_GIT_ETIQUETTE_FAILED`).
