# docs/PRIVACY_PILLARS.md — WeftEnd Privacy & Secret-Handling Laws (Phase 2→3)

Status: normative. This file defines privacy constraints that must remain true as WeftEnd evolves.

If any other document conflicts with these rules, stop and write a Proposal. Do not “patch around” authority.

---

## 0) Purpose

WeftEnd must make **trust visible** without making **private data visible**.

This document locks the rules for handling:
- passwords
- credit cards / payment data
- auth tokens / session secrets
- personal identifiers (PII)
- private user content (messages, files, photos)
- any secret material (keys, seeds, API tokens)

The core promise:
- **Portal cannot lie about trust.**
- **Portal must never leak secrets.**

---

## 1) Pillars (non-negotiable)

P1 — Secrets never become evidence  
Evidence envelopes, verifier outputs, portal models, and logs must never contain raw secrets.

P2 — Secrets never become “ambient”  
No block may read secrets by default. Secret access is an explicit capability granted only to narrowly defined trusted code.

P3 — One-way visibility  
We reveal *proof* (hashes, reason codes, verifier identities), not content.

P4 — Isolation is the privacy membrane  
If we claim strict privacy, secret-bearing UI and secret-handling code must execute in an isolated realm (trusted zone). Untrusted blocks run elsewhere.

P5 — Egress is choked  
All outbound exfil-capable operations route through a gateway that emits receipts without leaking payload content.

P6 — Fail closed on uncertainty  
If the system cannot prove a secret was protected, it must downgrade trust state and/or deny execution/caps.

---

## 2) Definitions

### 2.1 SensitiveData
Any data that should not appear in:
- portal overlays
- logs/diagnostics
- evidence payloads
- build artifacts
- crash reports

Includes:
- passwords, PINs, 2FA codes
- card numbers, CVV, bank info
- private keys, seeds, recovery phrases
- auth/session tokens, cookies
- user private messages and files (unless explicitly published)
- any “secret derived” value that would enable impersonation (e.g., long-lived refresh tokens)

### 2.2 ProofData (allowed to be visible)
Safe-to-surface data that supports trust without revealing secrets:
- content hashes (of artifacts, not raw user input)
- evidenceId/digest
- reason codes
- verifier id/version
- destination metadata normalized (domain, route class), without payload bytes
- token IDs where tokenization guarantees “no underlying secret” is recoverable from the token (by WeftEnd)

---

## 3) Trust surfaces for privacy (capabilities)

WeftEnd must treat privacy access as capability-gated surfaces. Suggested cap namespaces:

- `ui.secret.read` — reading secret input fields (rare; trusted zone only)
- `ui.secret.emit` — emitting derived non-secret proofs (e.g., token, PAKE transcript)
- `storage.secret.write` — persisting secret material (default deny; ciphertext only)
- `net.secret.send` — sending secrets (default deny; only via gateway, only to allowlisted destinations)
- `clipboard.read` / `clipboard.write` — default deny in strict privacy contexts
- `diag.raw` — default deny; diagnostics must be redacted

Rule:
- Ordinary blocks get **none** of these caps.
- Trusted zone components may get narrowly scoped secret caps.
- Gateways may get `net.*` but must enforce receipts/redaction.

---

## 4) Privacy tiers (execution truth)

WeftEnd must distinguish between “governed” and “ungoverned” environments.

### 4.1 Strict privacy mode (governed)
- Secret UI runs in a **Trusted Zone** (isolated iframe realm or dedicated trusted worker).
- Untrusted blocks run in **Untrusted Zone** (worker isolation recommended).
- Only the Trusted Zone may touch secrets.
- Any attempt by untrusted code to access secrets is denied and logged (redacted).

### 4.2 Compatible mode (partially governed)
- Some browser ambient APIs may be reachable by app code.
- WeftEnd must label exposures explicitly:
  - `UNGOVERNED_UI`
  - `UNGOVERNED_NETWORK`
  - `UNGOVERNED_STORAGE`
- Portal must present this downgrade as a first-class truth.

### 4.3 Legacy mode (observe-only)
- WeftEnd provides minimal observability; no strict secret guarantees.
- Portal must not claim enforcement.

Hard law:
> You may not claim Strict privacy unless execution happens inside the Strict executor boundary.

---

## 5) Trusted Zone pattern (how secrets enter the system safely)

### 5.1 The Trusted Zone contract
Trusted Zone is a minimal component that:
- renders secret inputs
- performs tokenization / secure exchange
- emits only **non-secret results** (tokens, proofs, hashes, or encrypted blobs)

