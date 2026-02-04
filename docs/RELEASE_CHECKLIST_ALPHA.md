# RELEASE_CHECKLIST_ALPHA.md
Short, strict release checklist (alpha).

1) Full loop (no skips)
- npm run compile --silent
- npm test
- set WEFTEND_RELEASE_DIR=tests\fixtures\release_demo
- npm run proofcheck
- npm run release-loop

2) Build release bundle
- powershell -ExecutionPolicy Bypass -File tools\windows\weftend_release_zip.ps1

3) Verify sha256
- Get-Content out\release\weftend_*.sha256
- Get-FileHash out\release\weftend_*.zip -Algorithm SHA256
- Values must match exactly.

4) First 5 minutes script
- tools\windows\FIRST_5_MINUTES.cmd
- Confirm FIRST_5_MINUTES_REPORT.txt shows PASS.

5) Team suites (required)
☐ Purple/Blue/Orange/Green suites PASS (see TEAM_SUITES.md)
☐ proofcheck includes team suites (no skips)

6) Tag + publish
- Only after steps 1-4 are PASS.
