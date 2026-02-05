# PUBLIC_ALPHA.md

Release scope (alpha)

WeftEnd v0 is a deterministic intake + receipts + compare tool.
It analyzes artifacts, produces privacy-clean receipts, and lets operators compare changes over time.
It does not execute native binaries by default.

Included in alpha
- CLI: examine, intake, safe-run, compare
- Report library (local, append-only)
- Windows shell integration (per-user)
- Portable zip + SHA256 checksum

Free vs premium (intent)
- Core tool is fully functional for personal/manual use.
- Premium adds convenience + scale for organizations (automation and deployment), not different truth.

Explicitly not in alpha
- Marketplace / block market
- Publishing DAG suite
- Cloud services or accounts
- Telemetry or sync by default

Release artifacts
- Portable zip
- sha256 checksum
- No installer, no auto-update

Release tag
- weftend-alpha-0.1

Audience
- IT operators validating vendor drops and tools
- Security teams needing reproducible evidence
- Modders/users who want clarity without execution
