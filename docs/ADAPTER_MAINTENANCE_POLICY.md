WeftEnd Adapter Maintenance Policy

Purpose
- Temporarily disable adapter lanes that are out of maintenance scope while preserving fail-closed behavior.

How policy is resolved
1) Explicit runtime options (internal call surface).
2) `WEFTEND_ADAPTER_DISABLE` environment variable.
3) `WEFTEND_ADAPTER_DISABLE_FILE` JSON file path.
4) Default file path if present: `policies/adapter_maintenance.json`.

Policy JSON shape
```json
{
  "schema": "weftend.adapterMaintenance/0",
  "disabledAdapters": ["archive", "container"]
}
```

Supported adapter names
- `archive`
- `package`
- `extension`
- `iac`
- `cicd`
- `document`
- `container`
- `image`
- `scm`
- `signature`

Special tokens
- `all` or `*`: disable all adapters.
- `none`: no-op token.

Fail-closed behavior
- Disabled lanes: `ADAPTER_TEMPORARILY_UNAVAILABLE` + `ADAPTER_DISABLED_BY_POLICY`.
- Unknown tokens: `ADAPTER_POLICY_INVALID`.
- Invalid/unreadable policy file: `ADAPTER_POLICY_INVALID` plus file-specific reason code.
- Fail-closed adapter-policy outcomes still write deterministic safe-run evidence artifacts.
- Policy applies to adapter lanes used by `safe-run` and `container scan` (`container` lane).

Doctor command
- JSON: `npm run weftend -- adapter doctor`
- Text: `npm run weftend -- adapter doctor --text`
- Strict gate (exit 40 on invalid policy/unknown tokens/unresolved missing plugins): `npm run weftend -- adapter doctor --strict`
  - JSON output includes `strict.status` (`PASS`|`FAIL`) and `strict.reasonCodes`.
- Write current effective policy to file: `npm run weftend -- adapter doctor --write-policy policies/adapter_maintenance.json`
- Write policy and include adapters with missing plugins: `npm run weftend -- adapter doctor --write-policy policies/adapter_maintenance.json --include-missing-plugins`
- `--include-missing-plugins` is only valid with `--write-policy`.
