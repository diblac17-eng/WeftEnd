# Truth Model v0 vs v1 (WeftEnd)

This page explains exactly what WeftEnd can prove **today (v0)** and what is **future (v1)**.
It is intentionally short and operator‑focused.

## v0 (Public Alpha) — Proven Today

**WeftEnd v0 provides deterministic, privacy‑clean evidence about what an artifact is and what changed.**

What v0 proves:
- **Deterministic intake:** same artifact ⇒ same receipts (bounded, canonical, privacy‑clean).
- **Baseline comparison:** SAME / CHANGED / BLOCKED is computed deterministically.
- **No native execution:** native binaries are always WITHHELD (analysis‑only).
- **Operator‑visible receipts:** report card + receipts + compare reports are reproducible.
- **Evidence is portable:** outputs are safe to attach to tickets without leaking host details.

What v0 does **not** prove:
- That an artifact was published or signed by a vendor.
- That an update is “safe” or “clean.”
- That the artifact will behave safely at runtime.

If you need those, see v1.

## v1 (Planned) — Publisher Snapshots + External Truth

**WeftEnd v1 adds publisher snapshots to prove vendor intent.**

Publisher snapshots (future):
- A publisher can generate a snapshot (digest + evidence binding).
- Operators can verify a download against the publisher’s snapshot.
- This adds an external truth anchor beyond local inspection.

What v1 adds (conceptual):
- **Publisher‑signed snapshots** for vendor drops / mod updates.
- **External truth binding** (download matches what the publisher shipped).

## Why this matters

v0 answers: **“What is this artifact, and what changed?”**  
v1 answers: **“Is this what the publisher intended?”**

Both are important. v0 is already useful and complete for operators. v1 is additive.
