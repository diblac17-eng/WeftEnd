# tools/windows/shell/weftend_make_shortcut.ps1
# Create a WeftEnd-run shortcut (analysis-first, optional launch).

param(
  [Parameter(Position = 0)]
  [string]$TargetPath,
  [Alias("Target")]
  [string]$TargetCompat,
  [string]$ShortcutPath,
  [switch]$AllowLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-TargetPath {
  param([string]$Value)
  if (-not $Value) { return $null }
  $trimmed = $Value.Trim()
  if ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"') -and $trimmed.Length -ge 2) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }
  if ($trimmed -eq "") { return $null }
  return $trimmed
}

function Resolve-WeftEndIcon {
  param([string]$Root)
  if (-not $Root -or $Root.Trim() -eq "") { return $null }
  $assetsDir = Join-Path $Root "assets"
  if (-not (Test-Path $assetsDir)) { return $null }
  $icoPath = Join-Path $assetsDir "weftend_logo.ico"
  $pngPath = Join-Path $assetsDir "weftend_logo.png"
  $hasPng = Test-Path $pngPath
  if (-not $hasPng -and (Test-Path $icoPath)) { return $icoPath }
  if (-not $hasPng) { return $null }
  if (Test-Path $icoPath) { return $icoPath }
  return $pngPath
}

$normalizedTargetPath = Normalize-TargetPath -Value $TargetPath
if (-not $normalizedTargetPath) {
  $normalizedTargetPath = Normalize-TargetPath -Value $TargetCompat
}
if ($normalizedTargetPath) { $TargetPath = $normalizedTargetPath }

if (-not $TargetPath -or -not (Test-Path -LiteralPath $TargetPath)) {
  Write-Error "TARGET_MISSING"
  exit 40
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runnerPath = Join-Path $scriptDir "weftend_safe_run.ps1"
if (-not (Test-Path -LiteralPath $runnerPath)) {
  Write-Error "RUNNER_MISSING"
  exit 40
}

$repoRoot = $null
try {
  $repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
} catch {
  $repoRoot = $null
}
$weftendIcon = Resolve-WeftEndIcon -Root $repoRoot

if (-not $ShortcutPath -or $ShortcutPath.Trim() -eq "") {
  $desktop = [Environment]::GetFolderPath("Desktop")
  if (-not $desktop -or -not (Test-Path $desktop)) {
    Write-Error "DESKTOP_MISSING"
    exit 40
  }
  $baseName = [System.IO.Path]::GetFileName($TargetPath)
  if (-not $baseName -or $baseName.Trim() -eq "") { $baseName = "WeftEnd Run" }
  $ShortcutPath = Join-Path $desktop ($baseName + " (WeftEnd).lnk")
}

$psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }

$args = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`" -Target `"$TargetPath`""
if ($AllowLaunch.IsPresent) { $args += " -AllowLaunch" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $psExe
$shortcut.Arguments = $args
$shortcut.IconLocation = if ($weftendIcon) { $weftendIcon } else { $psExe }
$shortcut.Save()

if ($AllowLaunch.IsPresent) {
  Write-Output "SHORTCUT_CREATED mode=ALLOW_LAUNCH"
} else {
  Write-Output "SHORTCUT_CREATED mode=ANALYZE_ONLY"
}
exit 0
