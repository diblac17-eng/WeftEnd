# Changelog

This repository uses immutable releases. Published release assets and their release notes are not edited after publication.
Any correction, hardening pass, or follow-up change is recorded in a newer changelog entry.

## [Unreleased]

### Report Viewer Startup Resilience
- Windows shell report viewer startup now tracks consecutive startup failures in registry (`ReportViewerStartFailCount`).
- Auto-open is no longer disabled on first startup failure; disable now occurs only after thresholded consecutive failures.
- Successful report viewer startup resets failure counter to `0`.
- Wrapper diagnostics now include additive `reportViewerStartupFailures=<count>` when startup fails but threshold disable has not been reached.
- Shell doctor now reports `ReportViewerStartFailCount` to simplify local startup triage.
- Shell doctor now supports `-RepairReportViewer` to reset viewer state (`UseReportViewer=1`, `ReportViewerAutoOpen=1`, `ReportViewerStartFailCount=0`) in one command.
- Shell doctor repair mode now fails closed with exit `40` when repair writes cannot be applied.
- Shell doctor repair failures now emit deterministic code `SHELL_DOCTOR_REPAIR_FAILED`; Launchpad doctor parsing now surfaces this code in repair output/status.
- Launchpad Doctor now includes `Repair Viewer`, which runs shell-doctor repair mode and shows deterministic repair output headers.
- Launchpad adapter doctor parsing now extracts bracketed deterministic reason codes from strict adapter-doctor output instead of returning only generic failure code.
- Shell doctor now emits deterministic terminal status lines (`ShellDoctorStatus: PASS` or `ShellDoctorStatus: FAIL code=SHELL_DOCTOR_CONFIG_INVALID`) so Launchpad can surface stable non-repair failure codes.
- Launchpad adapter doctor strict parsing now also supports `strict.reasons=...` fallback extraction (first deterministic reason code) when bracketed reason lines are absent.
- Launchpad shell doctor parsing now prioritizes explicit `ShellDoctorStatus: FAIL code=...` extraction before generic `code=` fallback parsing.
- Launchpad shell doctor invocation now uses resolved `$powershellExe` path instead of command-name lookup to reduce PATH-dependent behavior drift.
- Launchpad adapter doctor bracket-code parsing now anchors to line-start reason format (`[CODE]`) to avoid accidental non-reason bracket token extraction.
- Launchpad shortcut/history list ordering now uses deterministic UTF-8 byte-key sorting (`Get-StableSortKey`) instead of locale-sensitive `Sort-Object Name`.
- Release ops publish candidate discovery now uses deterministic UTF-8 byte-key sorting (`Get-StableSortKey`) instead of locale-sensitive `Sort-Object FullName`.
- Launchpad shell doctor fail-code parsing now anchors to full `ShellDoctorStatus: FAIL code=...` lines for stricter deterministic code extraction.
- Launchpad adapter doctor `strict.reasons=` fallback parsing now accepts spaced reason lists and validates extracted code tokens before surfacing them.
- Release ops script now enforces `Set-StrictMode -Version Latest` for fail-closed handling of unbound/implicit script-state issues.
- Release zip wrapper and Windows icon-regeneration paths now invoke resolved PowerShell executable paths (`$powershellExe` / `$iconHostExe`) instead of command-name `powershell` lookup.
- Release zip wrapper now enforces strict mode and normalizes repo-root resolution to explicit `.Path` for stable script-path handling.
- Shell doctor CMD wrapper now resolves `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` first (with fallback) instead of direct command-name invocation.
- Windows context-menu command registration now uses resolved PowerShell host path (`$psMenuHostExe`) instead of bare `powershell.exe` command-name lookup.
- Windows helper wrappers (`OPEN_RELEASE_FOLDER.cmd`, `INSTALL_WINDOWS.cmd`, `UNINSTALL_WINDOWS.cmd`, `FIRST_5_MINUTES.cmd`) now resolve `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` first (with fallback) before invocation.
- `tools/windows/open_release_folder.ps1` and `tools/windows/weftend_release_zip.ps1` now invoke resolved `$powershellExe` path and avoid command-name `powershell` lookup drift.
- Added/updated Windows shell asset contract coverage for context-menu host command resolution and Windows CMD wrapper PowerShell host-path resolution invariants.
- CLI `launchpad`, `shortcut`, and `watch` commands now resolve PowerShell host path (`%WINDIR%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` when available) before spawn instead of direct command-name lookup.
- Added contract coverage to pin CLI PowerShell host-path resolution invariants and prevent regression to literal `spawnSync("powershell.exe", ...)` usage.
- Bind metadata writes now avoid wall-clock timestamp fields (`createdAtUtc`) to remove non-deterministic bind-state drift.
- Added shell-asset contract coverage to pin no-`UtcNow`/no-`createdAtUtc` behavior in `weftend_bind.ps1`.
- Updated Windows shell asset contract coverage to pin startup failure-counter behavior.
- Launchpad History report-open success now resets viewer startup state (`UseReportViewer=1`, `ReportViewerAutoOpen=1`, `ReportViewerStartFailCount=0`) so operator manual opens can self-heal auto-open disable state.

