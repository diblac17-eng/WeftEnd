# GIT_POSTING_ETIQUETTE
Status: normative.

Purpose
- Keep commits and release-facing text professional, clear, and operator-credible.
- Avoid odd LLM-style posting patterns that reduce trust.

Rules
1. Use direct technical language; no AI self-reference.
2. No apology/meta filler in commit/release text.
3. No hype or marketing superlatives in technical release notes.
4. Keep release text structured:
   - Highlights
   - Validation
5. Avoid mojibake/encoding artifacts in published docs.
6. Avoid emojis in release and operator-facing technical docs.

Commit style
1. Imperative subject line.
2. Subject should describe real change, not vague wording.
3. Include verification evidence in the development log (via `verify:360` outputs).

Gate enforcement
- `npm run verify:360` runs etiquette checks on:
  - `README.md`
  - `docs/RELEASE_ANNOUNCEMENT.txt`
  - `docs/RELEASE_NOTES.txt`
- Fails with `VERIFY360_GIT_ETIQUETTE_FAILED` if violations are detected.

