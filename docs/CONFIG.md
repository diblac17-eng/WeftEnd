# CONFIG.md

Optional `.weftend/config.json` (per repo).

Purpose: bounded defaults for auto-scan and gate mode. Unknown keys are rejected.

Example:

```json
{
  "autoScan": {
    "enabled": true,
    "debounceMs": 750,
    "pollIntervalMs": 2000
  },
  "gateMode": {
    "hostRun": "off"
  }
}
```

Rules:
- Unknown keys -> CONFIG_INVALID.
- debounceMs bounds: 100-10000.
- pollIntervalMs bounds: 250-30000.
- No paths or environment values in config.
