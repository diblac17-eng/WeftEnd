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
  ARCHIVE_FORMAT_MISMATCH
  ARCHIVE_TRUNCATED
  ARCHIVE_UNSUPPORTED_FORMAT
  ARCHIVE_PLUGIN_REQUIRED
  ARCHIVE_PLUGIN_UNAVAILABLE
- Route strictness:
  explicit `--adapter archive` fails closed on invalid `.zip` signature bytes and invalid `.tar` structure/metadata (`ARCHIVE_FORMAT_MISMATCH`) rather than returning partial archive summaries. `.zip` strict mode validates central-directory integrity and rejects partial metadata even when some entries parsed. `.tar` strict mode validates header checksum and octal size fields and rejects partial metadata even when some entries parsed.

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
  explicit `--adapter package` now fails closed when package/container evidence mismatches (for example invalid `.msi` CFB header structure, invalid `.exe` PE header, invalid ZIP-backed package containers, missing package-specific ZIP structure evidence for `.msix/.nupkg/.whl/.jar`, missing required Debian package entries for `.deb`, invalid `.rpm` lead/signature-header evidence, missing `.appimage` ELF/runtime marker evidence, or invalid `.pkg`/`.dmg` header-trailer evidence). Strict mode also rejects partial ZIP/AR metadata even when required package markers are present. `.msix` strict mode requires Appx manifest plus `[Content_Types].xml` OPC structure evidence and a minimum structural file size, `.nupkg` and `.jar` strict mode requires package-specific ZIP structure plus a minimum structural file size, `.whl` strict mode requires `.dist-info` `METADATA`, `WHEEL`, and `RECORD` structure evidence, `.deb` strict mode requires required Debian package entries plus a minimum structural file size, `.exe` strict mode requires valid PE header structure plus a minimum structural file size, `.msi` strict mode requires valid CFB header structure fields plus a minimum structural file size, `.rpm` strict mode requires lead/header markers plus a minimum structural file size, `.appimage` strict mode requires ELF header plus AppImage runtime marker at canonical offset and a minimum structural file size, `.pkg` strict mode requires minimally valid XAR header fields and a minimum structural file size, and `.dmg` strict mode requires `koly` at canonical trailer offset (file-end minus 512) plus a minimum structural file size. Explicit compressed tar package formats (`.tgz/.tar.gz/.txz/.tar.xz`) now require `--enable-plugin tar` and fail closed when unavailable.

3) extension
- Formats: .crx, .vsix, .xpi, unpacked extension folder with manifest.json
- Key reason codes:
  EXTENSION_ADAPTER_V1
  EXTENSION_FORMAT_MISMATCH
  EXTENSION_MANIFEST_MISSING
  EXTENSION_MANIFEST_INVALID
  EXTENSION_EXTERNAL_REF_PRESENT
- Route strictness:
  explicit `--adapter extension` fails closed on invalid or partial package metadata (`EXTENSION_FORMAT_MISMATCH`) and when manifest.json is missing or invalid. Strict extension routing also requires baseline manifest core fields (`manifest_version`, `name`, `version`). `.crx` inputs require a valid CRX header and embedded ZIP payload in explicit route analysis.

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
- Route strictness:
  explicit `--adapter iac` fails closed on non-IaC text/config inputs (`IAC_UNSUPPORTED_FORMAT`) and requires IaC structural signals (generic secret-keyword matches alone do not satisfy strict IaC routing). Explicit `--adapter cicd` fails closed on non-CI/CD inputs (`CICD_UNSUPPORTED_FORMAT`). CI/CD path/filename hints alone do not satisfy strict CI/CD route requirements without CI structure/signals.
- Auto classification:
  adapter `auto` classifies CI/CD when CI structure/action references are present, including pinned-only workflows that do not emit risk-only CI reason codes.

5) document (baseline signal lane)
- Formats: .pdf, .docm, .xlsm, .rtf, .chm
- Key reason codes:
  DOC_ADAPTER_V1
  DOC_FORMAT_MISMATCH
  DOC_ACTIVE_CONTENT_PRESENT
  DOC_EMBEDDED_OBJECT_PRESENT
  DOC_EXTERNAL_LINK_PRESENT
