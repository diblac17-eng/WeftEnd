# Hello Mod (example bundle)

This example shows a minimal block with safe compute and a denied net call.

## Files

- `block.js` - the block entry (`exports.main`)
- `publish.json` - inputs for manifest minting
- `run_strict_load.js` - runs strict loader on this block (Node)

## Run strict load (Node)

1) From repo root:
`npm run compile --silent`

2) Run:
`node examples/hello-mod/run_strict_load.js --scenario=ok`

Expected: `verdict` is `DENY` (no caps granted), with reason codes including `CAP_NOT_GRANTED` and `NET_DISABLED_IN_V0`.

## Tamper scenarios

- `node examples/hello-mod/run_strict_load.js --scenario=tamper_no_recovery`
- `node examples/hello-mod/run_strict_load.js --scenario=tamper_recovered`

## Publish manifest (optional)

This example's `publish.json` is not CLI-compatible. For CLI publish, use:
`examples/cli-publish/publish.json`.
