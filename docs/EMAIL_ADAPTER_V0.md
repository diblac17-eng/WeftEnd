# EMAIL_ADAPTER_V0.md

Email adapter is an input adapter for local `.eml`, `.mbox`, and `.msg` artifacts.

It does not send mail, fetch mail, or execute attachments.

## Commands

```powershell
npm run weftend -- email unpack <input.eml|input.mbox> --out <dir> [--index <n>] [--message-id <id>]
npm run weftend -- email safe-run <input.eml|input.mbox|input.msg|email_export_dir> --out <dir> [--policy <path>] [--index <n>] [--message-id <id>]
```

## Output shape

`email unpack` writes:

- `email_export/adapter_manifest.json`
- `email_export/headers.json`
- `email_export/body.txt`
- `email_export/body.html.txt`
- `email_export/links.txt`
- `email_export/attachments/manifest.json`
- `email_export/attachments/files/*`

Compatibility files are also emitted:
- `email_export/email_headers.txt`
- `email_export/email_body.txt`
- `email_export/email_body.html`

Then `email safe-run` validates normalized markers and runs normal `safe-run` on `email_export/` to produce standard receipts.

## Determinism and safety

- Parsing is bounded and deterministic.
- Attachment files are treated as opaque data.
- HTML is never rendered, scripts are stripped, and links are never fetched.
- `.msg` parsing is best-effort in v0 and marked with `EMAIL_MSG_EXPERIMENTAL_PARSE`.
- No baseline auto-accept.
- No path/env leakage in adapter outputs.
- Native binaries remain analysis-only.
