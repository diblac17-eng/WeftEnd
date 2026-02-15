WeftEnd Adapter Plugin Policy (v1)

Policy intent
- Preserve deterministic trust semantics while allowing optional local tooling for specific formats.

Hard rules
1) No auto-install
- WeftEnd never installs plugins automatically.
- Operators install tools separately.

2) Explicit enable only
- Plugin paths activate only with explicit `--enable-plugin <name>`.
- Plugin names are recorded in adapter metadata and reason codes.

3) Local-only behavior
- Plugin commands must run locally and read-only for the target artifact.
- No registry pull/authentication/network side effects are allowed in adapter flows.

4) Fail-closed preconditions
- If a plugin-required format is selected and plugin is not enabled, run fails with explicit code.
- If plugin is enabled but unavailable, run fails with explicit code.

5) No silent downgrade
- Missing plugin support never silently claims full analysis coverage.
- Partial coverage is marked with explicit deterministic reason codes.

6) Deterministic outputs
- Plugin-derived outputs are normalized and stable-sorted before receipts are written.
- Outputs remain bounded and privacy-clean.

Current plugin names
- tar: compressed tar listings (.tar.gz/.tgz/.tar.bz2)
- 7z: .7z listings

Operator examples
- npm run weftend -- safe-run <input> --out <dir> --adapter archive --enable-plugin tar
- npm run weftend -- safe-run <input> --out <dir> --adapter archive --enable-plugin 7z

Notes
- Plugin use is optional.
- WeftEnd core analysis remains functional without plugins for built-in formats.
