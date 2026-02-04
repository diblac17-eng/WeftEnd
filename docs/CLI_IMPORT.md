# docs/CLI_IMPORT.md - WeftEnd CLI Import Contract (v0)

Status: guidance. This document must not conflict with:
- `docs/PROJECT_STATE.md`
- `docs/weblayers-v2-spec.md`
- `docs/INTEGRATION_CONTRACT.md`
- `docs/PRIVACY_PILLARS.md`

If any conflict is found, stop and write a Proposal.

---

## 0) Command

```
npm run weftend -- import <inputPath> <outDir> [--policy safe|trusted-only|trusted-code|dev] [--entry <relativePath>]
```

Notes:
- `inputPath` is a directory or `.zip`.
- Outputs are written under `<outDir>/payload` and `<outDir>/weftend`.
- Order is deterministic (stable-sorted lists, canonical JSON).
- Strict-load demo crypto requires `WEFTEND_ALLOW_DEMO_CRYPTO=1`.

---

## 1) Inputs

Required arguments:
- `inputPath` (folder or `.zip`)
- `outDir`

Optional flags:
- `--policy safe|trusted-only|trusted-code|dev` (default: `safe`)
- `--entry <relativePath>` to choose the strict-load entry file

Rules:
- Paths are normalized to safe, relative, forward-slash paths.
- Encrypted or unsupported zip features are rejected (fail closed).
- Archives exceeding size/entry limits are rejected (fail closed).
- `trusted-code` is an alias for `trusted-only`.

---

## 2) Outputs (proof-only, deterministic)

Written to `<outDir>`:

```
payload/...
weftend/manifest.json
weftend/evidence.json
weftend/import_report.json
```

### manifest.json
Canonical JSON for `ImportManifestV0`:
- `importId` binds `manifestBody` by canonical hash.
- `entries` list stable-sorted by path.
- `requestedCaps`, `riskFlags`, `evidenceDigests` stable-sorted.

### evidence.json
Canonical JSON for `EvidenceBundleV0`:
- `records` stable-sorted by `evidenceId`.
- no raw code or secrets; proof-only payloads.

### import_report.json
Canonical JSON for `ImportReportV0`:
- `verdict` mirrors `policyDecision.verdict`.
- `topReasonCodes` is a stable-sorted summary of the policy decision.
- `missingEvidenceKinds` lists required evidence kinds that were missing (stable-sorted).
- `grantedCaps` and `deniedCaps` reflect the preset gate (proof-only).
- `oneFixPerReason` includes exactly one fix per `topReasonCodes` entry.
- `policyDecision` records the preset gate (verdict + reasonCodes).
- `strictLoad` reflects the strict loader output (verdict + reasonCodes).
- no raw code or secrets; proof-only fields only.

---

## 3) Policy presets

safe (default)
- Forbidden caps (net/fs/process/eval/storage) yield DENY with reason codes.
- No caps are granted.

trusted-only
- Allows net.fetch/storage caps only when required evidence (e.g., `signature.v1`) is present.
- Missing required evidence -> QUARANTINE (policyDecision) with reason codes.
- Any forbidden caps -> DENY.

dev
- More permissive cap grant set for local testing.
- Still deny-by-default at runtime if caps are disabled in v0.

Reason code notes:
- `NET_DISABLED_IN_V0` is used for `net.*` requests in safe policy.
- Other forbidden caps use `CAP_FORBIDDEN:<capId>`.
- `EVIDENCE_MISSING` indicates missing evidence kinds listed in `missingEvidenceKinds`.

---

## 4) Failure codes (stable, fail-closed)

CLI-level errors (exit code 1):
- `USAGE` - invalid arguments
- `INPUT_MISSING` - input path not found
- `INPUT_INVALID` - invalid flags or options
- `IMPORT_UNSUPPORTED` - unsupported file type/zip features
- `IMPORT_PARSE_ERROR` - malformed zip
- `IMPORT_EMPTY` - no files in input
- `DEMO_CRYPTO_FORBIDDEN` - demo crypto disabled without allow flag

Validation errors (exit code 1, printed as `[CODE] message`):
- `FIELD_INVALID`
- `SHAPE_INVALID`
- `ENUM_INVALID`
- `CANONICAL_INVALID`
- `IMPORT_ID_MISMATCH`

---

## 5) Determinism contract

The CLI:
- Uses canonical JSON for digest/signature inputs.
- Stable-sorts all lists that affect hashing.
- Fails closed on missing/unclear inputs.
- Never writes secrets or raw payloads to evidence/report files.
