# AUTO_SCAN.md

WeftEnd watch daemon (Windows v0).

## What it does
- Watches a target (file or directory).
- Runs `safe-run` after change bursts (debounce).
- Writes normal receipts + `watch_trigger.txt`.
- Shows a popup only when CHANGED vs baseline (no auto-accept).

## What it does not do
- Never accepts baseline automatically.
- Never silences CHANGED.
- Never executes native binaries.

## Command

```powershell
npm run weftend -- watch <target> [--policy <path>] [--out-root <dir>] [--debounce-ms <n>] [--mode safe-run]
```

Notes
- `watch_trigger.txt` is a trigger note (not evidence).
- Evidence remains the normal receipts in the library run folder.

## Success criteria
- `watch_trigger.txt` exists in the run folder.
- Report card shows SAME/CHANGED vs baseline.
- Popup appears only when CHANGED (Windows).