Outputs allowed from Trusted Zone:
- `auth.token` (short-lived) OR `auth.proof` (PAKE / signed assertion)
- `payment.token` (processor token)
- `consent.proof` (user intent evidence)
- `secret.ciphertext` (if persistence is required)

Outputs not allowed:
- raw password, raw card number, CVV, raw messages/files, raw session cookie

### 5.2 Tokenize, don’t handle (mandatory guidance)
For payments, the preferred design is:
- user enters card data into a payment provider’s isolated component
- WeftEnd receives only a token
- WeftEnd never processes or stores card numbers

This is a structural safety win.

---

## 6) Egress gateway (prevent leaks while keeping accountability)

All outbound flows that could carry private data must route through a Transmission Gateway.

### 6.1 Gateway responsibilities
- enforce caps (`net.*`, `net.secret.send`)
- enforce destination allowlists and route classes
- emit **TransmissionReceipt** for every outbound operation
- never log raw payload content in receipts

### 6.2 TransmissionReceipt (safe proof)
Receipts must contain ProofData only:
- `receiptId` (hash)
- `planDigest` (Ariadne string root)
- `callerBlockHash` / `nodeId`
- `capUsed` (e.g., `net.fetch`)
- `dest` (normalized host + path class, not full URL if it may contain secrets)
- `payloadHash` (hash of bytes, not bytes)
- `payloadSchemaHint` (optional, non-sensitive)
- `decision` (allow/deny) + ordered reason codes
- `verifierSet` / trust tier snapshot (optional)

Hard law:
> Receipts must be sufficient to prove what happened, without revealing what was sent.

---

## 7) Redaction law (applies everywhere)

There must exist a single deterministic redaction pipeline used by:
- portal models
- diagnostics
- receipts
- logs
- evidence normalization outputs

### 7.1 Deterministic redaction rules
- redact by key name patterns (`password`, `token`, `secret`, `authorization`, `cookie`, `cvv`, etc.)
- redact by structure (known secret-bearing schemas)
- redact by heuristic fallback if unsure (fail closed)
- preserve hashes and structural metadata where safe

### 7.2 Redaction invariants
- redaction output is canonicalizable and stable-sorted
- reason codes are stable and ordered
- if redaction cannot be confidently applied, system must:
  - deny operation OR
  - downgrade trust and mark `UNVERIFIED_PRIVACY`

---

## 8) “Portal can’t lie” — privacy edition

Portal may show:
- trust tier, caps eligibility, reason codes
- evidence ids and verifier outputs
- hashes of sensitive payloads (not payloads)
- execution mode labels (Strict/Compatible/Legacy)
- “governed vs ungoverned” markers

Portal must never show:
- raw form fields (passwords/cards)
- raw outbound payloads
- storage values that include PII/secrets
- any long-lived auth material

Hard law:
> The portal’s truth is about *permissions and proofs*, never content.

---

## 9) Threat model (what this stops)

This design prevents or reduces:
- silent exfiltration by third-party blocks (no cap / gateway chokepoint)
- portal/log leakage of secrets (redaction law + proof-only rule)
- “helpful debug logging” exposing tokens (deny diag.raw by default)
- supply-chain swaps injecting secret-stealing code into privileged lanes (Strict executor + evidence→caps)
- rollback of compromised-but-signed artifacts if antiRollback is required (policy gate)

---

## 10) Proof obligations (tests that must exist)

At minimum, unit/fixture tests must prove:

T1 — Portal never contains raw secrets  
Given inputs containing secrets, portal model output must contain only redacted/proof data.

T2 — Receipts are proof-only  
TransmissionReceipt must never include payload bytes.

T3 — Strict mode enforcement boundary is real  
Untrusted blocks cannot reach secret input access; attempts yield deterministic denial reason codes.

T4 — Compatible mode honesty  
If an ungoverned path exists, portal must label it deterministically.

T5 — Redaction is deterministic  
Same input produces the same redacted output (canonical JSON), stable reason ordering.

Stop condition:
> If any test reveals raw secrets in portal/log/evidence, treat it as a critical breach and block release.

---

## 11) Operational rule (developer ergonomics)

WeftEnd must not punish normal developers with ceremony.

Therefore:
- default path for apps is “tokenize, don’t handle”
- Strict mode is automatic for third-party blocks/plugins
- Compatible mode exists for migration but is always honestly labeled
- failures must be actionable: “missing consent proof”, “attempted secret egress”, “ungoverned network path”

A secure system that is unusable is a failed system. A usable system that lies is also failed.

This policy keeps both honest.
