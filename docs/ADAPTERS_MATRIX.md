WeftEnd Adapter Matrix (v1)

Purpose
- Define artifact adapter coverage for deterministic, analysis-only intake.
- Clarify built-in versus optional plugin paths.
- Keep operator expectations explicit: no implicit execution, no implicit network.

Legend
- Built-in: works without external tools.
- Plugin: optional local tool path; must be explicitly enabled.
- Mode: emitted in safe_run_receipt.adapter.mode.

Adapter classes

1) archive
- Formats: .zip, .tar (built-in), .tar.gz/.tgz/.tar.bz2/.tar.xz/.txz (tar plugin), .7z (7z plugin)
- Key reason codes:
  ARCHIVE_ADAPTER_V1
  ARCHIVE_TRUNCATED
  ARCHIVE_UNSUPPORTED_FORMAT
  ARCHIVE_PLUGIN_REQUIRED
  ARCHIVE_PLUGIN_UNAVAILABLE

2) package
- Formats: .msi, .msix, .exe, .nupkg, .whl, .jar, .tar.gz/.tgz/.tar.xz/.txz, .deb, .rpm, .appimage, .pkg, .dmg
- Key reason codes:
  PACKAGE_ADAPTER_V1
  PACKAGE_METADATA_PARTIAL
  PACKAGE_FORMAT_MISMATCH
  PACKAGE_PLUGIN_REQUIRED
  PACKAGE_PLUGIN_UNAVAILABLE
  PACKAGE_SIGNING_INFO_UNAVAILABLE
  EXECUTION_WITHHELD_INSTALLER
- Route strictness:
  explicit `--adapter package` now fails closed when package/container evidence mismatches (for example invalid `.msi` CFB header, invalid `.exe` PE header, invalid ZIP-backed package containers such as `.msix/.nupkg/.whl/.jar`, invalid `.deb`/`.rpm` container/header evidence, or invalid `.appimage`/`.pkg`/`.dmg` header-trailer evidence). Explicit compressed tar package formats (`.tgz/.tar.gz/.txz/.tar.xz`) now require `--enable-plugin tar` and fail closed when unavailable.

3) extension
- Formats: .crx, .vsix, .xpi, unpacked extension folder with manifest.json
- Key reason codes:
  EXTENSION_ADAPTER_V1
  EXTENSION_MANIFEST_MISSING
  EXTENSION_MANIFEST_INVALID
  EXTENSION_EXTERNAL_REF_PRESENT
- Route strictness:
  explicit `--adapter extension` fails closed when manifest.json is missing or invalid.

4) iac / cicd (baseline signal lane)
- Formats: Terraform, YAML/JSON config, workflow/pipeline definitions
- Key reason codes:
  IAC_ADAPTER_V1
  CICD_ADAPTER_V1
  IAC_PRIVILEGED_PATTERN
  IAC_SECRET_REFERENCE_PATTERN
  IAC_REMOTE_MODULE_REFERENCE
  CICD_UNPINNED_ACTION
  CICD_SECRET_CONTEXT_USAGE
  CICD_EXTERNAL_RUNNER_REF

5) document (baseline signal lane)
- Formats: .pdf, .docm, .xlsm, .rtf, .chm
- Key reason codes:
  DOC_ADAPTER_V1
  DOC_FORMAT_MISMATCH
  DOC_ACTIVE_CONTENT_PRESENT
  DOC_EMBEDDED_OBJECT_PRESENT
  DOC_EXTERNAL_LINK_PRESENT
- Route strictness:
  explicit `--adapter document` fails closed on extension/header mismatch (`.pdf/.rtf/.chm`) and on invalid container parsing for `.docm/.xlsm`.

6) container (baseline signal lane)
- Formats: OCI layouts, container tarball hints, compose/SBOM hints
- Key reason codes:
  CONTAINER_ADAPTER_V1
  CONTAINER_OCI_LAYOUT
  CONTAINER_LAYOUT_INVALID
  CONTAINER_INDEX_INVALID
  CONTAINER_TARBALL_SCAN
  CONTAINER_SBOM_PRESENT
  CONTAINER_SBOM_INVALID
- Route strictness:
  explicit `--adapter container` fails closed when OCI `oci-layout` metadata or `index.json` is invalid, or when SBOM-named inputs are invalid JSON.

7) image
- Formats: .iso, .vhd, .vhdx, .vmdk, .qcow2
- Key reason codes:
  IMAGE_ADAPTER_V1
  IMAGE_TABLE_TRUNCATED
  IMAGE_FORMAT_MISMATCH
- Route strictness:
  explicit `--adapter image` fails closed when extension/header evidence does not match.

8) scm (baseline signal lane)
- Formats: local git trees
- Key reason codes:
  SCM_ADAPTER_V1
  SCM_REF_UNRESOLVED
  SCM_TREE_CAPTURED

9) signature evidence (baseline signal lane)
- Formats: .cer, .crt, .pem, .p7b, .sig
- Key reason codes:
  SIGNATURE_EVIDENCE_V1
  SIGNATURE_FORMAT_MISMATCH
  SIGNER_PRESENT
  CHAIN_PRESENT
  TIMESTAMP_PRESENT
- Route strictness:
  explicit `--adapter signature` fails closed when no certificate/signature envelope or ASN.1 signature evidence is present.

Operator output artifacts
- analysis/adapter_summary_v0.json
- analysis/adapter_findings_v0.json
- safe_run_receipt.json (optional adapter block)
- contentSummary.adapterSignals (optional)

CLI examples
- npm run weftend -- adapter list
- npm run weftend -- safe-run <input> --out <dir> --adapter auto
- npm run weftend -- safe-run <input> --out <dir> --adapter archive
- npm run weftend -- safe-run <input> --out <dir> --adapter archive --enable-plugin tar
