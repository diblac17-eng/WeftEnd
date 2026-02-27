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
- Workflow pins strict release fixture smoke input:
  - `WEFTEND_RELEASE_DIR=tests/fixtures/release_demo`
  - `WEFTEND_ALLOW_SKIP_RELEASE=""` (skip override cleared)
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
- WeftEnd scanner commands in this workflow do not phone home.
- Network activity in this workflow is limited to normal GitHub Actions runner steps (`checkout`, `setup-node`, `npm ci`) unless you add additional networked steps.
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

Future roadmap (not shipped): hosted GitHub integration mode
- Goal:
  - Let operators run WeftEnd on GitHub-hosted runners for repository/release evidence workflows without requiring a local install first.
- Trust boundary (must remain explicit):
  - This is not "trust GitHub instead of WeftEnd."
  - It is "trust a GitHub-hosted execution of WeftEnd under a documented workflow."
- Requirements before marketplace-style packaging:
  - Keep WeftEnd as the engine and use a thin Action wrapper (no duplicate logic).
  - Preserve the same receipt/report schemas and compare semantics as local CLI runs.
  - Tag execution context in a bounded, non-identifying way (for example local vs github_action) without hostnames, usernames, or runner paths.
  - Keep analysis-first defaults (`--withhold-exec`) and no implicit network behavior inside the scanner.
  - Document permissions and artifact retention expectations for the workflow.
  - Treat GitHub-hosted evidence as convenience/pipeline evidence; local WeftEnd remains the independent verification path.
- Optional later additions:
  - Publish a reusable Action with versioned inputs/outputs.
  - Add release-asset compare workflows (previous tag vs current tag).
  - Add Marketplace metadata once the Action interface is stable.
