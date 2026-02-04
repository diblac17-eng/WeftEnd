# INSTALL.md

Quick start (portable zip)

1) Unzip the release bundle.
2) Open PowerShell in the repo root.
3) Build the CLI:
   npm run compile --silent

Windows shell (right-click)
- Install the context menu:
  tools\windows\shell\install_weftend_context_menu.ps1
- Run the shell doctor (sanity):
  tools\windows\shell\weftend_shell_doctor.ps1
- Start Menu shortcuts include **WeftEnd Library** and **WeftEnd Download**.

First-use demo stubs (no execution)
- Native app stub:
  npm run weftend -- safe-run demo\native_app_stub\app.exe --out out\demo_native
- Web export stub:
  npm run weftend -- safe-run demo\web_export_stub --out out\demo_web
- Config/data stub:
  npm run weftend -- safe-run demo\config_data_stub --out out\demo_data

Compare two runs
  npm run weftend -- compare "<oldOut>" "<newOut>" --out out\demo_compare

Receipts
- See docs/WHY_RECEIPTS.md for what receipts are and why they matter.
- See docs/REPORT_LIBRARY.md for the local library layout.
- If you see unexpected results, see docs/TROUBLESHOOTING.md.
- WITHHELD is expected for native binaries (analysis-only).
