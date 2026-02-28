# SUPPORT_ONBOARDING

Operator onboarding checklist (5-10 minutes).

1) Install (Windows)
- Install the context menu tools.
- Confirm Start Menu shortcuts exist:
  - "WeftEnd Launchpad"
  - "WeftEnd Download"
- Run shell doctor (must show OK for all bindings).

2) First run
- Right-click a folder or zip and choose "Scan with WeftEnd."
- Confirm `report_card.txt` opens.
- Confirm receipts exist in the library run folder.
- For non-web artifacts, `webLane=NOT_APPLICABLE` is normal.

3) Baseline flow
- Run the same target twice.
- If CHANGED appears and change is expected, accept baseline.
- If CHANGED is unexpected, leave baseline unchanged and investigate.

4) Compare flow
- Run compare between two runs to see buckets.
- Keep `compare_report.txt` as the audit artifact.

5) Verify determinism (optional)
- Re-run the same input and confirm identical receipts and digests.

Expected outcome
- Clear report card, receipts present, privacy lint PASS, and a baseline workflow that makes change visible.
