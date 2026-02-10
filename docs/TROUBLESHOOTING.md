# TROUBLESHOOTING.md

Operator troubleshooting (common outcomes). This is not an exhaustive reason-code registry.

## A) What success looks like

Safe-Run (analysis)
- report_card.txt exists and opens.
- safe_run_receipt.json + operator_receipt.json exist.
- WITHHELD is expected for native binaries.

Compare
- compare_receipt.json + compare_report.txt exist.
- Verdict is SAME or CHANGED.

Library
- `weftend library` opens the root.
- Report card shows SAME/CHANGED vs baseline.

## B) Common abnormal outcomes

WITHHELD (expected for native binaries and email artifacts)
- This means: analyzed, not executed.

NO_ENTRY_FOUND / EXECUTION_NOT_REQUESTED
- The artifact has no runnable entry; analysis-only result.

BLOCKED vs DENY
- BLOCKED: baseline view is frozen until operator accepts or rejects.
- DENY: policy/trust gate explicitly refused the run.

webLane=NOT_APPLICABLE
- This is normal for non-web artifacts; it does not mean scan failure.

delta=... on CHANGED
- This line is a numeric summary of what moved vs baseline (files/bytes/refs/domains/scripts).

## C) Common codes and what to do (examples)

- EXECUTION_WITHHELD_UNSUPPORTED_ARTIFACT
  - Expected for native binaries and shortcuts only.

- ANALYSIS_ONLY_UNKNOWN_ARTIFACT
  - Directory/file was analyzed, but no execution lane applies to this artifact kind.

- ANALYSIS_ONLY_NO_EXECUTION_LANE
  - Artifact is valid for intake evidence, but execution is intentionally not attempted.

- ARTIFACT_SHORTCUT_UNSUPPORTED
  - Shortcut (.lnk) is treated as data, not resolved or executed.

- SAFE_RUN_ENTRY_MISSING
  - No entrypoint found. Use compare or inspect file kinds.

- SAFE_RUN_NO_ENTRYPOINT_FOUND
  - No runnable entrypoint was detected for this artifact.

- SAFE_RUN_EXECUTION_NOT_REQUESTED
  - Analysis-only run; execution was not requested.

- ADAPTER_NORMALIZATION_INVALID
  - Adapter output is missing required deterministic normalization markers.

- INTAKE_NOT_APPROVED
  - Policy decision rejected the artifact.

- ZIP_EOCD_MISSING
  - ZIP appears corrupt or truncated (End Of Central Directory missing).

- MINT_INVALID
  - Mint validation failed; check inputs for truncation or invalid paths.

- SAFE_RUN_RECEIPT_INVALID
  - Receipt failed validation; report the error and attach receipts.

- WEFTEND_NO_RECEIPT
  - Wrapper did not find receipts; check out root / registry / shell doctor.

- OPEN_EXTERNAL_FAILED
  - OS open failed; use the Start Menu "WeftEnd Library" shortcut.

- SCAN_TRIGGERED
  - Auto-scan (watch) fired; receipts still require operator review.

- GATE_MODE_DENIED
  - Gate mode blocked execution until baseline is accepted.

- GATE_MODE_CHANGED_BLOCKED
  - Gate mode blocked execution because current digest differs from baseline.

- HOST_STARTUP_UNVERIFIED
  - Host failed self-verification; resolve before executing.

- HOST_INPUT_OVERSIZE
  - Input exceeded hard bounds; reduce input size.

- DISCLOSURE_REQUIRED
  - Policy requires disclosure but it could not be produced.

## D) Quick fixes

- If WITHHELD: expected for native binaries; use compare for changes.
- If WEFTEND_NO_RECEIPT: run shell doctor; verify OutRoot + RepoRoot.
- If OPEN_EXTERNAL_FAILED: open the Start Menu "WeftEnd Library" shortcut.
- If ZIP_EOCD_MISSING: re-download or re-create the zip.
- If HOST_STARTUP_UNVERIFIED: do not execute; verify host status first.
