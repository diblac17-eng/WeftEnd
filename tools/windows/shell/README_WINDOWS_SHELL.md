# Windows Shell Integration (v0)

This adds a per-user "Run with WeftEnd" right-click entry for files, folders, folder backgrounds, and .zip archives.
No admin rights required. No system-wide changes.

Install
1) Open PowerShell in the repo root.
2) Run:
```
tools\windows\shell\install_weftend_context_menu.ps1
```

Uninstall
```
tools\windows\shell\uninstall_weftend_context_menu.ps1
```

Usage
- Right-click a file/folder/.zip -> "Run with WeftEnd"
- Right-click a file/folder/.zip -> "Run with WeftEnd (Open Library)"
- Right-click inside a folder background -> "Run with WeftEnd"
- Output is stored in the local Report Library:
  `%LOCALAPPDATA%\WeftEnd\Library\<target>\run_<digest>[_NNN]\`
- Compare two runs with:
  `npm run weftend -- compare "<leftOutRoot>" "<rightOutRoot>" --out "<diffOutRoot>"`

WeftEnd-run shortcuts (optional)
- Create a shortcut that runs WeftEnd before launching an app:
  `tools\windows\shell\weftend_make_shortcut.ps1 -TargetPath "<path-to-app.exe>" -AllowLaunch`
- This runs analysis first, then launches only if baseline is SAME or accepted.

Analysis-first contract
- Right-click "Run with WeftEnd" always performs deterministic analysis first.
- Native executables are withheld from execution unless wrapped as a verified WeftEnd release.
- You still get receipts, decision posture, and privacy lint status on every run.
- Right-click `.lnk` shortcuts are treated as opaque artifacts and return `WITHHELD` with `ARTIFACT_SHORTCUT_UNSUPPORTED`.

Wrapper behavior
- The wrapper creates an output folder under `Library\<target>\run_<digest>` (deterministic ID).
- If the same runId already exists, it appends `_NNN` to keep the library append-only.
- Context menu runs PowerShell hidden (no console window flash).
- Registry invokes wrapper with `-Target`.
- It runs:
  - `node dist\src\cli\main.js safe-run ...` if `dist` exists, otherwise
  - `npm run weftend -- safe-run ...`
- It writes `wrapper_result.txt` in the output folder (PASS/FAIL + exit code + reason).
- It writes `report_card.txt` in the output folder and opens it in Notepad by default.
- The installer also creates Start Menu shortcuts: **WeftEnd Library** and **WeftEnd Download**.
- Wrapper never executes or shell-opens the target artifact.

Troubleshooting
- If execution policy blocks scripts, run PowerShell as current user and allow script execution for this session:
  `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process`
- If the repo path cannot be resolved, re-run the install script with `-RepoRoot <path>`.
- If `npm` is missing and `dist` is not built, run `npm run compile --silent`.
- If the shortcut icon does not update, Windows may be caching it. Restart Explorer or sign out/in.

Shell doctor (registry sanity)
```
tools\windows\shell\weftend_shell_doctor.ps1
```
This prints whether `%1/%V` wiring is correct and whether RepoRoot/OutRoot are set.
You can also double-click `tools\windows\shell\weftend_shell_doctor.cmd`.

Operator smoke checklist
- Run the install script.
- Right-click a folder -> WeftEnd: Safe-Run.
- Confirm an output folder is created under `%LOCALAPPDATA%\WeftEnd\Library\`.
- Confirm receipts include `schemaVersion: 0` and `weftendBuild`.
- Confirm the one-line summary includes `privacyLint=PASS`.
