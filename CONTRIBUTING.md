# Contributing

Thanks for your interest in WeftEnd. This project is operator-focused and deterministic by design. We keep changes small, reviewable, and aligned with the documented guarantees.

## How to get help
- Use GitHub Issues for bug reports and questions.
- Include the relevant `report_card.txt`, `compare_report.txt` (if applicable), and the one-line operator summary.
- Do not include absolute paths, usernames, or secrets.

## Bug reports
Please include:
- What you expected
- What you observed
- Steps to reproduce
- OS + Node version

## Feature requests
We are cautious about scope creep. If a feature would alter determinism, privacy guarantees, or execution posture, expect extra scrutiny.

## Pull requests
PRs are accepted by prior agreement only. Open an issue first so we can align on scope and approach.

## Development
- `npm run compile --silent`
- `npm test`
- `WEFTEND_RELEASE_DIR=tests\fixtures\release_demo; npm run proofcheck`
- `WEFTEND_RELEASE_DIR=tests\fixtures\release_demo; npm run release-loop`

## Style and safety
- No absolute paths or environment values in receipts or reports.
- No implicit key generation.
- Keep outputs deterministic and bounded.

## Security
See `SECURITY.md` for reporting guidelines.
