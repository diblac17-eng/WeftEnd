# WHY_RECEIPTS.md

Receipts are WeftEnd's core output. They are deterministic, bounded, and privacy-lint clean.

What receipts are
- A repeatable record of what was observed about an artifact at a specific time.
- A machine-readable summary with stable digests, reasons, and bounds.
- Evidence you can compare later without re-running or trusting memory.

What receipts are not
- Not a verdict about intent.
- Not a malware score.
- Not a sandbox log.
- Not a cloud report.

Why they protect operators
- They let you prove what you did and why, without leaking local paths or secrets.
- They fail closed when inputs are invalid or oversized.
- They allow comparison across versions (baseline vs re-check).

Trust delta mindset
- Baseline: capture a receipt before install or change.
- Re-check: capture a new receipt after download, patch, or config change.
- Compare: get a deterministic diff (drift or no drift).

If a receipt is missing schemaVersion or weftendBuild, it is old-contract and must not be used to assert current invariants.
