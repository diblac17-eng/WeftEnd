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

## Hosted integration note (future)

- A GitHub-hosted integration mode is allowed as a wrapper around the WeftEnd CLI/engine.
- Hosted mode must preserve WeftEnd receipts and semantics exactly; it must not replace them with platform-specific verdict logic.
- Hosted evidence is convenience/pipeline evidence, not a substitute for independent local verification.
- Hosted wrappers must remain explicit about trust surface (runner environment, workflow permissions, artifact retention).