### Evidence typing in reports
- Windows `report_card.txt` now includes an additive evidence legend and claim mapping block:
  - `EVIDENCE TAGS: ...`
  - `evidence.classification=[INF]`
  - `evidence.observed=[OBS]`
  - `evidence.posture=[POL]`
  - `evidence.privacyLint=[SYS]`
  - `evidence.buildDigest=[SYS]`
- `report_card_v0.json` now includes additive `evidence` metadata (`legend` + `claims`) for the same claim typing.
- `compare_report.txt` now includes additive evidence legend and claim mapping lines for verdict/buckets/digest and related compare claims.
- Added/updated contract coverage:
  - Blue Team report card contract now requires evidence legend/mapping presence.
  - Compare CLI smoke now requires compare-report evidence legend/mapping presence.
  - Blue Team report card contract now also enforces no wall-clock timestamp strings or `createdAt`/`updatedAt` fields in `report_card.txt` and `report_card_v0.json`.

### Per-file staged finalize hardening
- Compare output text artifacts now write with per-file stage/finalize (`<file>.stage -> <file>`) inside the existing staged out-root flow.
- Ticket-pack summary/manifest/checksum artifacts now write with per-file stage/finalize inside `ticket_pack.stage`.
- `safe-run`, `run`, and `examine` text artifact writers now use per-file stage/finalize semantics.
- `email unpack` export text artifacts and attachment file writes now use per-file stage/finalize semantics.
- `intake` staged outputs (`intake_decision.json`, `disclosure.txt`, `appeal_bundle.json`) now write with per-file stage/finalize before out-root finalize.
- `container scan` staged artifacts (`safe_run_receipt.json`, README, capability/adapter analysis JSON) now use per-file stage/finalize writes.
- Host update staging now writes `host_self_manifest.json` with per-file stage/finalize semantics before host root swap.
- Added regression assertions in compare/ticket-pack smoke tests to fail on any leftover `*.stage` files in finalized outputs.
- Added run/examine/intake smoke assertions to fail on any leftover `*.stage` residue inside finalized out-roots.
- Added safe-run/email/container smoke assertions to fail on any leftover `*.stage` residue inside finalized out-roots.
- Validation status for this hardening batch: `npm run compile --silent` pass, `npm test` pass.

### GitHub Actions integration
- Added `.github/workflows/weftend_artifact_meter.yml` for manual CI artifact-meter runs (`workflow_dispatch`).
- Workflow executes deterministic `safe-run` (analysis-only, `--withhold-exec`) with optional baseline compare.
- Workflow uploads `out/ci_meter` receipts/reports as downloadable artifacts and writes a bounded run summary.
- Added `.github/workflows/weftend_verify360.yml` for manual strict managed verify-gate runs.
- Verify workflow executes `npm run verify:360:release:managed` and uploads `out/verify_360_release_managed`.
- Verify workflow now pins strict release fixture smoke input (`WEFTEND_RELEASE_DIR=tests/fixtures/release_demo`) and clears skip override.
- Added `docs/GITHUB_ACTIONS.md` with setup, inputs, and expected outputs.
- Updated `docs/QUICKSTART.txt` GitHub Actions section to include both workflows and managed verify output path.
- Updated `docs/RELEASE_CHECKLIST_ALPHA.md` with optional GitHub Actions parity runs for both workflows.
- Updated `docs/RELEASE_CHECKLIST_ALPHA.md` with immutable-release change record checks for `CHANGELOG.md` and `docs/RELEASE_NOTES.txt`.
- Added `docs/RELEASE_HISTORY.md` as the dedicated immutable release-history record page.
- Updated `docs/RELEASE_CHECKLIST_ALPHA.md` immutable-change checks to include `docs/RELEASE_HISTORY.md`.
- Updated `docs/RELEASE_CHECKLIST_ALPHA.md` to explicitly call out managed strict-gate release-smoke env enforcement (`WEFTEND_RELEASE_DIR`, `WEFTEND_ALLOW_SKIP_RELEASE`).
- Updated legacy `docs/RELEASE_CHECKLIST.md` to explicitly point operators to active `docs/RELEASE_CHECKLIST_ALPHA.md`.
- Refreshed `docs/RELEASE_ANNOUNCEMENT.txt` to match current adapter expansion, verify-gate, and workflow scope.
- Updated release packaging to include `CHANGELOG.md` in staged bundle and copied release-sidecar artifacts.
- Updated release packaging to include `RELEASE_HISTORY.md` in copied release-sidecar artifacts.
- Updated `verify:360` docs-sync and etiquette targets to include `CHANGELOG.md`, release notes, release announcement, and release history references.
- Updated `docs/GIT_POSTING_ETIQUETTE.md` to match verify etiquette target set (includes `CHANGELOG.md` and `docs/RELEASE_HISTORY.md`).

