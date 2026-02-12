# docs/CLI_PUBLISH.md - WeftEnd CLI Publish Contract (v0)

Status: guidance. This document must not conflict with:
- `docs/PROJECT_STATE.md`
- `docs/weblayers-v2-spec.md`
- `docs/INTEGRATION_CONTRACT.md`
- `docs/LAWS_KEYS_AND_SECRETS.md`

If any conflict is found, stop and write a Proposal.

---

## 0) Command

```
npm run weftend -- publish <inputDir> <outDir> [--path-digest <digest>]
```

Notes:
- The CLI reads `publish.json` from `<inputDir>`.
- The CLI writes outputs to `<outDir>`.
- Order is deterministic (stable-sorted lists, canonical JSON).
- `--path-digest` overrides `publish.json` and must match if both are set.

---

## 1) Input file: publish.json (shape contract)

Required fields:
- `html` (string, non-empty)
- `pageId` (string, non-empty)
- `policy` (object; TrustPolicy shape)
- `policyDigest` (string, non-empty)
- `compiler`:
  - `compilerId` (string, non-empty)
  - `compilerVersion` (string, non-empty)
  - `builtAt` (string, non-empty)

Optional fields:
- `title` (string)
- `partTitle` (string)
- `evidenceJournalHead` (string, non-empty)
- `tartarusJournalHead` (string, non-empty)
- `pathDigest` (string, non-empty; optional in v0)
- `buildInfo`:
  - `toolId` (string, non-empty)
  - `toolVer` (string, non-empty)
- `packages` (BlockPackage[]; optional)
- `artifacts` (Record<string, ArtifactRef>; optional)

Rules:
- Unknown fields are rejected (fail closed).
- `blocks` are stable-sorted and de-duplicated before signing.
- `policyDigest` must match the bundle policy id (derived from the TrustPolicy used to build the bundle).
- Optional fields are included only when present (no implicit nulls).
- If `--path-digest` is provided, it must match `publish.json` when present.

Example:
```json
{
  "html": "<main><section id=\"hero\"></section></main>",
  "pageId": "page:/home",
  "policy": { "id": "policy-1", "rules": [{ "id": "r1", "match": {}, "action": "trust" }], "grantRules": [] },
  "policyDigest": "fnv1a32:def67890",
  "compiler": { "compilerId": "weftend", "compilerVersion": "0.1.0", "builtAt": "2025-01-01T00:00:00.000Z" },
  "pathDigest": "fnv1a32:deadbeef",
  "buildInfo": { "toolId": "weftend", "toolVer": "0.1.0" }
}
```
Sample file:
`examples/cli-publish/publish.json`

---

## 2) Env vars (required, no defaults)

Required:
- `WEFTEND_SIGNER_KEY_ID` (string, non-empty)
- `WEFTEND_SIGNING_KEY` (string, non-empty)
- If `WEFTEND_SIGNING_KEY` is a PEM private key (Ed25519 or P-256), CLI uses real crypto.
- If `WEFTEND_SIGNING_KEY` is not PEM, demo signing requires `WEFTEND_DEMO_CRYPTO_OK=1`.

Rules:
- Keys must never be committed to the repo (see `docs/LAWS_KEYS_AND_SECRETS.md`).
- If either is missing, the CLI exits nonzero and prints a stable error code.

---

## 3) Outputs (proof-only, deterministic)

Written to `<outDir>`:
1) `runtime_bundle.json`
   - Canonical JSON of `RuntimeBundle`
   - Produced via A* anchors (import -> blockify -> trust+plan -> bundle)
2) `release_manifest.json`
   - Canonical JSON of `ReleaseManifestV0`
   - Includes:
     - `releaseId` (digest of canonical manifestBody)
     - `manifestBody` (planDigest, policyDigest, blocks, optional heads/pathDigest/buildInfo)
     - `signatures` (sigKind, keyId, sigB64)

3) `release_public_key.json`
   - Canonical JSON:
     - `keyId`
     - `publicKey`

4) `evidence.json` (when build attestation is minted)
   - Canonical JSON of `EvidenceBundleV0`
   - Digest must match `manifestBody.evidenceJournalHead`

Notes:
- `planDigest` and `blocks` are derived from the anchor-built bundle.
- No secrets are written to disk.
- Output ordering is deterministic.
- `publicKey` is a PEM string for real crypto or a demo-derived key for demo mode.

---

## 4) Failure codes (stable, fail-closed)

CLI-level errors (exit code 1):
- `USAGE` - invalid arguments
- `INPUT_MISSING` - `publish.json` not found
- `INPUT_INVALID` - schema violations or disallowed fields
- `SIGNING_KEY_MISSING` - missing env vars
- `DEMO_CRYPTO_FORBIDDEN` - demo crypto disabled without allow flag

Minting/validation errors (exit code 1, printed as `[CODE] message`):
- `SIGNER_UNAVAILABLE`
- `SIGNATURE_INVALID`
- `CANONICAL_INVALID`
- `FIELD_INVALID`
- `SHAPE_INVALID`
- `ENUM_INVALID`
- `POLICY_DIGEST_MISMATCH`
- `RELEASE_ID_MISMATCH`

All failures are deterministic, with stable reason codes and no secret output.

---

## 5) Determinism contract

The CLI:
- Uses canonical JSON for digest/signature inputs.
- Stable-sorts all lists that affect hashing/signing.
- Fails closed on missing/unclear inputs.

This ensures identical inputs produce identical release artifacts.

