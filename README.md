# WeftEnd

WeftEnd is a deterministic intake and evidence tool for operators.
It analyzes artifacts, produces privacy-clean receipts, and lets you compare what changed
without executing unknown code.

Deterministic intake means the same artifact always produces the same receipts, regardless of machine or time.
This makes the output suitable as evidence: you can re-run it later, compare against a baseline,
and prove what changed without trusting memory, logs, or external services.

Why this matters (operator value)
- Evidence you can compare later without re-running or trusting memory.
- Change control you can defend (baseline + compare).
- Privacy-clean outputs you can share in tickets without leaking host details.

Key behaviors
- Analysis-first: native binaries are always WITHHELD (never executed).
- Deterministic receipts: stable ordering, canonical JSON, bounded outputs.
- Baseline memory: runs compare against last accepted baseline (SAME/CHANGED/BLOCKED).
- Host execution exists for WeftEnd releases but is off by default; v0 remains analysis-only for native binaries.

What it is not
- Not an antivirus
- Not a sandbox by default
- Not a cloud service

Who it's for
- IT admins validating tools, installers, and scripts
- Security teams needing reproducible evidence
- Modders/users checking what changed between versions

Free vs premium (intent)
- Core tool is fully functional for personal/manual use.
- Premium adds convenience + scale for organizations (automation and deployment), not different truth or secret features.

Premium examples (convenience only)
- Launchpad deployment across many PCs
- Auto-scan/watch folder workflows
- Ticket-pack automation and standardized evidence bundles
- Priority support and onboarding

Quickstart

```powershell
npm ci
npm run compile --silent
npm run weftend -- safe-run <input> --out out/run
```

Outputs
- `out/run/safe_run_receipt.json` (machine adapter)
- `out/run/operator_receipt.json` (run summary)
- `out/run/README.txt` (receipt info)
- Windows shell wrapper also writes `report_card.txt` in the library run folder.
- Ticket attachments: `npm run weftend -- ticket-pack <outRoot> --out <dir> --zip`

Success & abnormal outcomes (operator view)
- Safe-Run success: report card + receipts exist. WITHHELD is normal for native binaries.
- Compare success: `compare_receipt.json` + `compare_report.txt` exist; verdict SAME/CHANGED.
- Library success: `weftend library` opens root; baseline/changed shown in report card.

WeftEnd includes deterministic Purple/Blue/Orange/Green team suites. See `docs/TEAM_SUITES.md`.
Quick team intent (operator view):

| Team | Intent (short) |
| --- | --- |
| Purple | Change detection + operator-visible signals |
| Blue | Exit codes, report cards, library behavior |
| Orange | No implicit secrets + privacy lint enforcement |
| Green | Release readiness + required artifacts |

Status meanings (short)
- WITHHELD: analyzed, not executed (expected for native binaries).
- DENY: policy/trust gate stopped the run.
- BLOCKED: baseline view frozen until operator accepts/rejects.
- SAME/CHANGED: compare vs baseline result.
- SKIP/NOT_ATTEMPTED: no execution attempted (analysis-only).

Exit codes
- `0` success (even if WITHHELD)
- `40` expected precondition failure
- `1` unexpected/internal error

Troubleshooting
- See `docs/TROUBLESHOOTING.md` for common codes and fixes.

How to use (operator flow)
1) Right-click any file/folder -> Run with WeftEnd.
2) Read `report_card.txt` (opens immediately).
3) Re-run after changes, then compare:
   `npm run weftend -- compare <oldOut> <newOut> --out <diffOut>`
3.5) Optional: create a WeftEnd-run shortcut (analysis first, then launch if baseline OK):
   `npm run weftend -- shortcut create --target <path-to-app.exe> --allow-launch`
3.6) Optional: Launchpad (drop targets -> auto-generate WeftEnd-run shortcuts):
   `npm run weftend -- launchpad sync`
4) Create a ticket bundle when needed:
   `npm run weftend -- ticket-pack <outRoot> --out <ticketDir> --zip`
5) Use the library to track baseline + history:
   `npm run weftend -- library`

Glossary (short)
- Receipt: deterministic JSON artifact (bounded, privacy-clean).
- Report card: human summary for a single run.
- Disclosure: short text required by policy for WARN/DENY. If not required, it may say `DISCLOSURE_NOT_REQUIRED`.
- Appeal bundle: minimal reproducible evidence (no secrets).
- Policy: rules that map reasons -> actions.
- Baseline: last accepted run for a target (SAME/CHANGED/BLOCKED is computed against it).
- Library key: stable folder name for a target (no paths).
- Compare buckets: C=content, X=external refs, R=reasons, P=policy, H=host truth, B=bounds, D=digest.

Keys & trust (v0)
- WeftEnd does not auto-generate real signing keys.
- Demo crypto requires explicit operator intent.
- Host update trust roots and verification are documented in `docs/HOST_UPDATE_MODEL.md`.
- Key discipline and rules are documented in `docs/LAWS_KEYS_AND_SECRETS.md`.

Docs
- `docs/WHAT_IS_WEFTEND.md`
- `docs/WHY_RECEIPTS.md`
- `docs/TEAM_SUITES.md`
- `docs/REPORT_LIBRARY.md`
- `docs/SUPPORT.md`
- `docs/SUPPORT_RECEIPTS.md`
- `docs/SUPPORT_ONBOARDING.md`
- `docs/SUPPORT_FAQ.md`
- `NOTICE.md`
- `docs/PUBLIC_ALPHA.md`
- `docs/INSTALL.md`
- `docs/MINT_PACKAGE_V1.md`
- `docs/INTEGRATION_CONTRACT.md`
- `docs/LOCAL_TESTING.md`
 - `docs/HOST_RUN.md`
 - `docs/HOST_UPDATE_MODEL.md`
 - `docs/LAWS_KEYS_AND_SECRETS.md`
 - `docs/ENTITLEMENTS.md`
