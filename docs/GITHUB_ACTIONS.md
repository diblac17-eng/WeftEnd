WeftEnd GitHub Actions Integration

Purpose
- Run WeftEnd as a deterministic artifact meter inside GitHub Actions.
- Produce `safe_run_receipt.json`, `operator_receipt.json`, report cards, and optional compare evidence as downloadable workflow artifacts.

Included workflow
- `.github/workflows/weftend_artifact_meter.yml`
- `.github/workflows/weftend_verify360.yml`

What it does
1. Checks out repository content.
2. Installs Node dependencies and compiles WeftEnd.
3. Runs:
   - `weftend safe-run <target_path> --withhold-exec --adapter <adapter>`
4. Optionally runs:
   - `weftend safe-run <baseline_path> ...`
   - `weftend compare ...`
5. Writes a short summary into the Actions run summary.
6. Uploads `out/ci_meter` as workflow artifacts.

Verify gate workflow
- Workflow: `.github/workflows/weftend_verify360.yml`
- Trigger: `workflow_dispatch`
- Runs:
  - `npm run verify:360:release:managed`
- Uploads:
  - `out/verify_360_release_managed`
- Purpose:
  - one-click strict managed release-gate evidence from GitHub Actions.

Dispatch inputs
- `target_path` (required): repository path to analyze.
- `adapter` (required): adapter selection (`auto|none|archive|package|extension|iac|cicd|document|container|image|scm|signature`).
- `baseline_path` (optional): second repository path for compare.

Operator notes
- This workflow is analysis-first and uses `--withhold-exec`.
- It does not add implicit network scans, malware scoring, or auto-execution behavior.
- Any fail-closed precondition still preserves deterministic evidence outputs when available.

Example usage
1. Open Actions -> `weftend-artifact-meter`.
2. Click `Run workflow`.
3. Set:
   - `target_path`: `dist` or `release/weftend.zip`
   - `adapter`: `auto` (or a specific adapter)
   - `baseline_path`: optional second path
4. Download `weftend-artifact-meter` artifact from the run.

Expected outputs
- `out/ci_meter/current/safe_run_receipt.json`
- `out/ci_meter/current/operator_receipt.json`
- `out/ci_meter/current/report_card.txt`
- `out/ci_meter/current/report_card_v0.json`
- `out/ci_meter/current/analysis/adapter_summary_v0.json` (when adapter applied)
- `out/ci_meter/current/analysis/adapter_findings_v0.json` (when adapter applied)
- `out/ci_meter/compare/compare_report.txt` (when `baseline_path` is provided)
