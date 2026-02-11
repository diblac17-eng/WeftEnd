# INSTALL.md

Quick start (portable zip)

1) Unzip the portable bundle.
2) On Windows, use:
   - `WEFTEND_PORTABLE_MENU.cmd` for the operator menu
   - `WEFTEND_PORTABLE.cmd` for CLI
3) Runtime resolution is explicit:
   - bundled `runtime\node\node.exe` first
   - local Node second
   - fail closed if neither exists (no auto-download)
4) If you cloned source from GitHub (not release zip), build:
   npm run compile --silent
5) Cross-platform note:
   - CLI works on Windows/macOS/Linux (Node.js required).
   - Windows shell integration is Windows-only; macOS/Linux integration is planned.

Windows shell (right-click)
- Install the context menu:
  tools\windows\shell\install_weftend_context_menu.ps1
- Run the shell doctor (sanity):
  tools\windows\shell\weftend_shell_doctor.ps1
- Start Menu shortcuts include **WeftEnd Library** and **WeftEnd Download**.
- Optional: create a WeftEnd-run shortcut (analysis first, then launch if baseline OK):
  tools\windows\shell\weftend_make_shortcut.ps1 -TargetPath "<path-to-app.exe>" -AllowLaunch

First-use demo stubs (no execution)
- Native app stub:
  npm run weftend -- safe-run demo\native_app_stub\app.exe --out out\demo_native
- Web export stub:
  npm run weftend -- safe-run demo\web_export_stub --out out\demo_web
- Config/data stub:
  npm run weftend -- safe-run demo\config_data_stub --out out\demo_data

Compare two runs
  npm run weftend -- compare "<oldOut>" "<newOut>" --out out\demo_compare

First 5 minutes smoke (optional)
- Run: tools\windows\FIRST_5_MINUTES.cmd
- Check: out\first_5_minutes\FIRST_5_MINUTES_REPORT.txt (PASS/FAIL lines)

Receipts
- See docs/WHY_RECEIPTS.md for what receipts are and why they matter.
- See docs/REPORT_LIBRARY.md for the local library layout.
- If you see unexpected results, see docs/TROUBLESHOOTING.md.
- WITHHELD is expected for native binaries (analysis-only).
- Liability/scope: see docs/DISCLAIMER.md.
