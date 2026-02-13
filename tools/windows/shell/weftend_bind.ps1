# tools/windows/shell/weftend_bind.ps1
# Bind/unbind local targets to a WeftEnd-gated shortcut flow.

param(
  [Parameter(Position = 0)]
  [string]$TargetPath,
  [Alias("Target")]
  [string]$TargetCompat,
  [ValidateSet("bind", "unbind")]
  [string]$Action = "bind"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
$scriptDir = Split-Path -Parent ((Resolve-Path -LiteralPath $scriptPath).Path)

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

function Is-ShortcutPath {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  $ext = [System.IO.Path]::GetExtension($PathValue)
  if (-not $ext) { return $false }
  return $ext.ToLowerInvariant() -eq ".lnk"
}

function Get-BindMetaPath {
  param([string]$ShortcutPath)
  return ($ShortcutPath + ".weftend_bind_v1.json")
}

function Read-ShortcutSnapshot {
  param([string]$ShortcutPath)
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($ShortcutPath)
  return [ordered]@{
    targetPath = [string]$sc.TargetPath
    arguments = [string]$sc.Arguments
    description = [string]$sc.Description
    iconLocation = [string]$sc.IconLocation
    workingDirectory = [string]$sc.WorkingDirectory
    hotkey = [string]$sc.Hotkey
    windowStyle = [int]$sc.WindowStyle
  }
}

function Write-ShortcutSnapshot {
  param(
    [string]$ShortcutPath,
    [object]$Snapshot
  )
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($ShortcutPath)
  $sc.TargetPath = [string]$Snapshot.targetPath
  $sc.Arguments = [string]$Snapshot.arguments
  $sc.Description = [string]$Snapshot.description
  $sc.IconLocation = [string]$Snapshot.iconLocation
  $sc.WorkingDirectory = [string]$Snapshot.workingDirectory
  $sc.Hotkey = [string]$Snapshot.hotkey
  $sc.WindowStyle = [int]$Snapshot.windowStyle
  $sc.Save()
}

function Is-WeftEndShortcutSnapshot {
  param([object]$Snapshot)
  if (-not $Snapshot) { return $false }
  $target = [string]$Snapshot.targetPath
  if (-not $target) { return $false }
  $leaf = [System.IO.Path]::GetFileName($target).ToLowerInvariant()
  if ($leaf -ne "powershell.exe" -and $leaf -ne "pwsh.exe") { return $false }
  $args = [string]$Snapshot.arguments
  return $args -match "weftend_safe_run\.ps1"
}

function Resolve-BoundShortcutPath {
  param([string]$SourcePath)
  $parent = Split-Path -Parent $SourcePath
  if (-not $parent -or $parent.Trim() -eq "") {
    $parent = [Environment]::GetFolderPath("Desktop")
  }
  $leaf = [System.IO.Path]::GetFileName($SourcePath)
  if (-not $leaf -or $leaf.Trim() -eq "") { $leaf = "BoundTarget" }
  return (Join-Path $parent ($leaf + " (WeftEnd Bound).lnk"))
}

function Invoke-MakeShortcut {
  param(
    [string]$TargetValue,
    [string]$ShortcutValue,
    [bool]$ResolveShortcut = $false
  )
  $makeShortcutScript = Join-Path $scriptDir "weftend_make_shortcut.ps1"
  if (-not (Test-Path -LiteralPath $makeShortcutScript)) {
    throw "MAKE_SHORTCUT_SCRIPT_MISSING"
  }
  $psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $psExe)) { $psExe = "powershell.exe" }
  $procArgs = @(
    "-NoProfile",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $makeShortcutScript,
    "-TargetPath",
    $TargetValue,
    "-ShortcutPath",
    $ShortcutValue,
    "-AllowLaunch",
    "-UseTargetIcon"
  )
  if ($ResolveShortcut) {
    $procArgs += "-ResolveShortcut"
  }
  & $psExe @procArgs | Out-Null
  $exitCode = [int]$LASTEXITCODE
  if ($exitCode -ne 0) {
    throw ("MAKE_SHORTCUT_FAILED_" + $exitCode)
  }
}