### Safe-run evidence corridor
- `safe-run` now verifies expected receipt artifacts for presence and digest consistency before completion.
- `safe-run` now flags unmanaged pre-existing output files anywhere under out-root as deterministic orphan-evidence warnings.
- Analysis is not blocked by these checks; warning codes are recorded in `operator_receipt.json` (`SAFE_RUN_EVIDENCE_*`).
- Added explicit smoke-test coverage for root-level stale output detection under the same non-blocking warning model.
- `safe-run` output now stages/finalizes (`<out>.stage` -> `<out>`), replacing stale out-roots and preventing partial safe-run output residue from appearing as finalized evidence.
- `safe-run` staged finalize preserves deterministic stale-output signaling by carrying `SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT` when unmanaged pre-existing out-root files were present before write.
- `operator_receipt.json` now carries additive digest links for `weftend/README.txt` and run sub-receipts (`analysis/*`, `host/*`) for stronger evidence-chain traceability.
- `safe-run` now writes `analysis/capability_ledger_v0.json` for raw-input adapter lanes, recording deterministic requested/granted/denied adapter and plugin capability decisions.
- `container scan` now writes the same deterministic `analysis/capability_ledger_v0.json` artifact in success and fail-closed paths for consistent container capability evidence.
- Windows report viewer now renders adapter evidence as an optional collapsed section (only when adapter/capability artifacts are present) with quick-open artifact actions.
- Report viewer summary now includes report-card/safe/operator plus compare receipt/report digests and provides `Copy Digests` for digest-only share/export text.
- Report viewer now supports keyboard copy shortcuts: `Ctrl+C` (summary) and `Ctrl+Shift+C` (digest-only).
- Report viewer summary panel now also surfaces `Status`, `Run Id`, and `Library Key`; summary copy output includes `libraryKey`.
- Launchpad History now shows a compact adapter tag (including plugin marker and denied-capability marker) from the latest run evidence.
- Launchpad History now includes an inline details pane for the selected row, surfacing adapter class/id/mode/source/reasons and capability counts without opening the full report viewer.
- Launchpad History now provides direct actions to open selected latest run folders and adapter evidence (`analysis`) folders.
- Launchpad History now falls back to newest `run_*` folder detection when `view_state.json` latest pointers are missing/stale.
- Launchpad History fallback now reads `report_card_v0.json`/`report_card.txt` to recover status/buckets/baseline when view-state metadata is incomplete.
- Launchpad History now provides `Copy Details` for selected inline adapter evidence summaries.
- Launchpad History now supports `Ctrl+C` copy from history list/details for faster evidence sharing.
- Launchpad History now provides `Copy Digests` for digest/fingerprint-only clipboard output.
- Launchpad History now supports `Ctrl+Shift+C` digest-only copy from history list/details.
- Launchpad History details now include artifact fingerprint/digest plus report-card/safe/operator and compare receipt/report digests for quick cross-verification.
- Report viewer and Launchpad History details now also include compare semantics (`Compare Verdict`, `Compare Buckets`, `Compare Bucket Count`, `Compare Change Count`) with deterministic compare-report fallback when compare receipt JSON is missing.
- Report viewer and Launchpad History digest surfaces now also include `Privacy Lint Digest` (`weftend/privacy_lint_v0.json`) for faster cross-verification.
- Replaced remaining locale-sensitive sorting in harness/test deterministic helpers with ordinal comparators to remove locale/ICU-dependent ordering drift in verification paths.
- Launchpad Doctor tab now includes `Run Adapter Doctor` (text mode) so adapter/plugin maintenance health can be checked directly from UI.
- Launchpad Doctor tab now includes `Run Adapter Doctor (Strict)` for fail-closed adapter maintenance checks from UI.
- Launchpad Doctor tab now includes `Copy Doctor Output` and `Ctrl+C` clipboard support in doctor output pane for faster support sharing.
- Launchpad Doctor shell output is now normalized with deterministic headers (`Shell doctor exitCode=...`, `Shell doctor code=...`) to match adapter doctor triage shape.
- Ticket-pack test coverage now enforces adapter evidence artifact carry-through (`analysis/capability_ledger_v0.json`, `analysis/adapter_summary_v0.json`, `analysis/adapter_findings_v0.json`) when those artifacts are present in a run.
- Ticket-pack default extras now include `report_card_v0.json` so structured report output is carried with ticket bundles when available.
- Ticket-pack summaries now include adapter evidence fields (`adapterEvidence`, adapter identity, capability counts) for faster operator/support triage.
- Ticket-pack summaries now also include digest identity fields (`operatorReceiptFileDigest`, `safeReceiptFileDigest`, `reportCardFileDigest`) and artifact fingerprint/digest.
- Ticket-pack digest identity lines now also include `privacyLintReportFileDigest` (`weftend/privacy_lint_v0.json`) for stronger cross-verification.
- Ticket-pack summaries now include report state context fields (`reportRunId`, `reportLibraryKey`, `reportStatus`, `reportBaseline`, `reportLatest`, `reportBuckets`) for faster triage without opening report files.
- Ticket-pack summaries now include compare artifact identity fields (`compareArtifacts`, `compareReceiptFileDigest`, `compareReportFileDigest`) for quick compare-evidence triage.
- Ticket-pack summaries now also include compare semantics fields (`compareVerdict`, `compareBuckets`, `compareBucketCount`, `compareChangeCount`) with deterministic `compare_report.txt` fallback when `compare_receipt.json` is absent.
- Ticket-pack now writes to a staged directory (`ticket_pack.stage`) and finalizes atomically to `ticket_pack` after privacy-lint pass, preventing partial bundle residue from appearing as finalized output.
- On Windows `--zip`, ticket-pack archive output now also stages/finalizes (`ticket_pack.zip.stage` -> `ticket_pack.zip`) so partial zip artifacts do not appear as finalized bundles.
- Ticket-pack now enforces staged evidence-chain completeness before finalize (`TICKET_PACK_EVIDENCE_CHAIN_INVALID`), failing closed when orphan or missing staged files are detected.
- Compare now writes to a staged output root (`<out>.stage`) and finalizes atomically to `<out>` after receipt/report/privacy checks, preventing partial compare output residue from appearing as finalized evidence.
- Compare CLI smoke tests now pin staged-finalize replacement behavior (pre-existing stale output roots are replaced and no `.stage` residue remains on success).
- Compare now fails closed when `--out` conflicts with either input root (`COMPARE_OUT_CONFLICTS_INPUT`), preventing destructive finalize collisions.
- Compare operator receipts now include full compare evidence pointers (`compare_receipt.json`, `compare_report.txt`, `weftend/README.txt`) for stronger out-root evidence-chain completeness.
- Compare operator receipts now also include `weftend/privacy_lint_v0.json`, and compare now performs a final no-write privacy-lint recheck after final operator-receipt write.
- Compare now enforces a no-orphan evidence contract before finalize (`COMPARE_EVIDENCE_CHAIN_INVALID`), requiring all produced compare artifacts (except `operator_receipt.json`) to be referenced in operator receipt entries.
- `run` command output now stages/finalizes (`<out>.stage` -> `<out>`), replacing stale out-roots and preventing partial run-output residue from appearing as finalized evidence.
- `run` staged finalize now records stale-output presence as deterministic operator warning (`SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT`) before replacing pre-existing unmanaged out-root files.
- `email unpack` output now stages/finalizes (`<out>.stage` -> `<out>`), replacing stale out-roots and preventing partial email-export residue from appearing as finalized output.
- `email safe-run` now prepares source-email normalization in a temporary workspace outside the target out-root, preventing self-input collisions and false orphan-output warnings under staged safe-run finalize behavior.
- `export-json` normalized summary output now stages/finalizes (`<out>.stage` -> `<out>`), preventing partial output residue and guaranteeing stale file replacement on successful finalize.
- `examine` output now stages/finalizes (`<out>.stage` -> `<out>`), replacing stale out-roots and preventing partial examine-output residue from appearing as finalized evidence.
- `intake` output now stages/finalizes (`<out>.stage` -> `<out>`), replacing stale out-roots and preventing partial intake-output residue from appearing as finalized evidence.
- `license issue` output now stages/finalizes (`<out>.stage` -> `<out>`), preventing partial output residue and guaranteeing stale license-file replacement on successful finalize.
- Library view-state persistence now writes `baseline.txt`, `latest.txt`, `blocked.txt`, and `view_state.json` with staged atomic finalize semantics, and returns explicit fail-closed write error codes on library-state write/clear failures.
- Watch trigger output now stages/finalizes `watch_trigger.txt` atomically and cleans `.stage` residue on write failure.
- `run` operator receipts now include deterministic entry coverage for mint/decision/disclosure/appeal/readme artifacts and perform evidence presence/digest/orphan checks before finalize summary output.
- Safe-run/container evidence verification now treats `*_receipt.json` artifacts as presence-only evidence links (not raw file-digest comparisons), removing false `SAFE_RUN_EVIDENCE_DIGEST_MISMATCH` warnings in nominal flows.
- Safe-run/container no longer silently swallow library view update failures after finalize; failures are now surfaced with explicit deterministic reason codes while preserving completed run artifacts.
- `verify:360` now enforces a stage-residue gate (`stage_residue` step), failing closed with `VERIFY360_STAGE_RESIDUE_PRESENT` when `.stage` artifacts remain in deterministic run outputs.
- `verify:360` stage-residue checks now execute across pass/partial/fail lanes (including dependency-missing, pair-failure, and fail-closed exception paths) and now scan the full temporary verify workspace so sibling `<out>.stage` roots are detected.
- `verify:360:harness` now asserts `stage_residue` step presence in verify reports across pass/partial/fail lanes.
- `verify_360_audit` now fails closed on any `.stage` residue under the verify out-root (`VERIFY360_AUDIT_STAGE_RESIDUE_PRESENT`).
- `verify:360:harness` now injects/removes an audit stage-residue probe to pin strict audit residue detection.
- Added Green Team runtime coverage for strict audit stage-residue behavior (`src/tools/greenteam/verify_360_audit_stage_residue.test.ts`).
- Ticket-pack contract tests now pin report-state parsing from `report_card_v0.json` and enforce digest-line format (`sha256:<64hex>`) for ticket summary identity fields.
- Ticket-pack contract tests now also pin text fallback parsing from `report_card.txt` (`STATUS/BASELINE/LATEST/BUCKETS` and key-value lines) when structured report JSON is absent.
- Windows shell report card outputs now surface adapter evidence directly:
  - `report_card.txt` includes additive `adapterMeta=` and `capabilities=` lines when adapter evidence exists.
  - `report_card_v0.json` includes additive `adapter` metadata/capability object for automation and UI parity.
