# RELEASE_CHECKLIST_ALPHA.md
Short, strict release checklist (alpha).

1) Clean repo state
- git status --short
- Expect no pending changes before build/tag.

1.1) Immutable-release change record check
- Confirm `CHANGELOG.md` (`[Unreleased]`) is updated with all release-bound deltas.
- Confirm `docs/RELEASE_NOTES.txt` matches release scope and validation commands.
- Confirm `docs/RELEASE_HISTORY.md` is updated for the upcoming published entry.
- Confirm release announcement text matches the same scope (if used).

2) Full validation loop (no skips)
- Preferred (single full-spin gate):
  - npm run verify:360
  - Optional stricter adapter maintenance gate:
    - npm run verify:360:adapter:strict
  - Optional enforced no-partial gate:
    - npm run verify:360:adapter:strict:enforced
  - Optional one-command release strict gate:
    - npm run verify:360:release
  - Optional strict gate with clean dedicated out-root:
    - npm run verify:360:release:cleanout
  - Optional managed strict release gate (auto-generates temporary adapter maintenance policy):
    - npm run verify:360:release:managed
    - Managed helper enforces release smoke input (`WEFTEND_RELEASE_DIR`, default `tests/fixtures/release_demo`) and clears `WEFTEND_ALLOW_SKIP_RELEASE`.
  - Confirm receipt exists:
    - out\\verify_360\\latest.txt
    - out\\verify_360\\history\\run_<seq>\\verify_360_receipt.json
- Equivalent manual sequence (if needed):
  - npm run compile --silent
  - npm test
  - Strict release-smoke proofcheck:
    - npm run proofcheck:release
  - npm run release-loop

2.1) Optional GitHub Actions parity runs (manual, recommended before publish)
- Run workflow: `.github/workflows/weftend_artifact_meter.yml`
  - Use a release candidate path as `target_path`.
  - Confirm uploaded artifacts exist under `out/ci_meter`.
- Run workflow: `.github/workflows/weftend_verify360.yml`
  - Confirm managed verify command executes: `npm run verify:360:release:managed`.
  - Confirm uploaded artifacts exist under `out/verify_360_release_managed`.

3) Build release bundle
- Preferred (repo root):
  - powershell -NoProfile -ExecutionPolicy Bypass -File .\\weftend_release_zip.ps1 -OutDir out\\release
- Wrapper option:
  - powershell -NoProfile -ExecutionPolicy Bypass -File tools\\windows\\weftend_release_zip.ps1 -OutDir out\\release

4) Verify release artifact set (required files)
- weftend_<version>_<date>.zip
- weftend_<version>_<date>.zip.sha256
- weftend_<version>_<date>_portable.zip
- weftend_<version>_<date>_portable.zip.sha256
- RELEASE_NOTES.txt
- RELEASE_ANNOUNCEMENT.txt
- QUICKSTART.txt
- RELEASE_CHECKLIST_ALPHA.md
- RELEASE_HISTORY.md
- CHANGELOG.md

5) Verify SHA256
- Get-Content out\\release\\weftend_*.sha256
- Get-FileHash out\\release\\weftend_*.zip -Algorithm SHA256
- Confirm each printed hash matches its corresponding .sha256 file entry.

6) Operator smoke (first 5 minutes)
- tools\\windows\\FIRST_5_MINUTES.cmd
- Confirm out\\first_5_minutes\\FIRST_5_MINUTES_REPORT.txt shows:
  - native_stub=PASS
  - web_stub_run1=PASS
  - web_stub_run2=PASS
  - compare=PASS
  - overall=PASS

7) Windows shell checks (if shipping shell integration)
- powershell -NoProfile -ExecutionPolicy Bypass -File tools\\windows\\shell\\weftend_shell_doctor.ps1
- Confirm all command keys report OK.
- Confirm installed shortcut set is intentional:
  - WeftEnd Launchpad
  - WeftEnd Download

8) Adapter maintenance readiness check
- npm run weftend -- adapter doctor --text
- npm run weftend -- adapter doctor --strict
- Confirm `policy.invalid=-` unless intentionally testing a maintenance-file failure case.
- If a maintenance profile is needed for release operators:
  - npm run weftend -- adapter doctor --write-policy policies\\adapter_maintenance.json --include-missing-plugins
  - Confirm generated file exists and has schema `weftend.adapterMaintenance/0`.

9) Release folder sync check
- Copy from out\\release to release upload folder.
- Ensure upload folder has no stale extra files.
- Re-verify zip hashes in upload folder if contents were rebuilt.

10) Tag + publish
- Only after steps 1-9 pass.
- Upload artifacts from the latest synced release folder.
