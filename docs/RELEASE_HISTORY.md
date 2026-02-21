# RELEASE_HISTORY
Status: normative.

Purpose
- Keep immutable release history in a single stable document.
- Record what changed between published releases without editing old release artifacts.

Rules
1. Do not rewrite published release entries.
2. Add a new entry for each newly published release.
3. Keep entry text concise and technical:
   - release id/tag
   - date
   - scope summary
   - validation commands/status
   - immutable artifact set notes
4. Keep implementation detail in `CHANGELOG.md`; keep publish summary in this file.

Current working entry (next publish)
- Release id/tag: pending
- Date: pending
- Scope:
  - deterministic adapter and shell hardening
  - verify:360 strict-gate contract tightening
  - report-card evidence/contract hardening
  - Windows wrapper/host path resolution hardening
- Validation baseline:
  - `npm run compile --silent`
  - `npm test`
  - `npm run verify:360:release:managed`
- Immutable artifact sidecars expected:
  - `RELEASE_NOTES.txt`
  - `RELEASE_ANNOUNCEMENT.txt`
  - `RELEASE_CHECKLIST_ALPHA.md`
  - `RELEASE_HISTORY.md`
  - `CHANGELOG.md`

Published releases
- Add entries here after each publish.
