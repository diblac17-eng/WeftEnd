# docs/LOCAL_TESTING.md - WeftEnd local harness (PortalModel v0)

Status: guidance only.

This page documents the local demo harness for PortalModel v0.

## Mint Examine v1 (product flow)

Run the examiner on a local artifact:

```bash
npm run weftend -- examine <input> --profile web|mod|generic --out out/exam
```

Outputs:
- `out/exam/weftend_mint_v1.json`
- `out/exam/weftend_mint_v1.txt`

Note: browser builds do not execute. Use `weftend host run` for strict execution on Node.

## Quick start

1) Install dependencies

```bash
npm install
```

2) Run the test suite (includes portal_model + runtime boundary tests)

```bash
npm test
```

3) Start the local harness server

```bash
npm run serve
```

4) Open the harness page

```
http://localhost:5173/test/harness/portal.html
```

Notes:
- The server prints the exact URL on startup.
- If your browser refuses to delete forbidden globals in a Worker, the Strict self-test will show FAIL (that is correct fail-closed behavior).
- The harness uses shared PortalModel builder and runtime stamp observer cores (`src/engine/portal_model_core.ts`, `src/runtime/strict/portal_builder_core.ts`, `src/runtime/kernel/stamp_observer_core.ts`) to keep output deterministic.

## Import Studio v1 (harness-only)

Open the Import Studio page:

```
http://localhost:5173/test/harness/import_studio_v1.html
```

What it does:
- paste or upload HTML, then blockify to preview
- export an ImportSnapshotV0 JSON and reload it locally

Fixtures + determinism:
- fixtures live in `test/harness/fixtures/import_studio_v1`
- same input -> same snapshot digest (golden snapshots are checked in)
- safe preview disables scripts by default; enabling scripts is explicit and unsafe

What it is not:
- it does not publish or grant trust
- it does not mint release artifacts

## Portal viewer (CLI inspect)

The viewer lives at `src/runtime/portal_viewer.html`.

Generate the portal model file and open the viewer:

```bash
npm run weftend -- inspect <releaseDir> --viewer
```

Generate the portal model file without opening a browser:

```bash
npm run weftend -- inspect <releaseDir> --viewer --no-open
```

The command writes `portal_model.json` into the release folder. You can also pass `--portal` to print the JSON to stdout.

## Verify and Recover (Strict, Explicit, Deterministic)

Verify a release folder under strict rules:

```bash
npm run weftend -- verify <releaseDir>
```

- Verifies `release_manifest.json` + `runtime_bundle.json` + evidence bindings (strict rules).
- Outputs a canonical JSON report (stable ordering).
- Exits non-zero if unverified (any strict failure).

Verify strict policy flags:

Default verify treats build attestation as optional:

```bash
npm run weftend -- verify <releaseDir>
```

Require build attestation (opt-in strictness):

```bash
npm run weftend -- verify <releaseDir> --require-build-attestation
```

- Missing/invalid attestation becomes a strict failure (`BUILD_ATTESTATION_MISSING` / related codes).
- Verify report includes the effective policy as `strictPolicy`.

Recover a release folder (dry-run plan):

```bash
npm run weftend -- recover <releaseDir> --cache <dir>
```

Apply recovery (explicit):

```bash
npm run weftend -- recover <releaseDir> --cache <dir> --apply
```

Recovery rules:
- Only restores `runtime_bundle.json` and `evidence.json`.
- Writes `receipts/recovery_receipt_<safePlanDigest>.json`.
- Appends Tartarus with `ARTIFACT_RECOVERED`.
- Never edits `release_manifest.json`.
- After `--apply`, verify is run again and the result is printed.

Cache filename conventions:
- `bundle_<safeDigest>.json` (bundle digest only)
- `evidence_<safeDigest>.json`

No fallback: `release_bundle_<safeReleaseId>.json` is no longer accepted.

Failure note: if the expected bundle digest is unknown, recovery reports `RECOVERY_SOURCE_UNKNOWN`.

Safe digest rules:
- Only `[A-Za-z0-9._-]` are allowed.
- Any other character is replaced with `_`.

Security warning: cache content is untrusted until its digest matches; recovery only restores bytes that satisfy strict verification.

Recovery receipt fields:
- `recovery_receipt_*.json` records observed digests (bundle/evidence) and observed plan/path digests when present.
- Recovery never becomes "clean"; it is provably scarred via `ARTIFACT_RECOVERED`.
