# RELEASE_CHECKLIST.md
Release checklist (stability sweep; no new features).

Status
- Legacy checklist snapshot.
- For active release workflow, use `docs/RELEASE_CHECKLIST_ALPHA.md`.

publish -> verify -> strict run -> harness load -> export -> conduit snapshot -> recover (optional)

1) Publish
Command:
weftend publish <inputDir> <outDir>

Expected files:
- runtime_bundle.json
- release_manifest.json
- evidence.json
- release_public_key.json (if signing enabled)

What failure means (examples):
- INPUT_INVALID / FIELD_INVALID: publish.json invalid or disallowed fields
- NODE_ID_INVALID: block id not in canonical grammar
- POLICY_DIGEST_MISMATCH: policy binding mismatch
- PATH_SUMMARY_MISSING / PATH_DIGEST_MISMATCH: path gate missing or tampered

2) Verify
Command:
weftend verify <releaseDir> [--require-build-attestation]

Expected output:
- deterministic JSON report (OK / UNVERIFIED / MAYBE)

What failure means (examples):
- RELEASE_SIGNATURE_BAD: manifest signature invalid
- EVIDENCE_DIGEST_MISMATCH: evidence envelope tampered
- ARTIFACT_DIGEST_MISMATCH: artifact hash mismatch
- BUILD_ATTESTATION_MISSING: required attestation missing (when flag set)
- PATH_DIGEST_MISMATCH: path summary tampered

Known failure example (compromised release):
- Symptom: release_manifest.json or runtime_bundle.json edited after publish.
- Verify result: UNVERIFIED with RELEASE_SIGNATURE_BAD and/or RUNTIME_BUNDLE_INVALID.

3) Strict run
Command:
node examples/hello-mod/run_strict_load.js --scenario=ok

Expected files:
- receipts/pulses.json (bounded ring buffer)

What failure means (examples):
- CAP_NOT_GRANTED / NET_DISABLED_IN_V0: denied capability
- STAMP_MISSING: missing stamp proof
- STRICT_SELFTEST_FAILED: strict boundary not verified

4) Harness load
Open:
test/harness/portal.html

Expected inputs:
- verify_report.json
- portal_model.json (from inspect --viewer)
- telemetry_conduit_snapshot.json (optional)

What failure means (examples):
- VERIFY_REPORT_INVALID: malformed report input
- PORTAL_PROJECTION_TRUNCATED: view truncated (expected if oversized)
- TELEMETRY_K_ANONYMITY_FAIL: k-floor not met

5) Export
Command:
weftend export <releaseDir> --out <path> [--preview|--apply]

Expected file (apply):
- receipt_package.json

What failure means (examples):
- RECEIPT_DIGEST_MISMATCH: bound digest mismatch
- PRIVACY_FIELD_FORBIDDEN: forbidden identifiers or time fields detected
- RECEIPT_OVERSIZE / RECEIPT_UNBOUNDED: boundedness violation

6) Telemetry conduit snapshot
Command:
weftend telemetry-conduit <releaseDir> --out <path> --k 100 [--preview|--apply]

Expected file (apply):
- telemetry_conduit_snapshot.json

What failure means (examples):
- TELEMETRY_K_ANONYMITY_FAIL: k-floor not met, no chunk emitted
- TELEMETRY_BUDGET_EXCEEDED: chunk exceeds byte cap
- TELEMETRY_CONDUIT_INVALID: malformed snapshot (projection-only)

7) Recover (optional)
Command:
weftend recover <releaseDir> --cache <dir> --apply

Expected outputs:
- recovery_receipt_*.json
- tartarus records include ARTIFACT_RECOVERED

What failure means (examples):
- RECOVERY_SOURCE_UNKNOWN: no digest-keyed cache entry
- ARTIFACT_DIGEST_MISMATCH: tamper detected before recovery
- ARTIFACT_RECOVERED: recovery applied (scar is permanent)
