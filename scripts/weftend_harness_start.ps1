param(
  [string]$ReleaseDir,
  [int]$Port = 5173,
  [switch]$NoBrowser,
  [switch]$Block
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

function Resolve-UnderRoot($root, $path) {
  if ([System.IO.Path]::IsPathRooted($path)) {
    return (Resolve-Path -Path $path).Path
  }
  return (Resolve-Path -Path (Join-Path $root $path)).Path
}

function Get-ListeningProcess($port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
  } catch {
    return $null
  }
  if (-not $conn) { return $null }
  $proc = $null
  try { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction Stop } catch {}
  return [pscustomobject]@{
    Pid = $conn.OwningProcess
    Name = if ($proc) { $proc.ProcessName } else { "unknown" }
  }
}

function Test-PortFree($port) {
  $ports = @(
    @{ Addr = [System.Net.IPAddress]::Any; Family = [System.Net.Sockets.AddressFamily]::InterNetwork },
    @{ Addr = [System.Net.IPAddress]::IPv6Any; Family = [System.Net.Sockets.AddressFamily]::InterNetworkV6 }
  )
  foreach ($p in $ports) {
    try {
      $sock = New-Object System.Net.Sockets.Socket($p.Family, [System.Net.Sockets.SocketType]::Stream, [System.Net.Sockets.ProtocolType]::Tcp)
      $sock.ExclusiveAddressUse = $true
      $sock.Bind((New-Object System.Net.IPEndPoint($p.Addr, $port)))
      $sock.Close()
    } catch {
      return $false
    }
  }
  return $true
}

function Find-FreePort($startPort, $maxTries = 20) {
  for ($offset = 0; $offset -lt $maxTries; $offset++) {
    $candidate = $startPort + $offset
    if (Test-PortFree $candidate) {
      return $candidate
    }
  }
  return $null
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

Write-Section "Release Folder"
$selectedReleaseDir = $null
if ($ReleaseDir) {
  $selectedReleaseDir = $ReleaseDir
} elseif ($env:WEFTEND_RELEASE_DIR) {
  $selectedReleaseDir = $env:WEFTEND_RELEASE_DIR
} else {
  $fallback = Join-Path $root "tests\fixtures\release_demo"
  if ((Test-Path (Join-Path $fallback "runtime_bundle.json")) -and (Test-Path (Join-Path $fallback "release_manifest.json"))) {
    $selectedReleaseDir = $fallback
  }
}

if (-not $selectedReleaseDir) {
  Write-Fail "No release folder found." "Run: .\\scripts\\weftend_release_ops.ps1 -Apply"
}

try {
  $releaseAbs = Resolve-UnderRoot $root $selectedReleaseDir
} catch {
  Write-Fail "Release folder not found: $selectedReleaseDir" "Run: .\\scripts\\weftend_release_ops.ps1 -Apply"
}

if (-not (Test-Path (Join-Path $releaseAbs "runtime_bundle.json"))) {
  Write-Fail "Missing runtime_bundle.json in $releaseAbs" "Run: .\\scripts\\weftend_release_ops.ps1 -Apply"
}
if (-not (Test-Path (Join-Path $releaseAbs "release_manifest.json"))) {
  Write-Fail "Missing release_manifest.json in $releaseAbs" "Run: .\\scripts\\weftend_release_ops.ps1 -Apply"
}
if (-not (Test-Path (Join-Path $releaseAbs "evidence.json"))) {
  Write-Warn "evidence.json missing in $releaseAbs (non-fatal)."
}

$env:WEFTEND_RELEASE_DIR = $releaseAbs
Write-Ok "Using release folder: $releaseAbs"

Write-Section "Port"
$portToUse = Find-FreePort $Port
if (-not $portToUse) {
  Write-Fail "No free port available starting at $Port." "Stop the existing process or choose a different -Port"
}
if ($portToUse -ne $Port) {
  Write-Warn "Port $Port is in use. Using $portToUse instead."
} else {
  Write-Ok "Using port $portToUse"
}

$env:PORT = $portToUse

Write-Section "Harness"
$encodedDir = [System.Uri]::EscapeDataString($releaseAbs)
$portalPath = if (Test-Path (Join-Path $root "portal.html")) {
  "/portal.html"
} elseif (Test-Path (Join-Path $root "test\\harness\\portal.html")) {
  "/test/harness/portal.html"
} elseif (Test-Path (Join-Path $root "harness\\portal.html")) {
  "/harness/portal.html"
} else {
  "/portal.html"
}
$portalUrl = "http://localhost:$portToUse${portalPath}?dir=$encodedDir"
$secretZoneUrl = "http://localhost:$portToUse/src/runtime/secretzone/secret_zone.html"
Write-Host "Portal: $portalUrl" -ForegroundColor Green
Write-Host "Secret Zone: $secretZoneUrl" -ForegroundColor Green

if (-not $NoBrowser) {
  try { Start-Process $portalUrl | Out-Null } catch { Write-Warn "Could not open browser automatically." }
}

Write-Host "Starting harness server (Ctrl+C to stop)..." -ForegroundColor Cyan
$servePath = Join-Path $root "test\\harness\\serve.js"
if (-not (Test-Path $servePath)) {
  $servePath = Join-Path $root "harness\\serve.js"
}
if (-not (Test-Path $servePath)) {
  $servePath = Join-Path $root "serve.js"
}
if (-not (Test-Path $servePath)) {
  Write-Fail "Harness server script missing." "Expected test\\harness\\serve.js or harness\\serve.js"
}
if ($Block) {
  & node $servePath
  if ($LASTEXITCODE -ne 0) { Write-Fail "Harness server exited with error." "Re-run: node `"$servePath`"" }
} else {
  $proc = Start-Process -FilePath "node" -ArgumentList "`"$servePath`"" -WorkingDirectory $root -PassThru -NoNewWindow
  if (-not $proc) { Write-Fail "Failed to start harness server." "Run: node `"$servePath`"" }
  Write-Ok "Harness started (PID $($proc.Id)). Use -Block to run in this window."
}
