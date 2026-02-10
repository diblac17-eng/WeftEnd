# EMAIL_ADAPTER_V0.md

Email adapter is an input adapter for local `.eml` / `.mbox` artifacts.

It does not send mail, fetch mail, or execute attachments.

## Commands

```powershell
npm run weftend -- email unpack <input.eml|input.mbox> --out <dir> [--index <n>] [--message-id <id>]
npm run weftend -- email safe-run <input.eml|input.mbox> --out <dir> [--policy <path>] [--index <n>] [--message-id <id>]
```

## Output shape

`email unpack` writes:

- `email_export/email_headers.txt`
- `email_export/email_body.txt`
- `email_export/email_body.html`
- `email_export/links.txt`
- `email_export/attachments/manifest.json`
- `email_export/attachments/files/*`

Then `email safe-run` runs normal `safe-run` on `email_export/` and produces standard receipts.

## Determinism and safety

- Parsing is bounded and deterministic.
- Attachment files are treated as opaque data.
- No baseline auto-accept.
- No path/env leakage in adapter outputs.
- Native binaries remain analysis-only.

