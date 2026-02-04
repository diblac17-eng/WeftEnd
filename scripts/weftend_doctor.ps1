param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

function Write-Pass($message) {
  Write-Host "PASS: $message" -ForegroundColor Green
}

function Write-Fail($message) {
  Write-Host "FAIL: $message" -ForegroundColor Red
  return $false
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
  return $null
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

$failures = 0

$root = Get-RepoRoot
if (-not $root) {
  Write-Host "FAIL: Repo root not found (package.json missing)." -ForegroundColor Red
  exit 1
}
Write-Pass "Repo root: $root"

try { $nodeVersion = (& node -v).Trim() } catch { $nodeVersion = $null }
if (-not $nodeVersion) {
  Write-Host "FAIL: Node.js not found (need 20.x)." -ForegroundColor Red
  Write-Host "Install Node 20.x from https://nodejs.org/ (LTS) and re-run." -ForegroundColor Yellow
  exit 1
} else {
  $clean = $nodeVersion.Trim()
  if ($clean.StartsWith("v")) { $clean = $clean.Substring(1) }
  $majorText = $clean.Split(".")[0]
  $major = 0
  if ([int]::TryParse($majorText, [ref]$major)) {
    if ($major -eq 20) { Write-Pass "Node version $nodeVersion" }
    else {
      Write-Host "FAIL: Node version $nodeVersion (need 20.x)." -ForegroundColor Red
      Write-Host "Install Node 20.x from https://nodejs.org/ (LTS) and re-run." -ForegroundColor Yellow
      exit 1
    }
  } else {
    Write-Host "FAIL: Node version unreadable (got $nodeVersion)." -ForegroundColor Red
    Write-Host "Install Node 20.x from https://nodejs.org/ (LTS) and re-run." -ForegroundColor Yellow
    exit 1
  }
}

try { $npmVersion = & npm -v } catch { $npmVersion = $null }
if (-not $npmVersion) {
  $failures++
  Write-Fail "npm not found (install Node.js)."
} else {
  Write-Pass "npm version $npmVersion"
}

$requiredDirs = @("scripts", "docs", "examples")
foreach ($dir in $requiredDirs) {
  $path = Join-Path $root $dir
  if (Test-Path $path) { Write-Pass "$dir/ present" }
  else { $failures++; Write-Fail "$dir/ missing" }
}

$optionalDirs = @("tests")
foreach ($dir in $optionalDirs) {
  $path = Join-Path $root $dir
  if (Test-Path $path) { Write-Pass "$dir/ present" }
  else { Write-Host "WARN: $dir/ missing (optional for release package)" -ForegroundColor Yellow }
}

$requiredFiles = @(
  "package.json",
  "scripts\\weftend_release_ops.ps1",
  "scripts\\weftend_harness_start.ps1",
  "scripts\\weftend_demo_day.ps1"
)
foreach ($file in $requiredFiles) {
  $path = Join-Path $root $file
  if (Test-Path $path) { Write-Pass "$file present" }
  else { $failures++; Write-Fail "$file missing" }
}

$listener = Get-ListeningProcess $Port
if ($listener) {
  $failures++
  Write-Fail "Port $Port in use by $($listener.Name) (PID $($listener.Pid))."
} else {
  Write-Pass "Port $Port available"
}

if ($failures -gt 0) {
  Write-Host "Doctor result: FAIL ($failures issue(s))" -ForegroundColor Red
  exit 1
}

Write-Host "Doctor result: PASS" -ForegroundColor Green
exit 0
