# PREMIUM_OPERATIONS.md

This document defines how Premium support is delivered without over‑promising.
It is an **operational playbook**, not a security guarantee.

## What Premium does (in practice)

Premium provides:
- **Interpretation** of receipts and compare reports (fast triage).
- **Baseline calibration** guidance (what to accept, what to block).
- **Operational setup** for Launchpad / watch flows.
- **Priority response** when an operator flags a change.

Premium does NOT provide:
- Malware verdicts or prevention guarantees.
- Compliance certification.
- Remote access to systems.

## How “interpretation support” works

You send a **ticket pack** (or report card + compare report):
- `report_card.txt`
- `compare_report.txt` (if change‑related)
- `operator_receipt.json` (optional)
- `safe_run_receipt.json` (optional)

Support responds with:
- **Classification** (what changed and where)
- **Impact category** (low / medium / high)
- **Recommended next step** (accept / block / verify / request snapshot)

We never request raw artifacts by default.

## Interpretation checklist (what support does)

1) Verify run validity
   - schemaVersion present
   - privacyLint PASS
   - buildDigest present

2) Check compare buckets
   - DIGEST_CHANGED? (always a change)
   - CONTENT_CHANGED? (new/removed file types)
   - EXTERNAL_REFS_CHANGED? (domains added)
   - REASONS_CHANGED? (policy outcomes changed)
   - BOUNDS_CHANGED? (truncation risk)

3) Classify change
   - **Benign update:** content changed, no new external refs.
   - **Dependency drift:** external refs changed.
   - **Policy shift:** reason codes or policy digest changed.
   - **Suspicious signal:** bounds changed or new native binary appears.

4) Recommend action
   - Accept baseline
   - Block and request approval
   - Request publisher snapshot (if available)

## Baseline calibration (how support helps)

Baseline policy is operator‑owned. Support helps tune it:

**Default conservative rules**
- Block if EXTERNAL_REFS_CHANGED and new domains appear.
- Block if a new native binary appears.
- Block if BOUNDS_CHANGED (potential stuffing).

**Allowlist tuning**
- Allow known update domains.
- Allow known vendor signatures or snapshot IDs (future).

**Escalation rules**
- Changes with new external refs → ticket escalation.
- Content changes with no ref changes → review then accept.

## Example response (what you receive)

Classification:
  - Change type: CONTENT_CHANGED + DIGEST_CHANGED
  - External refs: unchanged
Impact:
  - Low (likely patch)
Recommendation:
  - Accept baseline if update is expected.

## Operator notes

Premium support is about **correct interpretation and repeatable decisions**.
It does not replace operator judgment.