- `container scan` now also preserves deterministic evidence artifacts on fail-closed preconditions (`safe_run_receipt.json` and `operator_receipt.json` are written before exit 40).
- `container scan` now applies the same evidence-corridor checks as safe-run: expected receipt artifacts are verified for presence/digest consistency and unmanaged pre-existing outputs are surfaced as deterministic `SAFE_RUN_EVIDENCE_*` warnings.
- `container scan` output now uses staged finalize (`<out>.stage` -> `<out>`), replacing stale out-roots and preventing partial scan output residue from appearing as finalized evidence.
- `container scan` staged finalize preserves deterministic stale-output signaling by carrying `SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT` when unmanaged pre-existing out-root files were present before scan write.
- `verify:360` now includes an `adapter_doctor` step and capability record; strict adapter doctor mode can be enabled with `WEFTEND_360_ADAPTER_DOCTOR_STRICT=1` to capture maintenance-policy/plugin strict failures as explicit PARTIAL evidence.
- `verify:360` now captures adapter doctor output quietly to keep gate console output focused while preserving adapter doctor evidence in verify receipts/reports.
- Added `npm run verify:360:adapter:strict` helper to run full verify with strict adapter doctor mode enabled.
- `verify:360` idempotence key context now includes strict-mode flags to avoid replay-key collisions between strict and non-strict runs.
- Added optional `WEFTEND_360_SAFE_RUN_ADAPTER` override for verify deterministic safe-run pair; value is validated and included in idempotence/report policy context.
- Invalid `WEFTEND_360_SAFE_RUN_ADAPTER` values now fail closed inside verify corridor while still writing fail receipt/report evidence (`VERIFY360_SAFE_RUN_ADAPTER_INVALID`).
- `verify:360:harness` now validates invalid-adapter fail path, pointer non-advance, and evidence persistence.
- Added `WEFTEND_360_FAIL_ON_PARTIAL=1` behavior and helper scripts to enforce non-zero exit on PARTIAL verify verdicts when required by release policy.
- `verify_360_report.txt` now includes explicit policy and adapter-doctor strict summary lines for faster operator review (`policy.*`, `adapterDoctor.*`).
- `verify:360:harness` now asserts those policy/adapter-doctor report lines are present across pass/replay/fail lanes.
- When fail-on-partial policy blocks a PARTIAL verdict, verify output now prints `blocked_by_policy` and receipt interpretation records `partialBlockedByPolicy=1`.
- Added `npm run verify:360:release` helper for a single strict release gate command (`adapter doctor strict + fail-on-partial + strict audit`).
- Added `npm run verify:360:release:cleanout` helper to execute the strict release gate after resetting a dedicated verify out-root.
- Documented expected strict-gate behavior: clean out-root removes history-noise, but unresolved strict adapter-doctor requirements still block release gate.
- Added `npm run verify:360:release:managed` helper to generate a temporary adapter maintenance policy for missing-plugin lanes, run strict adapter-doctor preflight with that policy, then run strict verify gate without leaking adapter-disable policy into full test env.
- Managed strict release helper now captures adapter-doctor preflight output quietly and only prints captured output on failure.
- Managed strict release helper now enforces explicit release fixture smoke (`WEFTEND_RELEASE_DIR`), clears skip override (`WEFTEND_ALLOW_SKIP_RELEASE`), and fails closed if release fixture directory is missing.
- Managed strict release helper default fixture path is now canonical forward-slash (`tests/fixtures/release_demo`) to avoid Windows backslash/UNC privacy-lint false positives.
- Added Green Team contract test for `.github/workflows/weftend_artifact_meter.yml` to enforce analysis-only workflow behavior (`--withhold-exec`) and deterministic artifact upload path invariants.
- Added Green Team contract test for `scripts/verify_360_release_managed.js` to enforce strict adapter-doctor preflight contract and no adapter-disable env leakage into full `verify:360` runs.
- Added Green Team contract test for `src/runtime/container/docker_probe_v0.ts` to pin local-only Docker command surface (`version`, `image inspect`) and block pull/login/run/build drift.
- Added Green Team contract test for `.github/workflows/weftend_verify360.yml` to pin managed verify workflow command and artifact path invariants.
- Added Green Team docs release contract test to pin workflow/command references across README/Quickstart/Release Notes/Actions guide.
- Extended docs release contract coverage to include `docs/RELEASE_CHECKLIST_ALPHA.md`.
- Extended docs release contract coverage to enforce immutable-release checklist references (`CHANGELOG.md`, `docs/RELEASE_NOTES.txt`, `docs/RELEASE_HISTORY.md`).
- Extended docs release contract coverage to enforce release announcement workflow/managed-verify references.
- Extended release bundle contract coverage to enforce `CHANGELOG.md` in packaging/checklist outputs.
- Extended release bundle contract coverage to enforce sidecar parity for release notes/announcement/quickstart/checklist/history outputs.
- Added Green Team contract test for `verify_360` docs-sync target coverage (`CHANGELOG.md`, release announcement, release notes).
- Added `npm run proofcheck:release` wrapper to enforce strict release-smoke proofcheck (`WEFTEND_RELEASE_DIR` required, skip override cleared).
- Added Green Team contract test for `scripts/proofcheck_release.js` strict behavior.
- Updated release bundle manifest contract to require `scripts/proofcheck_release.js` presence.
- `verify:360:harness` now validates strict-mode idempotence separation (`NEW` then `REPLAY`) to prevent strict/non-strict replay-key regression.
- Emergency verify report output now includes policy summary lines (`policy.*`) and failure receipts carry interpreted policy fields for consistent fail-closed readability.
- `privacy_lint` report output now uses staged atomic finalize (`privacy_lint_v0.json.stage` -> `privacy_lint_v0.json`) to prevent partial report residue.
- Added runtime test coverage that asserts privacy-lint staged finalize behavior and no leftover `.stage` file.
- `host_status` receipt emission now uses staged atomic finalize (`host_status_*.json.stage` -> `host_status_*.json`).
- `host_update` receipt emission now uses staged atomic finalize (`host_update_receipt.json.stage` -> `host_update_receipt.json`).
- Added host runtime test assertions that no host receipt `.stage` files remain after finalize.
- Shared README receipt writer now uses staged atomic finalize (`weftend/README.txt.stage` -> `weftend/README.txt`).
- Added runtime coverage for deterministic README build/write and no leftover README `.stage` residue.
- Shared operator receipt writer now uses staged atomic finalize (`operator_receipt.json.stage` -> `operator_receipt.json`).
- Host runner receipt output now uses staged atomic finalize (`host_run_receipt.json.stage` -> `host_run_receipt.json`).
- Added runtime coverage for deterministic operator receipt build/write and no leftover operator receipt `.stage` residue.
- Added host CLI smoke assertions that host/operator receipt `.stage` files do not remain after finalize.

