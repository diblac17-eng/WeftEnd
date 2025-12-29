# WeftEnd — Keys & Secrets Law File (Repo Hygiene + Trust Integrity)

Status: normative. If any other doc/tooling contradicts this file, stop and write a Proposal.

---

## 0) Purpose

WeftEnd can be open-source and still be secure only if:
- artifacts, evidence, and policies are public and reproducible
- **private material never enters the repo or build artifacts**
- enforcement is fail-closed and auditable

This file defines what is forbidden to commit, what is allowed, and how secrets are handled across dev → publish → runtime.

---

## 1) Definitions (do not blur these)

**Secret**
Any datum that grants authority by possession (bearer tokens, private keys, passwords, session cookies, refresh tokens).

**Private Key**
Any signing or decryption key material, including seeds/mnemonics, PEM/DER, keystores, hardware exports, or raw scalars.

**Trust Evidence**
A record (envelope) that may be public, may include proofs, and must be bindable by digest.
Evidence must never contain private keys or bearer tokens.

**Keyroom**
A local-only storage boundary that holds secrets. It is not part of the repo. It is replaceable per machine.

---

## 2) Pillars

P-Key-1 — No private material in Git  
If it can sign, decrypt, impersonate, deploy, or grant access: it never goes into version control.

P-Key-2 — Public verification, private signing  
Public keys, key IDs, and verification logic may be public. Signing material stays local.

P-Key-3 — No secret in artifacts  
Build outputs, manifests, evidence payloads, and portal models must never embed private material.

P-Key-4 — Fail-closed on missing secrets  
If a command requires a secret and it is missing, it must stop with explicit reason codes.

P-Key-5 — Deterministic trust logic cannot depend on secrets  
Core/engine logic must be pure and deterministic; it may request verification via ports, but must not read secrets directly.

---

## 3) Absolute prohibitions (never commit)

### 3.1 Root authority secrets
- root/private signing keys for publisher/org/device
- seed phrases / mnemonics / master secrets
- emergency-disable or rotation private material

### 3.2 Credentials and tokens
- GitHub tokens, PATs, OAuth refresh tokens
- cloud credentials (AWS/GCP/Azure), service-account JSON, kubeconfigs with creds
- database URLs containing passwords
- API keys and bearer tokens

### 3.3 Encryption keys
- store encryption keys, unwrap keys, KMS plaintext keys
- any persistent symmetric key material used to protect artifacts or caches

### 3.4 “Anything that would let someone be you”
If theft enables:
- producing valid-looking signatures/evidence
- approving/deploying/publishing
- accessing private services
then it is forbidden.

---

## 4) Allowed to commit (explicitly)

- public keys, key fingerprints, key IDs
- verifier code and reason codes
- policies describing evidence⇒caps
- evidence envelopes and proofs **only if they contain no secrets**
- `.env.example` / `secrets.example.json` with empty placeholders
- test-only dummy keys that cannot be confused with real keys, clearly labeled:
  - `TEST_ONLY_DO_NOT_USE_IN_PROD`

---

## 5) Storage law (where secrets live)

L-KeyStore-1 — Single local boundary  
All secrets live under ONE local path, gitignored:
- `keyroom/` (recommended)
-or
- `secrets/`
-or
- OS keychain / hardware key

L-KeyStore-2 — No duplication  
A secret must not be copied into:
- docs
- fixtures
- sample configs with “real-ish” values
- screenshots
- logs

L-KeyStore-3 — Explicit loading  
All code that needs secrets loads from:
- environment variables, or
- an ignored local file, or
- OS keychain / hardware-backed store

Never “fall back” to a committed default.

---

## 6) Evidence payload law (trust grammar compatible)

L-Ev-1 — Evidence is public by default  
Evidence envelopes can be published, cached, and logged.

L-Ev-2 — Evidence must be non-authorizing  
Evidence must never contain:
- private keys
- bearer tokens
- passwords
- secrets that enable signing/decrypting

L-Ev-3 — Evidence must be bindable  
Every evidence record must have an evidenceId/digest so no portal can swap proofs invisibly.

---

## 7) Git ignore baseline (normative)

At minimum, the repo must ignore patterns like:

- `.env`
- `.env.*` (except `.env.example`)
- `keyroom/**`
- `secrets/**`
- `**/*.pem`
- `**/*.key`
- `**/*.p12`
- `**/*.pfx`
- `**/*.jks`
- `**/*service-account*.json`
- `**/*credentials*.json`
- `**/*token*`
- `**/*secret*`  (use cautiously; don’t hide legitimate source)

If any secret file is intentionally committed, it must be a Proposal-level decision.

---

## 8) Enforcement law (how we prevent accidents)

L-Enforce-1 — Pre-commit/CI gate (recommended, fail-closed)
- Block commits that contain patterns resembling:
  - PEM headers (`BEGIN PRIVATE KEY`)
  - long high-entropy tokens
  - known provider key formats
- If detected: fail the commit/build with explicit “SECRET_DETECTED” output.

L-Enforce-2 — Logging discipline
- never print env vars
- never dump config objects that may contain secrets
- redact known fields: `token`, `secret`, `password`, `privateKey`, `mnemonic`

---

## 9) Operational checklist (human)

Before pushing any branch:
- confirm `keyroom/` exists and is ignored
- confirm `.env` is ignored
- run a repo search for:
  - `PRIVATE KEY`
  - `mnemonic`
  - `token=`
  - `Authorization: Bearer`
- confirm any “example” config has empty values

---

## 10) Stop conditions

Stop and write a Proposal if:
- a feature requires committing a secret “temporarily”
- a test requires real keys to pass
- a doc suggests storing private keys inside evidence payloads
- runtime behavior depends on committed credentials

WeftEnd’s trust story dies the moment private material enters Git.
