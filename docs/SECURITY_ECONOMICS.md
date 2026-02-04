# WeftEnd Security Economics: Attacks Do Not Pay

WeftEnd does not try to detect every attack. It makes successful compromise
non-compounding and non-stealthy.

## Core Claim: Payoff Collapse

Any adversarial action that bypasses a trust gate necessarily destroys one or more of:
- **Power** (capabilities)
- **Admission** (verification / market acceptance)
- **Stealth** (undetectable persistence)
- **Portability** (reproducible, shareable artifacts)

Result: attacks do not compound value. They either fail closed or leave permanent, portable scars.

## Attacker Goals -> Guaranteed Failure Modes

### Goal: Run untrusted code with real power
- **Defense:** deny-by-default capability kernel; caps require explicit proof and grants.
- **Failure mode:** power remains denied; outcomes are explainable via stable reason codes.
- **Payoff collapse:** no leverage without granted caps.

### Goal: Persist across systems / distribute a compromised release
- **Defense:** strict verification of release manifests, digests, evidence bindings, and path gates.
- **Failure mode:** strict refuses execution or degrades to MAYBE (no power).
- **Payoff collapse:** compromised artifacts do not travel; distribution becomes self-defeating.

### Goal: Tamper artifacts to gain advantage
- **Defense:** canonical hashing + digest binding; tamper triggers deterministic failures.
- **Failure mode:** ARTIFACT_DIGEST_MISMATCH (and related reasons) surfaces; execution fails or loses power.
- **Payoff collapse:** tamper breaks verifiability; you trade change for inadmissible.

### Goal: Forge evidence, stamps, or signatures
- **Defense:** signature verification + envelope binding + fail-closed verifiers.
- **Failure mode:** verification fails deterministically; portal shows proof-only reasons.
- **Payoff collapse:** forgery provides no stable advantage - only a denial.

### Goal: Hide compromise (stealth)
- **Defense:** Tartarus quarantine and receipts/pulses are bounded and proof-only; recovery is explicit.
- **Failure mode:** any recovery emits ARTIFACT_RECOVERED; never clean.
- **Payoff collapse:** stealth is structurally impossible when repair leaves a permanent scar.

### Goal: Smuggle secrets or identifiers into core truth
- **Defense:** privacy guardrails: no stable IDs, no wall-clock time, no untrusted strings in core truth.
- **Failure mode:** fail closed on forbidden fields/values.
- **Payoff collapse:** tracking/PII makes the artifact unusable under strict; smuggling destroys admission.

## Partial Compromise Does Not Compound

WeftEnd is designed so partial compromise does not grant leverage:
- bounded outputs prevent log amplification and smuggling
- deny-by-default caps prevent lateral movement
- strict verification prevents almost-valid artifacts from becoming deployable

## What WeftEnd Guarantees
- **If it runs with power, it was proven.**
- **If it breaks or heals, it is permanently recorded.**
