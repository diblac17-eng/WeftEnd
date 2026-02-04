# Recovery Lane Hardening (WO12)

Scope: strengthen the recovery lane without changing trust semantics.

Goals
- Resist cache poisoning by tightening cache selection and validation.
- Bind recovery receipts to plan and path digests (planDigest <-> recovered artifacts).
- Surface recovery scars clearly in the portal (ARTIFACT_RECOVERED).

Non-goals
- No new execution permissions.
- No silent repair or "clean" state.
- No export or telemetry changes.

Cache poisoning resistance
- Bundle recovery uses only digest-based cache keys:
  - bundle_<expectedDigest>.json
- No releaseId fallback for bundle cache selection.
- Cached bundle must match:
  - manifest planDigest
  - manifest block set
  - manifest pathDigest (when present)
- If bundle digest is unknown, recovery action is unavailable:
  - RECOVERY_SOURCE_UNKNOWN

Receipt binding improvements
- RecoveryPlanActionV0 adds:
  - expectedPlanDigest (runtime_bundle only)
- RecoveryReceiptActionV0 adds:
  - observedDigest
  - observedPlanDigest (runtime_bundle only)
  - observedPathDigest (runtime_bundle only)
- Receipts remain proof-only and bounded.

Portal scar surfacing
- Any ARTIFACT_RECOVERED in Tartarus reasonCodes yields a global warning.
- Warning is stable-sorted with other portal warnings.

Tests (must remain green)
- Cache poisoning:
  - poisoned cached bundle -> RECOVERY_SOURCE_MISMATCH
- Missing bundle digest:
  - planSnapshot absent -> RECOVERY_SOURCE_UNKNOWN
- Receipt binding:
  - recovered runtime_bundle action includes observedPlanDigest and observedPathDigest
- Portal warnings:
  - ARTIFACT_RECOVERED appears in warnings when present in Tartarus
