# Changelog

This repository uses immutable releases. Published release assets and their release notes are not edited after publication.
Any correction, hardening pass, or follow-up change is recorded in a newer changelog entry.

## [Unreleased]

### Safe-run evidence corridor
- `safe-run` now verifies expected receipt artifacts for presence and digest consistency before completion.
- `safe-run` now flags unmanaged pre-existing output files anywhere under out-root as deterministic orphan-evidence warnings.
- Analysis is not blocked by these checks; warning codes are recorded in `operator_receipt.json` (`SAFE_RUN_EVIDENCE_*`).
- Added explicit smoke-test coverage for root-level stale output detection under the same non-blocking warning model.
- `operator_receipt.json` now carries additive digest links for `weftend/README.txt` and run sub-receipts (`analysis/*`, `host/*`) for stronger evidence-chain traceability.
- `container scan` now also preserves deterministic evidence artifacts on fail-closed preconditions (`safe_run_receipt.json` and `operator_receipt.json` are written before exit 40).

### Adapter maintenance controls
- Added `weftend adapter doctor` for deterministic adapter readiness/maintenance reporting.
- Added `weftend adapter doctor --text` for a human-readable maintenance report with deterministic local actions.
- Added fail-closed adapter maintenance policy gate using `WEFTEND_ADAPTER_DISABLE=<adapter[,adapter...]>`.
- Added optional file policy source `WEFTEND_ADAPTER_DISABLE_FILE=<path-to-json>` for release/operator maintenance profiles.
- Disabled adapter lanes now fail closed with `ADAPTER_TEMPORARILY_UNAVAILABLE` + `ADAPTER_DISABLED_BY_POLICY`.
- Invalid maintenance policy tokens now fail closed with `ADAPTER_POLICY_INVALID`.
- `safe-run` now preserves deterministic evidence artifacts (`safe_run_receipt.json`, `operator_receipt.json`, analysis receipts) even when adapter maintenance policy fails closed.

### Adapter strict-route hardening
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
