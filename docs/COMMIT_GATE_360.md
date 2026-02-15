# COMMIT_GATE_360
Status: normative.

Purpose
- Prevent state advance on partial knowledge.
- Require one full verification spin before any reusable commit.
- Keep WeftEnd aligned to deterministic, fail-closed, privacy-clean guarantees.

Core rule
- Unknown state must not advance baseline, trust, or release state.
- Any partial signal is treated as `WITHHELD` or `BLOCKED` until verified.

360 gate definition
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

Command
- `npm run verify:360`

Output evidence
- `out/verify_360/history/run_<seq>/verify_360_receipt.json`
- `out/verify_360/history/run_<seq>/verify_360_report.txt`
- `out/verify_360/latest.txt` (pointer to latest run folder)

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
