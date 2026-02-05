# SUPPORT_INTAKE.md

This page defines the **minimum, privacy‑clean** information needed for support.
It keeps tickets small, reproducible, and safe to share.

## Required (always)

- `report_card.txt`
- `operator_receipt.json`

## If the question is about change/drift

- `compare_report.txt`
- `compare_receipt.json` (if available)

## If the question is about policy or grading

- `safe_run_receipt.json`
- `intake_decision.json`

## If the question is about host / execution

- `host_status_*.json`
- `host_run_receipt.json` (if used)

## What to include in the message

- The **runId** (from report card)
- The **targetKey** (from report card)
- The **question** you need answered (one sentence)

## What NOT to include

- Raw artifacts or binaries
- Absolute paths or environment dumps
- Screenshots of sensitive data

## Example support message (short)

```
RunId: run_811c9dc5_014
TargetKey: wftndnet
Question: Change flagged (C,D). Is this consistent with a minor HTML edit?
Attached: report_card.txt, compare_report.txt, operator_receipt.json
```
