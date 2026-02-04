# SUPPORT_PLAYBOOK

Internal playbook for responding to support requests.

1) Intake template
- What target was analyzed?
- What was the report_card.txt summary?
- Provide compare_report.txt if this is a “changed?” question.
- Provide operator_receipt.json if validation is needed.

2) Triage order (fast)
- Check report_card.txt for STATUS and BUCKETS.
- If CHANGED, check compare_report.txt buckets.
- If BLOCKED, identify baseline decision path.
- If receipts missing, verify output root and shell doctor.

3) Common responses (short)
- WITHHELD on .exe/.msi/.dll is expected.
- CHANGED means digest differs; compare buckets show why.
- BLOCKED means baseline not accepted yet.

4) Never promise
- No guarantees of safety.
- No promises of prevention.
- No statements of malware detection.

5) Escalate to maintainer when
- Receipts fail validation (schema issues).
- Privacy lint fails on WeftEnd outputs.
- Determinism fails (same input -> different outputs).

6) Close-out checklist
- Provide a clear next action (accept/reject baseline, re-run compare, fix output root).
- Confirm operator understands WITHHELD vs DENY vs BLOCKED.
