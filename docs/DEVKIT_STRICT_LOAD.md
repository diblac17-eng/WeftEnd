# DEVKIT_STRICT_LOAD.md - DevKit Strict Load Contract (v0)

Status: normative. This file defines the public DevKit strict load surface and prevents bypass drift.
Authority: docs/PROGRAM_FLOW.md, docs/INTEGRATION_CONTRACT.md, docs/weblayers-v2-spec.md.
If conflict, stop and write a Proposal.

---

## 0) Scope

The DevKit must use the strict loader path as the single truth engine.
The only supported entry point is:

`devkitLoadStrict` in `src/devkit/strict_loader.ts`.

No other DevKit execution or loader API is allowed.

---

## 1) Input contract (DevkitStrictLoadInput v0)

Required:
- `workerScript: string` (path to strict sandbox worker script)
- `planDigest: string`
- `policyDigest: string`
- `callerBlockHash: string`
- `sourceText: string`
- `entryExportName: string`
- `expectedSourceDigest: string`
- `artifactStore: ArtifactStoreV0`

Optional:
- `grantedCaps?: string[]` (stable-sorted unique)
- `releaseManifest?: ReleaseManifestV0`
- `releaseKeyAllowlist?: Record<string, string>`
- `cryptoPort?: CryptoPort`

Notes:
- All inputs are proof-only. No secrets are allowed.
- The loader must verify artifact digest before any sandbox execution.
- Fail closed on any missing or invalid input.

---

## 2) Output contract (DevkitStrictLoadResult v0)

Return object (proof-only):
- `verdict: "ALLOW" | "DENY" | "QUARANTINE"`
- `executionOk: boolean`
- `reasonCodes: string[]` (stable-sorted unique)
- `planDigest: string`
- `policyDigest: string`
- `evidenceDigests: string[]`
- `expectedArtifactDigest: string | null`
- `observedArtifactDigest: string | null`
- `releaseId?: string`
- `releaseStatus?: "OK" | "UNVERIFIED"`
- `releaseReasonCodes?: string[]`
- `rollback?: { recovered: boolean; recoveredDigest: string; reasonCodes: string[] }`
- `tartarusSummary: { total: number; info: number; warn: number; deny: number; quarantine: number; kinds: Record<string, number> }`
- `tartarusLatest: TartarusRecordV0 | null`

Rules:
- The UI must render this object as-is.
- The UI must not compute its own "verified" or "strict" state.

---

## 3) Failure codes (stable list)

The loader and strict runtime may emit these (non-exhaustive, stable):
- `STRICT_LOADER_UNAVAILABLE`
- `ARTIFACT_DIGEST_MISMATCH`
- `ARTIFACT_RECOVERED`
- `ARTIFACT_MISSING`
- `CAP_NOT_GRANTED`
- `NET_DISABLED_IN_V0`
- `RELEASE_MANIFEST_MISSING`
- `RELEASE_MANIFEST_INVALID`
- `RELEASE_SIGNATURE_BAD`
- `RELEASE_PLANDIGEST_MISMATCH`
- `RELEASE_BLOCKSET_MISMATCH`
- `STAMP_MISSING`
- `STAMP_INVALID`
- `STAMP_SIG_INVALID`
- `TIER_VIOLATION`
- `REPLAY_DETECTED`
- `STRICT_COMPARTMENT_UNAVAILABLE`
- `SANDBOX_EVAL_ERROR`
- `SANDBOX_ENTRY_MISSING`
- `SANDBOX_EXECUTION_ERROR`

Reason codes must remain stable and deterministically ordered.

---

## 4) No bypass rule

Any legacy or non-strict loader path is forbidden.
If a non-strict path is discovered, it must be removed or hard-denied.

---

## 5) Scenario runner (Node)

Use the Hello Mod runner to show strict decisions:

- `node examples/hello-mod/run_strict_load.js --scenario=ok`
- `node examples/hello-mod/run_strict_load.js --scenario=tamper_no_recovery`
- `node examples/hello-mod/run_strict_load.js --scenario=tamper_recovered`