### Adapter maintenance controls
- Added `weftend adapter doctor` for deterministic adapter readiness/maintenance reporting.
- Added `weftend adapter doctor --text` for a human-readable maintenance report with deterministic local actions.
- Added `weftend adapter doctor --strict` for fail-closed maintenance checks (invalid policy and unresolved missing-plugin requirements return exit 40).
- Strict doctor JSON output now includes `strict.status` and `strict.reasonCodes` for machine-readable policy/plugin gate decisions.
- Added smoke coverage for strict text-mode failure (`adapter doctor --text --strict` fail-closed output contract).
- Added `weftend adapter doctor --write-policy <path> [--include-missing-plugins]` to generate maintenance policy files.
- Policy writer output is now finalized atomically using a two-phase stage/finalize flow (`<path>.stage -> <path>`), with explicit fail-closed write error on output failure.
- `--include-missing-plugins` is now accepted only with `--write-policy`, removing silent no-op flag behavior.
- Added fail-closed adapter maintenance policy gate using `WEFTEND_ADAPTER_DISABLE=<adapter[,adapter...]>`.
- Added optional file policy source `WEFTEND_ADAPTER_DISABLE_FILE=<path-to-json>` for release/operator maintenance profiles.
- Added `policies/adapter_maintenance.example.json` and `docs/ADAPTER_MAINTENANCE_POLICY.md` for maintenance policy bootstrapping.
- Added explicit unreadable policy-file coverage (`ADAPTER_POLICY_FILE_UNREADABLE`) in adapter doctor and safe-run smoke tests.
- `container scan` now applies the same maintenance-policy gate for `container` lane control.
- Disabled adapter lanes now fail closed with `ADAPTER_TEMPORARILY_UNAVAILABLE` + `ADAPTER_DISABLED_BY_POLICY`.
- Invalid maintenance policy tokens now fail closed with `ADAPTER_POLICY_INVALID`.
- `safe-run` now preserves deterministic evidence artifacts (`safe_run_receipt.json`, `operator_receipt.json`, analysis receipts) even when adapter maintenance policy fails closed.

