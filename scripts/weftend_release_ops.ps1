param(
  [string]$PublishDir,
  [string]$ReleaseOutDir = "out\\publish_demo_v2",
  [switch]$Apply,
  [int]$K = 100,
  [string]$ExportsOutDir = "out\\exports\\demo_v2"
)

$ErrorActionPreference = "Stop"

function Write-Section($title) {
  Write-Host ""
  Write-Host "== $title ==" -ForegroundColor Cyan
}

function Write-Ok($message) {
  Write-Host "OK: $message" -ForegroundColor Green
}

function Write-Warn($message) {
  Write-Host "WARN: $message" -ForegroundColor Yellow
}

function Write-Fail($message, $next = $null) {
  Write-Host "FAIL: $message" -ForegroundColor Red
  if ($next) {
    Write-Host "Next: $next" -ForegroundColor Yellow
  }
  exit 1
}

function Get-RepoRoot {
  $start = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $current = $start
  while ($true) {
    $pkg = Join-Path $current "package.json"
    if (Test-Path $pkg) { return $current }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current -or [string]::IsNullOrWhiteSpace($parent)) { break }
    $current = $parent
  }
  Write-Fail "Could not locate repo root (package.json)." "Run this from inside the repo."
}

function Resolve-UnderRoot($root, $path, $mustExist = $true) {
  $combined = if ([System.IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $root $path }
  $resolved = [System.IO.Path]::GetFullPath($combined)
  if (-not ($resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase))) {
    Write-Fail "Path must live under repo root: $resolved" "Choose a path under $root\\out"
  }
  if ($mustExist -and -not (Test-Path $resolved)) {
    Write-Fail "Path not found: $resolved" "Create it or choose a path under $root"
  }
  return $resolved
}

Write-Section "Repo Root"
$root = Get-RepoRoot
Set-Location $root
Write-Ok "Repo root: $root"

Write-Section "Tooling"
try { $nodeVersion = & node -v } catch { Write-Fail "Node.js not found." "Install Node.js from https://nodejs.org/" }
if ($LASTEXITCODE -ne 0) { Write-Fail "Node.js not available." "Install Node.js from https://nodejs.org/" }
try { $npmVersion = & npm -v } catch { Write-Fail "npm not found." "Install Node.js (includes npm) from https://nodejs.org/" }
if ($LASTEXITCODE -ne 0) { Write-Fail "npm not available." "Install Node.js (includes npm) from https://nodejs.org/" }
Write-Ok "node $nodeVersion / npm $npmVersion"

Write-Section "Compile"
$distPath = Join-Path $root "dist"
$srcPath = Join-Path $root "src"
if ((Test-Path $distPath) -and (-not (Test-Path $srcPath))) {
  Write-Warn "src/ missing; using existing dist/ without recompiling."
} else {
  & npm run compile
  if ($LASTEXITCODE -ne 0) { Write-Fail "Compile failed." "Run: npm run compile" }
  Write-Ok "Compile complete"
}

Write-Section "Publish Input"
if (-not $PublishDir) {
  $candidates = Get-ChildItem -Path $root -Recurse -File -Filter "publish.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\\\node_modules\\\\" -and $_.FullName -notmatch "\\\\dist\\\\" -and $_.FullName -notmatch "\\\\out\\\\" } |
    Sort-Object FullName
  if (-not $candidates -or $candidates.Count -eq 0) {
    Write-Fail "No publish.json found under repo." "Create a publish.json or pass -PublishDir <dir>"
  }
  $preferred = $candidates | Where-Object { $_.FullName -match "(?i)publish_demo|demo" } | Select-Object -First 1
  if (-not $preferred) { $preferred = $candidates | Select-Object -First 1 }
  $PublishDir = Split-Path -Parent $preferred.FullName
}

$publishAbs = Resolve-UnderRoot $root $PublishDir $true

$publishJson = Join-Path $publishAbs "publish.json"
if (-not (Test-Path $publishJson)) {
  Write-Fail "publish.json not found at $publishJson" "Pass -PublishDir <dir> that contains publish.json"
}
Write-Ok "publish.json: $publishJson"

Write-Section "Publish"
$signerKeyId = $env:WEFTEND_SIGNER_KEY_ID
$signingKey = $env:WEFTEND_SIGNING_KEY
if ([string]::IsNullOrWhiteSpace($signerKeyId) -or [string]::IsNullOrWhiteSpace($signingKey)) {
  if (-not $env:WEFTEND_DEMO_CRYPTO_OK) {
    $answer = Read-Host "No signing key set. Use demo crypto for this publish? (Y/N)"
    if ($answer -match "^[Yy]") {
      $env:WEFTEND_DEMO_CRYPTO_OK = "1"
      $env:WEFTEND_SIGNER_KEY_ID = "demo-key"
      $env:WEFTEND_SIGNING_KEY = "demo-key"
      Write-Warn "Using demo crypto (dev-only). Set real keys for production."
    } else {
      Write-Fail "Signing keys are missing." "Set WEFTEND_SIGNER_KEY_ID and WEFTEND_SIGNING_KEY, or re-run and choose demo crypto."
    }
  }
}
$relAbs = Resolve-UnderRoot $root $ReleaseOutDir $false
if (Test-Path $relAbs) {
  Remove-Item -Recurse -Force $relAbs
}
New-Item -ItemType Directory -Path $relAbs | Out-Null

