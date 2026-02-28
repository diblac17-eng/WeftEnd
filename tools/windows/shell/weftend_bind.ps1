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

function Get-BackupShortcutPath {
  param([string]$ShortcutPath)
  return ($ShortcutPath + ".weftend_bind_v1.original.lnk")
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

function Test-BoundShortcutHasCurrentFlags {
  param(
    [object]$Snapshot,
    [bool]$RequireLaunchTargetPath = $false
  )
  if (-not (Is-WeftEndShortcutSnapshot -Snapshot $Snapshot)) { return $false }
  $args = [string]$Snapshot.arguments
  if (-not ($args -match "(^|\s)-AllowLaunch(\s|$)")) { return $false }
  if (-not ($args -match "(^|\s)-OpenOnChangedOnly(\s|$)")) { return $false }
  if ($RequireLaunchTargetPath -and -not ($args -match "(^|\s)-LaunchTargetPath(\s|$)")) { return $false }
  return $true
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
    "-OpenOnChangedOnly",
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
  Write-TextFileAtomic -PathValue $MetaPath -TextValue ($Meta | ConvertTo-Json -Depth 8)
}

function Write-TextFileAtomic {
  param(
    [string]$PathValue,
    [string]$TextValue
  )
  if (-not $PathValue -or $PathValue.Trim() -eq "") {
    throw "BIND_META_PATH_INVALID"
  }
  $dir = Split-Path -Parent $PathValue
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $stage = $PathValue + ".stage"
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue
  }
  Set-Content -LiteralPath $stage -Value $TextValue -Encoding UTF8
  Move-Item -LiteralPath $stage -Destination $PathValue -Force
}