### Adapter strict-route hardening
- Clarified package/AppImage adapter docs: analysis-only lane never rewrites ELF bytes and never executes payloads.
- CI/CD adapter discovery/path coverage now explicitly includes `.gitlab-ci.yaml` and `azure-pipelines*.yaml` in addition to existing `.yml` patterns.
- IaC adapter discovery now explicitly includes `.template` to match implemented route support.
- Added explicit adapter/runtime and CLI regression coverage for `.gitlab-ci.yaml` success and `azure-pipelines.yaml` path-hint-only fail-closed behavior.
- Auto adapter CI/CD path hint matching is now canonical-name based to avoid backup/substring false positives forcing CICD route failures.
- Container strict OCI routes now require digest refs on every manifest entry and require digest refs to resolve to local blob entries.
- Container strict tar routes now require canonical root markers and unique root marker entries for Docker/OCI marker files.
- Container strict Docker tar routes now require complete manifest entries (config plus layers) and full reference resolution.
- Container strict Docker/OCI tar routes now require non-ambiguous reference resolution (duplicate referenced tar paths fail strict routing).
- Container strict tar routes now require non-ambiguous tar entry-path sets (duplicate or case-colliding tar paths fail strict routing).
- Container strict directory routes now also require non-ambiguous entry-path sets (duplicate or case-colliding directory paths fail strict routing).
- Container strict classification now uses tar entry evidence only and no longer accepts tar filename hints.
- Container strict SBOM routes now require meaningful identity evidence (`name`, `purl`, `SPDXID`, or `bom-ref`).
- Compose strict routing now requires in-service `image` or `build` evidence (out-of-service hints do not satisfy strict checks).
- SCM strict routing now requires non-ambiguous worktree entry-path sets (duplicate or case-colliding paths fail strict routing).
- IaC/CI strict routing now requires non-ambiguous entry-path sets (duplicate or case-colliding paths fail strict routing).

