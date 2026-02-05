# docs/REDTEAM_V0.md - WeftEnd Red Team v0

Threat list (A-F)
- A) Stamp forgery/substitution
- B) Policy/verifier tampering
- C) Downgrade deception (Strict truth)
- D) Boundary spoofing + replay
- E) Evidence swapping + portal truth
- F) Secret smuggling + leak-by-telemetry

How to run
- npm test

What each file proves
- src/runtime/redteam/stamp_forgery.test.ts
  - Missing/forged/substituted stamps are denied with stable reasons.
- src/runtime/redteam/policy_tamper.test.ts
  - planDigest changes with policy changes; runtime rejects planDigest mismatch; verifier id/version is recorded.
- src/runtime/redteam/downgrade_truth.test.ts
  - Strict self-test failure is visible; portal labels downgrade.
- src/runtime/redteam/boundary_spoof_replay.test.ts
  - Nonce/caller mismatch and replay are denied deterministically.
- src/engine/redteam/evidence_swap.test.ts
  - planDigest commits to evidence digests; evidence swap is covered by digest binding in this pack.
- src/core/redteam/secret_smuggling_and_leak.test.ts
  - SecretBox mutations are rejected; portal/telemetry do not leak secrets.

Scope statement
- WeftEnd relies on platform isolation; it does not claim to block Spectre/timing side channels.
- This pack proves boundary bindings, determinism, and fail-closed behavior with proof-only outputs.