& node dist\src\cli\main.js publish $publishAbs $relAbs
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Publish failed." "Check publish.json or set demo crypto: `$env:WEFTEND_DEMO_CRYPTO_OK='1'"
}

$manifestPath = Join-Path $relAbs "release_manifest.json"
$bundlePath = Join-Path $relAbs "runtime_bundle.json"
$evidencePath = Join-Path $relAbs "evidence.json"
if (-not (Test-Path $manifestPath)) { Write-Fail "Missing release_manifest.json in $relAbs" "Re-run publish." }
if (-not (Test-Path $bundlePath)) { Write-Fail "Missing runtime_bundle.json in $relAbs" "Re-run publish." }
if (-not (Test-Path $evidencePath)) { Write-Fail "Missing evidence.json in $relAbs" "Re-run publish." }
Write-Ok "Release folder ready: $relAbs"

Write-Section "Path Digest"
$pathDigest = & node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const d=m && m.manifestBody && m.manifestBody.pathDigest; if(!d){process.exit(2);} console.log(d);" $manifestPath
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($pathDigest)) {
  Write-Fail "manifestBody.pathDigest missing in release_manifest.json" "Re-run publish with current CLI."
}
Write-Ok "pathDigest: $pathDigest"

Write-Section "Verify Report"
$verifyPath = Join-Path $relAbs "verify_report.json"
& node dist\src\cli\main.js verify $relAbs | Out-File $verifyPath -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Write-Warn "verify returned non-zero (UNVERIFIED). report still written."
}
if (-not (Test-Path $verifyPath)) {
  Write-Fail "verify_report.json not created." "Run: node dist\\src\\cli\\main.js verify $relAbs > `"$verifyPath`""
}
Write-Ok "verify_report.json: $verifyPath"

Write-Section "Export (Preview)"
& node dist\src\cli\main.js export $relAbs --out $ExportsOutDir --preview
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Export preview failed." "Run: node dist\\src\\cli\\main.js export $relAbs --out $ExportsOutDir --preview"
}
Write-Ok "Export preview OK"

if ($Apply) {
  Write-Section "Export (Apply)"
  & node dist\src\cli\main.js export $relAbs --out $ExportsOutDir --apply
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Export apply failed." "Run: node dist\\src\\cli\\main.js export $relAbs --out $ExportsOutDir --apply"
  }
  $receiptPath = Join-Path (Resolve-UnderRoot $root $ExportsOutDir $false) "receipt_package.json"
  if (-not (Test-Path $receiptPath)) {
    Write-Fail "receipt_package.json not found." "Check $ExportsOutDir and re-run export --apply."
  }
  Write-Ok "receipt_package.json: $receiptPath"
} else {
  Write-Warn "Apply not requested. Use -Apply to write receipt_package.json."
}

Write-Section "Telemetry (Preview)"
$pulsesPath = Join-Path $relAbs "receipts\\pulses.json"
if (-not (Test-Path $pulsesPath)) {
  Write-Fail "pulses.json missing at $pulsesPath" "Run: node examples\\hello-mod\\run_strict_load.js --scenario=ok"
}

$oldErr = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$teleOut = (& node dist\src\cli\main.js telemetry $relAbs --out $ExportsOutDir --k $K --preview 2>&1 | Out-String)
$teleExit = $LASTEXITCODE
$ErrorActionPreference = $oldErr
if ($teleExit -ne 0) {
  if ($teleOut -match "TELEMETRY_K_FLOOR_NOT_MET") {
    Write-Ok "Telemetry preview: expected not enough samples (k-floor not met)."
    exit 0
  }
  Write-Fail "Telemetry preview failed." "Run: node dist\\src\\cli\\main.js telemetry $relAbs --out $ExportsOutDir --k $K --preview"
}
Write-Ok "Telemetry preview OK"

if ($Apply) {
  Write-Section "Telemetry (Apply)"
  & node dist\src\cli\main.js telemetry $relAbs --out $ExportsOutDir --k $K --apply
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Telemetry apply failed." "Run: node dist\\src\\cli\\main.js telemetry $relAbs --out $ExportsOutDir --k $K --apply"
  }
  $telemetryPath = Join-Path (Resolve-UnderRoot $root $ExportsOutDir $false) "telemetry_aggregate.json"
  if (-not (Test-Path $telemetryPath)) {
    Write-Fail "telemetry_aggregate.json not found." "Check $ExportsOutDir and re-run telemetry --apply."
  }
  Write-Ok "telemetry_aggregate.json: $telemetryPath"
} else {
  Write-Warn "Apply not requested. Use -Apply to write telemetry_aggregate.json."
}

