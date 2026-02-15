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

Command
- `npm run verify:360`

Output evidence
- `out/verify_360/history/run_<seq>/verify_360_receipt.json`
- `out/verify_360/history/run_<seq>/verify_360_report.txt`
- `out/verify_360/history/run_<seq>/verify_360_output_manifest.json`
- `out/verify_360/latest.txt` (pointer to latest run folder)
- Receipt includes evidence-chain links:
  - report/receipt chain digests
  - safe-run/compare artifact digests (when present)
  - deterministic idempotence key context

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