function Get-MetaValue {
  param(
    [object]$Meta,
    [string]$Name
  )
  if (-not $Meta -or -not $Name) { return $null }
  $prop = $Meta.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  return $prop.Value
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
    $existingMode = [string](Get-MetaValue -Meta $existingMeta -Name "mode")
    if ($existingMeta -and $existingMode -eq "rewrap_lnk") {
      $currentSnapshot = Read-ShortcutSnapshot -ShortcutPath $targetCanonical
      if (Is-WeftEndShortcutSnapshot -Snapshot $currentSnapshot) {
        if (Test-BoundShortcutHasCurrentFlags -Snapshot $currentSnapshot -RequireLaunchTargetPath:$true) {
          Write-Output "[BIND_ALREADY_BOUND]"
          exit 0
        }
        $backupPath = [string](Get-MetaValue -Meta $existingMeta -Name "backupPath")
        if (-not $backupPath -or $backupPath.Trim() -eq "") {
          $backupPath = Get-BackupShortcutPath -ShortcutPath $targetCanonical
        }
        $originalSnapshot = Get-MetaValue -Meta $existingMeta -Name "original"
        try {
          Invoke-MakeShortcut -TargetValue $targetCanonical -ShortcutValue $targetCanonical -ResolveShortcut:$true
          $after = Read-ShortcutSnapshot -ShortcutPath $targetCanonical
          $after.description = "WeftEnd Bound Shortcut v1"
          if ($null -ne $originalSnapshot) {
            $originalIcon = [string](Get-MetaValue -Meta $originalSnapshot -Name "iconLocation")
            if ($originalIcon -and $originalIcon -ne "") { $after.iconLocation = $originalIcon }
          }
          Write-ShortcutSnapshot -ShortcutPath $targetCanonical -Snapshot $after
          Write-Output "[BIND_UPGRADED mode=rewrap]"
          exit 0
        } catch {
          Write-Output ("[BIND_ERROR " + [string]$_ + "]")
          if ($backupPath -and (Test-Path -LiteralPath $backupPath)) {
            Copy-Item -LiteralPath $backupPath -Destination $targetCanonical -Force
          }
          Write-Output "[BIND_FAILED]"
          exit 40
        }
      }
      Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue
      $legacyBackupPath = Get-BackupShortcutPath -ShortcutPath $targetCanonical
      if (Test-Path -LiteralPath $legacyBackupPath) {
        Remove-Item -LiteralPath $legacyBackupPath -Force -ErrorAction SilentlyContinue
      }
    }
    $snapshot = Read-ShortcutSnapshot -ShortcutPath $targetCanonical
    if (Is-WeftEndShortcutSnapshot -Snapshot $snapshot) {
      Write-Output "[BIND_ALREADY_WEFTEND_SHORTCUT]"
      exit 0
    }
    $backupPath = Get-BackupShortcutPath -ShortcutPath $targetCanonical
    if (-not (Test-Path -LiteralPath $backupPath)) {
      Copy-Item -LiteralPath $targetCanonical -Destination $backupPath -Force
    }
    try {
      Invoke-MakeShortcut -TargetValue $targetCanonical -ShortcutValue $targetCanonical -ResolveShortcut:$true
      $after = Read-ShortcutSnapshot -ShortcutPath $targetCanonical
      $after.description = "WeftEnd Bound Shortcut v1"
      if ($snapshot.iconLocation -and [string]$snapshot.iconLocation -ne "") {
        $after.iconLocation = [string]$snapshot.iconLocation
      }
      Write-ShortcutSnapshot -ShortcutPath $targetCanonical -Snapshot $after
      $meta = [ordered]@{
        schema = "weftend.bind/1"
        mode = "rewrap_lnk"
        sourcePath = $targetCanonical
        backupPath = $backupPath
        original = $snapshot
      }
      Save-BindMeta -MetaPath $metaPath -Meta $meta
      Write-Output "[BIND_OK mode=rewrap]"
      exit 0
    } catch {
      Write-Output ("[BIND_ERROR " + [string]$_ + "]")
      if (Test-Path -LiteralPath $backupPath) {
        Copy-Item -LiteralPath $backupPath -Destination $targetCanonical -Force
      }
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
      $boundSnapshot = Read-ShortcutSnapshot -ShortcutPath $boundShortcutPath
      if (Test-BoundShortcutHasCurrentFlags -Snapshot $boundSnapshot -RequireLaunchTargetPath:$false) {
        Write-Output "[BIND_ALREADY_BOUND]"
        exit 0
      }
      try {
        Invoke-MakeShortcut -TargetValue $targetCanonical -ShortcutValue $boundShortcutPath -ResolveShortcut:$false
        $after = Read-ShortcutSnapshot -ShortcutPath $boundShortcutPath
        $after.description = "WeftEnd Bound Shortcut v1"
        Write-ShortcutSnapshot -ShortcutPath $boundShortcutPath -Snapshot $after
        Write-Output "[BIND_UPGRADED mode=created]"
        exit 0
      } catch {
        Write-Output ("[BIND_ERROR " + [string]$_ + "]")
        Write-Output "[BIND_FAILED]"
        exit 40
      }
    }
  }
  try {
    Invoke-MakeShortcut -TargetValue $targetCanonical -ShortcutValue $boundShortcutPath -ResolveShortcut:$false
    $meta = [ordered]@{
      schema = "weftend.bind/1"
      mode = "created_bound_link"
      sourcePath = $targetCanonical
      boundShortcut = $boundShortcutPath
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
    $mode = [string](Get-MetaValue -Meta $meta -Name "mode")
    if ($mode -eq "rewrap_lnk") {
      $backupPath = [string](Get-MetaValue -Meta $meta -Name "backupPath")
      if (-not $backupPath -or $backupPath.Trim() -eq "") {
        $backupPath = Get-BackupShortcutPath -ShortcutPath $targetCanonical
      }
      $originalSnapshot = Get-MetaValue -Meta $meta -Name "original"
      if ($backupPath -and (Test-Path -LiteralPath $backupPath)) {
        Copy-Item -LiteralPath $backupPath -Destination $targetCanonical -Force
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
      } elseif ($null -ne $originalSnapshot) {
        Write-ShortcutSnapshot -ShortcutPath $targetCanonical -Snapshot $originalSnapshot
      } else {
        Write-Output "[UNBIND_METADATA_INVALID]"
        exit 40
      }
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
