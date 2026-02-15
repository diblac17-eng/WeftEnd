# Full Loop Policy

Any patch is untrusted until it passes the full loop.

Required sequence (always, in this order)

1) npm run compile --silent
2) npm test
3) npm run proofcheck

Rules

- Any file edit requires the full loop (code, docs, tests, fixtures, goldens).
- Report PASS/FAIL for each gate.
- Report SKIPs with the exact missing precondition.
- If a SKIP can hide regressions, call it out explicitly.

Loops

- Dev Loop: npm run loop
  - Sets WEFTEND_ALLOW_SKIP_RELEASE=1 so local runs can proceed without release artifacts.
- Clean Loop: npm run clean-loop
  - Deletes dist/ before running the dev loop.
- Release Loop: npm run release-loop
  - Requires WEFTEND_RELEASE_DIR and will fail if it is missing.
- Commit Gate 360: npm run verify:360
  - Full spin gate for reusable commits:
    - docs/update discipline check
    - compile
    - test
    - proofcheck with release fixture
    - deterministic replay check
    - privacy lint on generated run outputs
    - compare lane smoke
  - Always writes run evidence:
    - out/verify_360/history/run_<seq>/verify_360_receipt.json
    - out/verify_360/history/run_<seq>/verify_360_report.txt
  - Host precondition misses are explicit PARTIAL/SKIP evidence, not silent no-output aborts.

Environment

- WEFTEND_RELEASE_DIR: required for release smoke in proofcheck.
- WEFTEND_ALLOW_SKIP_RELEASE=1: explicitly allows release smoke to SKIP in dev loop.
- WEFTEND_360_INPUT: optional deterministic input override for verify:360.
