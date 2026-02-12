# tools/windows/shell/weftend_make_shortcut.ps1
# Create a WeftEnd-run shortcut (analysis-first, optional launch).

param(
  [Parameter(Position = 0)]
  [string]$TargetPath,
  [Alias("Target")]
  [string]$TargetCompat,
  [string]$ShortcutPath,
  [switch]$AllowLaunch,
  [switch]$LaunchpadMode,
  [switch]$ResolveShortcut,
  [switch]$UseTargetIcon,
  [switch]$OpenLibrary
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

function Get-RepoRoot {
  $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
  $current = Split-Path -Parent $scriptPath
  while ($true) {
    if (Test-Path (Join-Path $current "package.json")) { return $current }
    $parent = Split-Path -Parent $current
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
  return $null
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
  $regen = $false
  if (-not (Test-Path $icoPath)) { $regen = $true }
  elseif ((Get-Item $icoPath).Length -lt 1024) { $regen = $true }
  if ($regen) {
    $iconScript = Join-Path $Root "tools\windows\gen_icon.ps1"
    if (Test-Path $iconScript) {
      try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $iconScript -PngPath $pngPath -OutIco $icoPath | Out-Null
      } catch {
        # fall back to PNG
      }
    }
  }
  if (Test-Path $icoPath) { return $icoPath }
  return $pngPath
}

function Normalize-ShortcutIconLocation {
  param([string]$IconLocation)
  if (-not $IconLocation) { return $null }
  $raw = $IconLocation.Trim()
  if (-not $raw) { return $null }
  $pathPart = $raw
  if ($raw -match "^(.*),-?[0-9]+$") {
    $pathPart = $matches[1]
  }
  $pathPart = $pathPart.Trim()
  if ($pathPart.StartsWith('"') -and $pathPart.EndsWith('"') -and $pathPart.Length -ge 2) {
    $pathPart = $pathPart.Substring(1, $pathPart.Length - 2)
  }
  $pathPart = [Environment]::ExpandEnvironmentVariables($pathPart)
  if (-not $pathPart -or -not (Test-Path -LiteralPath $pathPart)) { return $null }
  return $raw
}

$effectiveTarget = $null
$shortcutIcon = $null
$resolvedLaunchArgs = $null

$normalizedTargetPath = Normalize-TargetPath -Value $TargetPath
if (-not $normalizedTargetPath) {
  $normalizedTargetPath = Normalize-TargetPath -Value $TargetCompat
}
if ($normalizedTargetPath) { $TargetPath = $normalizedTargetPath }

if (-not $TargetPath -or -not (Test-Path -LiteralPath $TargetPath)) {
  Write-Error "TARGET_MISSING"
  exit 40
}

$isShortcut = $false
if ($TargetPath) {
  $ext = [System.IO.Path]::GetExtension($TargetPath)
  if ($ext -and $ext.ToLowerInvariant() -eq ".lnk") {
    $isShortcut = $true
  }
}

if ($isShortcut) {
  try {
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($TargetPath)
    if ($sc -and $sc.IconLocation) {
      $shortcutIcon = Normalize-ShortcutIconLocation -IconLocation ([string]$sc.IconLocation)
    }
    if ($ResolveShortcut.IsPresent) {
      $resolvedTarget = if ($sc -and $sc.TargetPath) { [string]$sc.TargetPath } else { "" }
      if ($resolvedTarget -and (Test-Path -LiteralPath $resolvedTarget)) {
        $effectiveTarget = $resolvedTarget
        if ($sc -and $sc.Arguments) {
          $resolvedLaunchArgs = [string]$sc.Arguments
        }
      } else {
        Write-Output "[SHORTCUT_TARGET_MISSING]"
        exit 40
      }
    }
  } catch {
    if ($ResolveShortcut.IsPresent) {
      Write-Output "[SHORTCUT_UNRESOLVED]"
      exit 40
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runnerPath = Join-Path $scriptDir "weftend_safe_run.ps1"
if (-not (Test-Path -LiteralPath $runnerPath)) {
  Write-Error "RUNNER_MISSING"
  exit 40
}

$repoRoot = Get-RepoRoot
$weftendIcon = Resolve-WeftEndIcon -Root $repoRoot

if (-not $effectiveTarget) {
  $effectiveTarget = $TargetPath
}

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

$args = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`" -Target `"$effectiveTarget`""
if ($AllowLaunch.IsPresent -or $LaunchpadMode.IsPresent) { $args += " -AllowLaunch" }
if ($OpenLibrary.IsPresent) { $args += " -OpenLibrary" }
if ($LaunchpadMode.IsPresent) { $args += " -LaunchpadMode -Open 0" }
if ($resolvedLaunchArgs -and $resolvedLaunchArgs.Trim() -ne "") {
  # Carry shortcut launch args through as encoded data so launchpad can launch
  # targets like VS Code that rely on shortcut arguments.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($resolvedLaunchArgs)
  $launchArgsB64 = [System.Convert]::ToBase64String($bytes)
  if ($launchArgsB64 -and $launchArgsB64.Length -gt 0 -and $launchArgsB64.Length -le 8192) {
    $args += " -LaunchArgsB64 `"$launchArgsB64`""
  }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $psExe
$shortcut.Arguments = $args
$shortcut.Description = if ($LaunchpadMode.IsPresent) { "WeftEnd Launchpad Shortcut v1" } else { "WeftEnd Shortcut v1" }
if ($UseTargetIcon.IsPresent) {
  if ($shortcutIcon -and $shortcutIcon.Trim() -ne "") {
    $shortcut.IconLocation = $shortcutIcon
  } elseif ($effectiveTarget -and (Test-Path -LiteralPath $effectiveTarget)) {
    $shortcut.IconLocation = $effectiveTarget
  } elseif ($weftendIcon) {
    $shortcut.IconLocation = $weftendIcon
  } else {
    $shortcut.IconLocation = $psExe
  }
} else {
  $shortcut.IconLocation = if ($weftendIcon) { $weftendIcon } else { $psExe }
}
$shortcut.Save()

if ($AllowLaunch.IsPresent) {
  Write-Output "SHORTCUT_CREATED mode=ALLOW_LAUNCH"
} else {
  Write-Output "SHORTCUT_CREATED mode=ANALYZE_ONLY"
}
exit 0
