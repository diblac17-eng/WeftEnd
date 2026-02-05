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
- Start Menu shortcut **WeftEnd Launchpad** opens the Launchpad panel (premium only).
- Optional: create a WeftEnd-run shortcut (analysis first, then launch if baseline OK):
  tools\windows\shell\weftend_make_shortcut.ps1 -TargetPath "<path-to-app.exe>" -AllowLaunch

Launchpad (panel) - premium only
- Drop files/folders into: %LOCALAPPDATA%\WeftEnd\Library\Launchpad\Targets
- Run: npm run weftend -- launchpad sync --allow-launch --open-library
- Open **WeftEnd Launchpad** (Start Menu) to click app buttons.

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
