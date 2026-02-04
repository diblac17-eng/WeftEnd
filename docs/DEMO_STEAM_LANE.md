# DEMO_STEAM_LANE.md - Workshop Lane Golden Path (v0)

This demo shows the difference between a metadata pointer and a verified install.

## Commands

1) From repo root:
`npm test`

2) Start the harness:
`npm run serve`

3) Open:
`http://localhost:5173/test/harness/portal.html`

4) In the harness:
- Click **Simulate Workshop Browse** -> expect `POINTER_PRESENT`
- Click **Simulate Install + Verify** -> expect `ACCEPT` with no misleading "verified" on browse

Optional CLI demo (after compile):
`npm run compile --silent`
`node scripts/steam_demo.js`
This prints BROWSE, VERIFY, and STRICT LOAD results.

## What to observe

- Browse step never claims VERIFIED; it only reports pointer presence.
- Install step recomputes digests and returns ACCEPT/REJECT with reason codes.
- Tamper scenarios in the harness still show `artifact.mismatch` and `ARTIFACT_RECOVERED`.