function Load-BindMeta {
  param([string]$MetaPath)
  if (-not (Test-Path -LiteralPath $MetaPath)) { return $null }
  try {
    return (Get-Content -LiteralPath $MetaPath -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Save-BindMeta {
  param(
    [string]$MetaPath,
    [object]$Meta
  )
  ($Meta | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $MetaPath -Encoding UTF8
}

$normalizedTarget = Normalize-TargetPath -Value $TargetPath
if (-not $normalizedTarget) {
  $normalizedTarget = Normalize-TargetPath -Value $TargetCompat
}
if (-not $normalizedTarget) {
  Write-Output "[BIND_TARGET_MISSING]"
  exit 40
}

$targetCanonical = $normalizedTarget
if (-not (Test-Path -LiteralPath $targetCanonical)) {
  Write-Output "[BIND_TARGET_NOT_FOUND]"
  exit 40
}

$isShortcutTarget = Is-ShortcutPath -PathValue $targetCanonical

if ($Action -eq "bind") {
  if ($isShortcutTarget) {
    $metaPath = Get-BindMetaPath -ShortcutPath $targetCanonical
    $existingMeta = Load-BindMeta -MetaPath $metaPath
    if ($existingMeta -and [string]$existingMeta.mode -eq "rewrap_lnk") {
      Write-Output "[BIND_ALREADY_BOUND]"
      exit 0
    }
    $snapshot = Read-ShortcutSnapshot -ShortcutPath $targetCanonical
    if (Is-WeftEndShortcutSnapshot -Snapshot $snapshot) {
      Write-Output "[BIND_ALREADY_WEFTEND_SHORTCUT]"
      exit 0
    }
    $meta = [ordered]@{
      schema = "weftend.bind/1"
      mode = "rewrap_lnk"
      sourcePath = $targetCanonical
      original = $snapshot
      createdAtUtc = [DateTime]::UtcNow.ToString("o")
    }
    Save-BindMeta -MetaPath $metaPath -Meta $meta
    try {
      Invoke-MakeShortcut -TargetValue $targetCanonical -ShortcutValue $targetCanonical -ResolveShortcut:$true
      $after = Read-ShortcutSnapshot -ShortcutPath $targetCanonical
      $after.description = "WeftEnd Bound Shortcut v1"
      Write-ShortcutSnapshot -ShortcutPath $targetCanonical -Snapshot $after
      Write-Output "[BIND_OK mode=rewrap]"
      exit 0
    } catch {
      Write-Output ("[BIND_ERROR " + [string]$_ + "]")
      if (Test-Path -LiteralPath $metaPath) {
        Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue
      }
      Write-Output "[BIND_FAILED]"
      exit 40
    }
  }

  $boundShortcutPath = Resolve-BoundShortcutPath -SourcePath $targetCanonical
  $boundMetaPath = Get-BindMetaPath -ShortcutPath $boundShortcutPath
  if ((Test-Path -LiteralPath $boundShortcutPath) -and (Test-Path -LiteralPath $boundMetaPath)) {
    $boundMeta = Load-BindMeta -MetaPath $boundMetaPath
    if ($boundMeta -and [string]$boundMeta.mode -eq "created_bound_link" -and [string]$boundMeta.sourcePath -eq $targetCanonical) {
      Write-Output "[BIND_ALREADY_BOUND]"
      exit 0
    }
  }
  try {
    Invoke-MakeShortcut -TargetValue $targetCanonical -ShortcutValue $boundShortcutPath -ResolveShortcut:$false
    $meta = [ordered]@{
      schema = "weftend.bind/1"
      mode = "created_bound_link"
      sourcePath = $targetCanonical
      boundShortcut = $boundShortcutPath
      createdAtUtc = [DateTime]::UtcNow.ToString("o")
    }
    Save-BindMeta -MetaPath $boundMetaPath -Meta $meta
    $after = Read-ShortcutSnapshot -ShortcutPath $boundShortcutPath
    $after.description = "WeftEnd Bound Shortcut v1"
    Write-ShortcutSnapshot -ShortcutPath $boundShortcutPath -Snapshot $after
    Write-Output ("[BIND_OK mode=created shortcut=""" + $boundShortcutPath + """]")
    exit 0
  } catch {
    Write-Output ("[BIND_ERROR " + [string]$_ + "]")
    Write-Output "[BIND_FAILED]"
    exit 40
  }
}

if ($Action -eq "unbind") {
  if ($isShortcutTarget) {
    $metaPath = Get-BindMetaPath -ShortcutPath $targetCanonical
    $meta = Load-BindMeta -MetaPath $metaPath
    if (-not $meta) {
      Write-Output "[UNBIND_METADATA_MISSING]"
      exit 40
    }
    $mode = [string]$meta.mode
    if ($mode -eq "rewrap_lnk") {
      if (-not $meta.original) {
        Write-Output "[UNBIND_METADATA_INVALID]"
        exit 40
      }
      Write-ShortcutSnapshot -ShortcutPath $targetCanonical -Snapshot $meta.original
      Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue
      Write-Output "[UNBIND_OK mode=rewrap_restore]"
      exit 0
    }
    if ($mode -eq "created_bound_link") {
      Remove-Item -LiteralPath $targetCanonical -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue
      Write-Output "[UNBIND_OK mode=remove_bound_link]"
      exit 0
    }
    Write-Output "[UNBIND_METADATA_INVALID]"
    exit 40
  }

  $boundShortcutPath = Resolve-BoundShortcutPath -SourcePath $targetCanonical
  $boundMetaPath = Get-BindMetaPath -ShortcutPath $boundShortcutPath
  $meta = Load-BindMeta -MetaPath $boundMetaPath
  if (-not $meta) {
    Write-Output "[UNBIND_NOT_FOUND]"
    exit 40
  }
  if ([string]$meta.mode -ne "created_bound_link") {
    Write-Output "[UNBIND_METADATA_INVALID]"
    exit 40
  }
  if ([string]$meta.sourcePath -ne $targetCanonical) {
    Write-Output "[UNBIND_SOURCE_MISMATCH]"
    exit 40
  }
  if (Test-Path -LiteralPath $boundShortcutPath) {
    Remove-Item -LiteralPath $boundShortcutPath -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $boundMetaPath -Force -ErrorAction SilentlyContinue
  Write-Output "[UNBIND_OK mode=remove_bound_link]"
  exit 0
}

Write-Output "[BIND_ACTION_INVALID]"
exit 40