### Document strict-route hardening
- PDF strict route now requires object-syntax evidence and `startxref` marker evidence.
- OOXML strict route now requires primary-part evidence (`word/document.xml` for `.docm`, `xl/workbook.xml` for `.xlsm`).
- Added regression coverage for strict missing-primary-part `.xlsm` and `.docm` scenarios.
- OOXML strict route now enforces unique required-marker cardinality (`[Content_Types].xml` and primary-part path must each appear exactly once).
- OOXML strict route now enforces non-ambiguous OOXML entry-path sets (duplicate or case-colliding entry paths fail strict routing).
- OOXML strict route now requires type-specific relationship evidence (`word/_rels/document.xml.rels` for `.docm`, `xl/_rels/workbook.xml.rels` for `.xlsm`, or root `_rels/.rels`).
- OOXML strict route now requires non-ambiguous relationship-marker cardinality (duplicate root/type-specific relationship markers fail closed).

### Extension strict-route hardening
- Extension strict route now requires canonical root `manifest.json` for packaged extensions.
- Nested-only manifest paths no longer satisfy strict extension routing.
- Duplicate root `manifest.json` entries now fail closed in strict mode.
- Strict extension package routes now require non-ambiguous entry-path sets (duplicate or case-colliding entry paths fail strict routing).
- Strict extension unpacked routes now also require non-ambiguous entry-path sets (duplicate or case-colliding entry paths fail strict routing).

