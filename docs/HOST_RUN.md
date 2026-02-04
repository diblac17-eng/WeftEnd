# Host Run (Node-only) — v0

Host run is the Node-only verifier + executor for strict releases. It always verifies first and never runs without a successful verify gate.

Host startup status
Host writes a startup status receipt before any command runs. Location: `<outDir>/weftend/host/host_status_000001.json` (outDir is the command `--out` root). If `verifyResult` is `UNVERIFIED`, the host refuses `run` and `install/update`. Receipts without `schemaVersion` were produced by an older WeftEnd and should not be used to assert current invariants. You may delete old `host_status_*.json` receipts; they are not part of the trust chain unless explicitly made so later. If `--out` is not provided, the host writes startup and run receipts under `WEFTEND_HOST_OUT_ROOT`. If neither is set, the command fails closed. The receipt records `outRootSource` (`ARG_OUT` or `ENV_OUT_ROOT`).

Operator hygiene note
Before a release-loop intended as a publishable receipt of health, run `git status --porcelain`. If the output is non-empty, you are not looking at a clean working tree; treat the run as a local experiment, not a publishable receipt.

What it is
- Deterministic host runner for strict bundles.
- Deny-by-default caps (no network by default).
- Receipts are always written, even on DENY/SKIP.

What it is not
- It is not a browser executor.
- It is not a “skip verify” backdoor.
- It does not grant real caps by default.

Command
```
npm run weftend -- host run <releaseDir> --out <outDir> [--entry <block>]
```

Notes
- `<releaseDir>` must contain `release_manifest.json`, `runtime_bundle.json`, and (when required) `evidence.json`.
- `--entry` selects a block id from the release manifest; default is the first block.
- Receipts are written to `<outDir>/host_run_receipt.json`.

Receipt highlights (HostRunReceiptV0)
- `version: "host_run_receipt_v0"`
- `releaseDirDigest`: stable digest derived from releaseId + artifact digests (no local paths).
- `releaseStatus` + `releaseReasonCodes`: release manifest verification status.
- `verify`: overall verify verdict + reasons (including artifact binding checks).
- `execute`: attempted/result/reasons (SKIP when entry unsupported or compartment unavailable).
- `caps`: requested/granted/denied caps (sorted).

Design intent
Host run proves strict execution can happen on Node without ambient authority. It is a verifier+executor with no authority by default.
