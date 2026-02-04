# SUPPORT_RECEIPTS

How to interpret WeftEnd outputs (operator view).

Primary human artifact
- report_card.txt (short summary of one run)

Primary audit artifacts
- safe_run_receipt.json
- operator_receipt.json
- compare_report.txt
- compare_receipt.json

Status meanings (short)
- WITHHELD: analyzed, not executed (expected for native binaries).
- DENY: policy/trust gate stopped the run.
- BLOCKED: baseline view frozen until operator accepts/rejects.
- SAME/CHANGED: compare vs baseline result.
- SKIP/NOT_ATTEMPTED: no execution attempted (analysis-only).

What “good” looks like
- Report card exists and contains STATUS, BASELINE, LATEST, HISTORY.
- Receipts validate (schemaVersion present).
- Privacy lint PASS.

What to do when you see CHANGED
1) Read compare_report.txt for buckets.
2) Decide whether change is expected.
3) If expected, accept baseline.
4) If unexpected, leave baseline unchanged and investigate.

Common buckets (short)
- C: content changed (files/bytes or file-kind counts)
- X: external references changed
- R: reason codes changed
- P: policy digest changed
- H: host truth changed
- B: boundedness markers changed
- D: digest changed (always important for change detection)

Notes
- Receipts are deterministic: same input yields same output.
- WeftEnd does not execute native binaries by default.