- Route strictness:
  explicit `--adapter document` fails closed on extension/header mismatch (`.pdf/.rtf/.chm`), requires PDF EOF plus object-syntax evidence (`<obj> <gen> obj`), structural marker evidence (`catalog`/`xref`/`trailer`), and `startxref` marker evidence for explicit `.pdf` analysis, requires strict RTF prolog plus baseline control-word and closing-brace evidence for explicit `.rtf` analysis, requires minimum CHM structural header evidence for explicit `.chm` analysis, and fails closed on invalid/missing or partial OOXML ZIP metadata for `.docm/.xlsm` (including missing primary part evidence: `word/document.xml` for `.docm`, `xl/workbook.xml` for `.xlsm`).

6) container (baseline signal lane)
- Formats: OCI layouts, container tarball hints, compose/SBOM hints
- Key reason codes:
  CONTAINER_ADAPTER_V1
  CONTAINER_FORMAT_MISMATCH
  CONTAINER_OCI_LAYOUT
  CONTAINER_LAYOUT_INVALID
  CONTAINER_INDEX_INVALID
  CONTAINER_TARBALL_SCAN
  CONTAINER_SBOM_PRESENT
  CONTAINER_SBOM_INVALID
- Route strictness:
  explicit `--adapter container` fails closed when OCI `oci-layout` metadata is invalid, when OCI `index.json` is invalid, has non-array `manifests`, or has empty manifests, when OCI manifests exist but blob evidence is missing, when OCI manifest digest references are missing, when OCI manifest digest references do not resolve to blob entries, when SBOM-named inputs are invalid JSON or have empty package/component evidence, and when explicit tar/compose inputs do not contain container/compose evidence. Compose strict mode now requires a `services` block with at least one service entry and at least one `image`/`build` hint inside a service block (out-of-service `image` hints do not satisfy strict routing). Explicit tar route accepts Docker-style tar markers (`manifest.json` + `repositories`) or OCI tar markers (`oci-layout` + `index.json` + `blobs/sha256/*`) and fails closed otherwise, including partial tar metadata; Docker tar strict mode additionally requires valid `manifest.json` + `repositories` JSON structure (including at least one repo/tag mapping), and requires all manifest layer/config references to resolve to tar entries.

7) image
- Formats: .iso, .vhd, .vhdx, .vmdk, .qcow2
- Key reason codes:
  IMAGE_ADAPTER_V1
  IMAGE_TABLE_TRUNCATED
  IMAGE_FORMAT_MISMATCH
- Route strictness:
  explicit `--adapter image` fails closed when extension/header evidence does not match, including unsupported `.qcow2` versions, `.qcow2` headers below minimum structural size, `.iso` inputs missing descriptor-set terminator evidence after PVD, `.vhd` footer-only files below minimum structural size, `.vhdx` signature-only files below minimum structural size, `.vmdk` descriptor-only files below minimum structural size, and weak `.vmdk` descriptor-only hints that lack structural evidence.

8) scm (baseline signal lane)
- Formats: local git trees
- Key reason codes:
  SCM_ADAPTER_V1
  SCM_REF_UNRESOLVED
  SCM_TREE_CAPTURED
- Route strictness:
  explicit `--adapter scm` fails closed when commit/ref evidence cannot be resolved and when git/native-ref/status evidence is partial.

9) signature evidence (baseline signal lane)
- Formats: .cer, .crt, .pem, .p7b, .sig
- Key reason codes:
  SIGNATURE_EVIDENCE_V1
  SIGNATURE_FORMAT_MISMATCH
  SIGNER_PRESENT
  CHAIN_PRESENT
  TIMESTAMP_PRESENT
- Route strictness:
  explicit `--adapter signature` fails closed when no recognized certificate/signature envelope or strong ASN.1 signature evidence is present (unknown PEM envelope labels are rejected, malformed DER envelope lengths are rejected, malformed PEM payloads are rejected unless payload decodes to DER-like sequence data, strict envelope evidence must also match extension expectations for `.p7b/.sig`, generic DER fallback is limited to `.cer/.crt`, `.cer/.crt` DER fallback requires X.509 name OID evidence (`2.5.4.*`), tiny generic DER blobs are rejected, and text-only timestamp/chain hints are not treated as strict signature evidence).

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
