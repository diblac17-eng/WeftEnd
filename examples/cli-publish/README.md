# CLI Publish Example

This folder contains a `publish.json` that matches the CLI publish contract.

## Use it (demo crypto)

From repo root:

```
npm run compile
$env:WEFTEND_ALLOW_DEMO_CRYPTO = "1"
$env:WEFTEND_SIGNER_KEY_ID = "demo-key"
$env:WEFTEND_SIGNING_KEY = "demo-key"
node dist\src\cli\main.js publish examples\cli-publish out\publish_demo
```

Then point the harness to `out\publish_demo` for release folder checks.
