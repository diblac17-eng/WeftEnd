# REPORT_LIBRARY.md

WeftEnd writes outputs to a local Report Library by default (Windows shell flows).
The library is a plain directory tree. The filesystem is the index.

Layout (example)
WeftEnd\Library\<target>\run_<digest>[_NNN]\

Rules
- Append-only: new runs go into new folders.
- No absolute paths, usernames, or environment values in receipts.
- No timestamps finer than date in folder names.
- No sync, no accounts, no cloud by default.

How to use it
- Baseline: run Safe-Run on a target once.
- Re-check: run Safe-Run after change.
- Compare: use `weftend compare <old> <new> --out <diff>`.
- Report cards show SAME/CHANGED vs baseline.
- Use `weftend library accept-baseline <key>` to promote baseline.

Launchpad (panel) - experimental
- Drop files/folders into `%LOCALAPPDATA%\WeftEnd\Library\Launchpad\Targets`
- Run: `npm run weftend -- launchpad sync --allow-launch --open-library`
- Open Start Menu: **WeftEnd Launchpad** (small panel window)

The library exists to make trust decisions repeatable, not to execute software.
