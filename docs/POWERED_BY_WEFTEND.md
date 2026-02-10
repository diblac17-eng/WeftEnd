# POWERED_BY_WEFTEND.md

This contract defines what downstream tools may and may not do when they integrate with WeftEnd outputs.

## Allowed

- Read WeftEnd receipts.
- Compare WeftEnd receipts.
- Visualize WeftEnd receipts.
- Attach receipts to tickets or audit records.

## Not allowed

- Alter WeftEnd receipts and present them as original.
- Claim WeftEnd verdicts as your own product verdicts.
- Add hidden metadata to WeftEnd receipts.

## Reliability boundaries

- You can rely on deterministic digests, bounded arrays, and stable reason codes.
- You cannot rely on host identity, usernames, absolute paths, or telemetry fields.

## Positioning

WeftEnd is a deterministic evidence and change-control engine.
Integrations can add workflow value, but they must not change core trust semantics.