### Package strict-route hardening
- Package ZIP structure checks now require canonical marker paths for `.msix`, `.nupkg`, and `.whl`.
- Nested lookalike ZIP markers no longer satisfy strict package routing.
- Strict package ZIP structure now enforces unique required-marker cardinality for `.msix`, `.nupkg`, `.whl`, and `.jar`.
- Strict package ZIP marker cardinality now evaluates raw ZIP entry catalogs, so duplicate same-path required markers fail closed.
- Strict package entry-path sets now require non-ambiguous paths (duplicate or case-colliding package entry paths fail strict routing).
- Strict `.deb` structure checks now require non-ambiguous required-entry cardinality (duplicate required structure entries fail strict routing).
- Strict compressed package-tar plugin route now requires non-ambiguous entry-path sets from plugin listing output (duplicate or case-colliding entry paths fail strict routing).
- Archive/package compressed tar coverage now includes `.tar.bz2` (and `.tbz2/.tbz` aliases) under the same explicit tar-plugin fail-closed policy as other compressed tar formats.
- `weftend adapter list` now explicitly includes `.tbz2/.tbz` alias formats for archive/package lanes.
- Strict `.appimage` package routing now requires valid ELF ident fields (class/data/version) in addition to ELF magic/runtime markers.
- Package adapter plugin applicability now accepts `--enable-plugin tar` for compressed package-tar formats and still fails closed on non-applicable package formats.
- Added regression coverage for package tar-plugin routing (accepted compressed package-tar path and non-applicable plugin rejection).

### Archive strict-route hardening
- Strict `.zip` and `.tar` archive routes now require non-ambiguous entry paths (duplicate or case-colliding entry paths fail strict routing).
- Strict plugin archive routes (`.tgz/.tar.gz/.txz/.tar.xz/.7z`) now also require non-ambiguous entry-path sets from plugin listing output (duplicate or case-colliding entry paths fail strict routing).

### Validation status for this unreleased batch
- `npm run compile --silent`: pass
- `node dist/src/runtime/adapters/artifact_adapter_v1.test.js`: pass
- `node dist/src/cli/adapter_cli_smoke.test.js`: pass
- `npm run verify:360 --silent`: pass

## [Alpha 0.3] - 2026-02-13

Baseline release for Windows shell + trust hardening bundle.
Full detail is kept in `docs/RELEASE_NOTES.txt`.
