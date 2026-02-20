WeftEnd

WeftEnd is a deterministic evidence, change-tracking, and change-control tool for operators.
It analyzes artifacts, produces privacy-clean receipts, and lets you compare what changed without executing unknown code.

Deterministic evidence means the same artifact produces the same receipts for the same input.
That gives operators defensible baseline and compare workflows without relying on memory, screenshots, or external services.

Why this matters
- Evidence you can re-run and verify later.
- Change control you can defend (SAME / CHANGED / BLOCKED).
- Privacy-clean outputs suitable for tickets and handoffs.

What's new in the latest alpha
- Native report viewer is now the default report experience.
- Report viewer host console launches hidden while the report card window stays visible.
- Notepad is no longer the primary report path (fallback only if needed).
- Launchpad History supports direct report open (button, double-click, Enter).
- CHANGED/BLOCKED accept/decline baseline flow is restored and hardened.
- Shortcut analysis now resolves real .lnk targets/scripts for accurate compare behavior.
- New right-click bind flow:
  - Bind to WeftEnd
  - Unbind from WeftEnd
- .lnk rewrap bind mode preserves icon and restores original shortcut on unbind.
- Structured report artifacts added:
  - report_card_v0.json
  - report_card.txt
- Shell install defaults simplified to two shortcuts:
  - WeftEnd Launchpad
  - WeftEnd Download
- Builder integration contract is available:
  - weftend export-json <outRoot> --format normalized_v0
  - contract: weftend.normalizedSummary/0
- Core/runtime trust hardening sweep included in release scope.
- Release packaging hygiene hardened:
  - internal test/harness payloads are pruned from release bundles
  - unsigned demo native stub binary is excluded from release bundles

Release history and immutable notes
- Release assets are immutable once published.
- Ongoing changes and hardening deltas are tracked in CHANGELOG.md under Unreleased.
- Snapshot release detail is kept in docs/RELEASE_NOTES.txt.

Core behaviors
- Analysis-first posture: native binaries are WITHHELD by default.
- Deterministic receipts: canonical JSON, stable ordering, bounded outputs.
- Baseline memory: each target compares against last accepted baseline.
- Explicit operator control for baseline acceptance and launch gating.
- Optional adapters for external formats (.eml, .mbox, .msg).
- Universal artifact adapter lane for archives, packages, extensions, IaC/CICD, images, documents, SCM, and signature evidence (analysis-only).
- Optional watch mode for automatic re-checks.
- Host execution support exists for WeftEnd release workflows and remains explicitly gated.

What WeftEnd is not
- Not antivirus.
- Not reputation scoring.
- Not cloud analysis.
- Not telemetry-driven triage.

Liability and scope
- WeftEnd is an evidence lens, not an oracle.
- It does not guarantee prevention, legal outcomes, or compliance outcomes.
- Operators remain responsible for trust decisions.

Quickstart
- npm ci
- npm run compile --silent
- npm run weftend -- safe-run <input> --out out/run

Operator workflow (Windows)
1) Right-click file/folder/shortcut -> Run with WeftEnd
2) Review report card
3) Re-run after change
4) Compare baseline status and signals
5) Accept or decline baseline when prompted
6) Optionally create ticket pack

Useful commands
- npm run weftend -- compare <oldOut> <newOut> --out <diffOut>
- npm run weftend -- ticket-pack <outRoot> --out <ticketDir> --zip
- npm run weftend -- library
- npm run weftend -- launchpad sync
- npm run weftend -- export-json <outRoot> --format normalized_v0
- npm run weftend -- adapter list
- npm run weftend -- adapter doctor
- npm run weftend -- adapter doctor --text
- npm run weftend -- safe-run <input> --out <dir> --adapter auto|none|archive|package|extension|iac|cicd|document|container|image|scm|signature
- npm run weftend -- safe-run <input> --out <dir> --adapter archive --enable-plugin tar

Adapter maintenance gate
- Set `WEFTEND_ADAPTER_DISABLE` to temporarily disable adapter lanes without removing code.
- Example: `WEFTEND_ADAPTER_DISABLE=archive,package`.
- Use `WEFTEND_ADAPTER_DISABLE=all` to disable every adapter lane.
- Optional file policy: set `WEFTEND_ADAPTER_DISABLE_FILE=<path-to-json>` with `{"disabledAdapters":["archive","container"]}`.
- Disabled lanes fail closed with `ADAPTER_TEMPORARILY_UNAVAILABLE`.
- Invalid policy tokens fail closed with `ADAPTER_POLICY_INVALID`.
- Adapter policy failures still emit deterministic safe-run evidence artifacts.

Release trust notes
- Standard and portable release zips ship with .sha256 files.
- Portable bundle prefers bundled runtime/node/node.exe.
- Local Node fallback is explicit and fail-closed.

Validation status (latest release state)
- npm run compile --silent: pass
- node dist/src/tools/windows_shell_assets.test.js: pass
- node dist/src/tools/greenteam/release_artifacts_present.test.js: pass
- npm test: pass

WeftEnd roadmap

Current track (active): Operator trust layer
- Deterministic intake, receipts, baseline/compare, report cards, launch gating.
- Windows shell UX and Launchpad reliability.
- Bind/unbind for practical day-to-day gated workflows.
- Ongoing hardening of trust/runtime boundaries.

Near-term roadmap
- Policy pack expansion for operator personas (MSP, DFIR, DevOps).
- Integration templates for CI and downstream tooling using normalizedSummary/0.
- Continued release hardening and verification guidance.
- Additional operator UX polish for history, review, and ticket flows.
- Adapter lane maturity promotion from EXPERIMENTAL to GA based on deterministic fixture coverage and privacy-lint clean outputs.

Mid-term roadmap
- Stronger signing/provenance and verification ergonomics.
- Wider automation pathways while preserving deterministic local evidence.
- Broader platform support for non-Windows operator ergonomics.

Long-term roadmap: WeftEnd beyond tool platform vision
- WeftEnd began as a future-web builder vision: websites built from reusable composable blocks.
- DAG/blockifier foundation exists and remains part of the long-term direction.
- The current security/truth/trust layer is the operational foundation for that platform and became a stand alone tool.
- Planned releases: trusted block execution, deterministic provenance, and reusable block-based web composition.
- Market/exchange layer is planned after trust and operator-grade infrastructure are fully matured.
  
