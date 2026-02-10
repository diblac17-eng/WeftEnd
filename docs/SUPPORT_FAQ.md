# SUPPORT_FAQ

Q: Why does everything say WITHHELD?
A: WITHHELD is expected for native binaries and analysis-only runs. It means "analyzed, not executed."

Q: How do I know it is doing what it claims?
A: Re-run the same input and compare receipts. Deterministic outputs are the proof.

Q: What does CHANGED mean?
A: The artifact digest differs from baseline. Use `compare_report.txt` to see what changed.

Q: What does BLOCKED mean?
A: Baseline is frozen. Review change and accept/reject baseline.

Q: Why no "safe/unsafe" verdict?
A: WeftEnd is evidence, not judgment. It records facts and change, without claiming intent.

Q: Does WeftEnd assume liability for my decisions?
A: No. WeftEnd provides deterministic evidence outputs. Operators and organizations remain responsible for decisions and actions.

Q: Can WeftEnd run executables?
A: Not by default. Native binaries are analysis-only.

Q: Does "no HTML" mean WeftEnd failed?
A: No. For non-web artifacts, the report card shows `webLane=NOT_APPLICABLE`. Intake evidence is still produced.

Q: What does `delta=` mean in the report card?
A: On CHANGED runs, `delta=` summarizes numeric movement vs baseline (files, bytes, refs, domains, scripts).

Q: Where are the receipts?
A: In the library run folder for that target. The report card shows the run ID.
