param(
  [string]$PublishDir,
  [string]$ReleaseOutDir = "out\\publish_demo_v2",
  [string]$ExportsOutDir = "out\\exports\\demo_v2",
  [int]$Port = 5173,
  [switch]$NoBrowser,
  [int]$K = 100
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

$releaseOps = Join-Path $root "scripts\\weftend_release_ops.ps1"
$harnessStart = Join-Path $root "scripts\\weftend_harness_start.ps1"
if (-not (Test-Path $releaseOps)) {
  Write-Fail "Missing script: $releaseOps" "Restore scripts\\weftend_release_ops.ps1"
}
if (-not (Test-Path $harnessStart)) {
  Write-Fail "Missing script: $harnessStart" "Restore scripts\\weftend_harness_start.ps1"
}

Write-Section "Release + Export"
$releaseParams = @{
  ReleaseOutDir = $ReleaseOutDir
  ExportsOutDir = $ExportsOutDir
  K = $K
  Apply = $true
}
if ($PublishDir) { $releaseParams.PublishDir = $PublishDir }
& $releaseOps @releaseParams
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Release ops failed." "Run: .\\scripts\\weftend_release_ops.ps1 -Apply"
}

$releaseAbs = Resolve-UnderRoot $root $ReleaseOutDir $true
$exportsAbs = Resolve-UnderRoot $root $ExportsOutDir $true
Write-Ok "Release output: $releaseAbs"
Write-Ok "Exports output: $exportsAbs"

Write-Section "Harness"
$harnessParams = @{
  ReleaseDir = $releaseAbs
  Port = $Port
}
if ($NoBrowser) { $harnessParams.NoBrowser = $true }
& $harnessStart @harnessParams
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Harness start failed." "Run: .\\scripts\\weftend_harness_start.ps1 -ReleaseDir `"$releaseAbs`""
}
