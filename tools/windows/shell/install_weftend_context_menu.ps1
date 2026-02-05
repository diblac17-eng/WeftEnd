# tools/windows/shell/install_weftend_context_menu.ps1
# Install per-user context menu entry for WeftEnd Safe-Run.

param(
  [string]$RepoRoot,
  [string]$OutRoot,
  [switch]$DesktopShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runnerPath = Join-Path $scriptDir "weftend_safe_run.ps1"

if (-not $RepoRoot -or $RepoRoot.Trim() -eq "") {
  $guess = Join-Path $scriptDir "..\..\.."
  if (Test-Path (Join-Path $guess "package.json")) {
    $RepoRoot = (Resolve-Path $guess).Path
  } else {
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
  }
}
if (-not $OutRoot -or $OutRoot.Trim() -eq "") {
  if ($env:LOCALAPPDATA) {
    $OutRoot = Join-Path (Join-Path $env:LOCALAPPDATA "WeftEnd") "Library"
  }
}

function Resolve-LibraryRoot {
  param([string]$Base)
  $trimmed = if ($Base) { $Base.Trim() } else { "" }
  if ($trimmed -eq "") { return $null }
  $leaf = [System.IO.Path]::GetFileName($trimmed.TrimEnd('\', '/'))
  if ($leaf.ToLowerInvariant() -eq "library") { return $trimmed }
  return (Join-Path $trimmed "Library")
}

$libraryRoot = Resolve-LibraryRoot -Base $OutRoot
if ($libraryRoot -and $libraryRoot.Trim() -ne "") {
  if ($env:WEFTEND_ENABLE_LAUNCHPAD -eq "1") {
    $launchpadTargetsDir = Join-Path $libraryRoot "Launchpad\Targets"
    $launchpadShortcutsDir = Join-Path $libraryRoot "Launchpad\Shortcuts"
    New-Item -ItemType Directory -Force -Path $launchpadTargetsDir | Out-Null
    New-Item -ItemType Directory -Force -Path $launchpadShortcutsDir | Out-Null
  }
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
    $iconScript = Join-Path $Root "tools/windows/gen_icon.ps1"
    if (Test-Path $iconScript) {
      try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $iconScript -PngPath $pngPath -OutIco $icoPath | Out-Null
      } catch {
        # fall back to PNG
      }
    }
  }
  if (Test-Path $icoPath) { return $icoPath }
  try {
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
    $bmp.Dispose()
    $icon.Dispose()
  } catch {
    # fall back to PNG
  }
  if (Test-Path $icoPath) { return $icoPath }
  return $pngPath
}

$weftendIcon = Resolve-WeftEndIcon -Root $RepoRoot

$configKey = "HKCU:\Software\WeftEnd\Shell"
New-Item -Path $configKey -Force | Out-Null
Set-ItemProperty -Path $configKey -Name "RepoRoot" -Value $RepoRoot
Set-ItemProperty -Path $configKey -Name "OutRoot" -Value $OutRoot
Set-ItemProperty -Path $configKey -Name "OpenFolderOnComplete" -Value "1"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd -and $nodeCmd.Path) {
  Set-ItemProperty -Path $configKey -Name "NodeExe" -Value $nodeCmd.Path
}
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd -and $npmCmd.Path) {
  Set-ItemProperty -Path $configKey -Name "NpmCmd" -Value $npmCmd.Path
}

function Set-ContextMenu {
  param(
    [string]$BaseSubKey,
    [string]$KeyName,
    [string]$Verb,
    [string]$TargetToken = "%1",
    [string]$ExtraArgs = "",
    [string]$IconPath = $null
  )
  $baseClean = $BaseSubKey.TrimEnd('\')
  $menuKey = "$baseClean\shell\$KeyName"
  $commandKey = "$menuKey\command"
  $suffix = if ($ExtraArgs -and $ExtraArgs.Trim() -ne "") { " $ExtraArgs" } else { "" }
  $command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`" -Target `"$TargetToken`"$suffix"
  $root = [Microsoft.Win32.Registry]::CurrentUser
  $menuKeyObj = $root.CreateSubKey($menuKey)
  if ($menuKeyObj) {
    $menuKeyObj.SetValue("MUIVerb", $Verb, [Microsoft.Win32.RegistryValueKind]::String)
    if ($IconPath -and $IconPath.Trim() -ne "") {
      $menuKeyObj.SetValue("Icon", $IconPath, [Microsoft.Win32.RegistryValueKind]::String)
    }
    $menuKeyObj.Close()
  }
  $commandKeyObj = $root.CreateSubKey($commandKey)
  if ($commandKeyObj) {
    $commandKeyObj.SetValue("", $command, [Microsoft.Win32.RegistryValueKind]::String)
    $commandKeyObj.Close()
  }
}

Set-ContextMenu -BaseSubKey "Software\Classes\*" -KeyName "WeftEndSafeRun" -Verb "Run with WeftEnd" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\*" -KeyName "WeftEndSafeRunOpenLibrary" -Verb "Run with WeftEnd (Open Library)" -ExtraArgs "-OpenLibrary" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\Directory" -KeyName "WeftEndSafeRun" -Verb "Run with WeftEnd" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\Directory" -KeyName "WeftEndSafeRunOpenLibrary" -Verb "Run with WeftEnd (Open Library)" -ExtraArgs "-OpenLibrary" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\Directory\Background" -KeyName "WeftEndSafeRun" -Verb "Run with WeftEnd" -TargetToken "%V" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\Directory\Background" -KeyName "WeftEndSafeRunOpenLibrary" -Verb "Run with WeftEnd (Open Library)" -TargetToken "%V" -ExtraArgs "-OpenLibrary" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.zip" -KeyName "WeftEndSafeRun" -Verb "Run with WeftEnd" -IconPath $weftendIcon
Set-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.zip" -KeyName "WeftEndSafeRunOpenLibrary" -Verb "Run with WeftEnd (Open Library)" -ExtraArgs "-OpenLibrary" -IconPath $weftendIcon

function Install-LibraryShortcut {
  param([string]$ShortcutPath)
  if (-not $ShortcutPath) { return }
  if (-not $libraryRoot -or $libraryRoot.Trim() -eq "") { return }
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  $target = if (Test-Path -LiteralPath $explorerPath) { $explorerPath } else { "explorer.exe" }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $target
  $shortcut.Arguments = "`"$libraryRoot`""
  $shortcut.IconLocation = if ($weftendIcon) { $weftendIcon } else { $target }
  $shortcut.Save()
}

$launchpadRoot = $null
$launchpadTargets = $null
$launchpadPanel = $null
if ($env:WEFTEND_ENABLE_LAUNCHPAD -eq "1") {
  $launchpadRoot = Join-Path $libraryRoot "Launchpad"
  $launchpadTargets = Join-Path $launchpadRoot "Targets"
  $launchpadPanel = Join-Path $scriptDir "launchpad_panel.ps1"
}
function Install-LaunchpadShortcut {
  param([string]$ShortcutPath)
  if (-not $ShortcutPath) { return }
  if ($env:WEFTEND_ENABLE_LAUNCHPAD -ne "1") { return }
  if (-not $launchpadRoot -or $launchpadRoot.Trim() -eq "") { return }
  $psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
  $target = $psExe
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  if (Test-Path -LiteralPath $launchpadPanel) {
    $shortcut.TargetPath = $target
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launchpadPanel`""
  } else {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    $explorerTarget = if (Test-Path -LiteralPath $explorerPath) { $explorerPath } else { "explorer.exe" }
    $shortcut.TargetPath = $explorerTarget
    $shortcut.Arguments = "`"$launchpadRoot`""
  }
  $shortcut.IconLocation = if ($weftendIcon) { $weftendIcon } else { $target }
  $shortcut.Save()
}

$downloadScript = Join-Path $scriptDir "..\open_release_folder.ps1"

function Install-DownloadShortcut {
  param([string]$ShortcutPath)
  if (-not $ShortcutPath) { return }
  if (-not (Test-Path $downloadScript)) { return }
  $psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $psExe
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$downloadScript`" -BuildIfMissing"
  $shortcut.IconLocation = if ($weftendIcon) { $weftendIcon } else { $psExe }
  $shortcut.Save()
}

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
if ($startMenu -and (Test-Path $startMenu)) {
  Install-LibraryShortcut -ShortcutPath (Join-Path $startMenu "WeftEnd Library.lnk")
  Install-LaunchpadShortcut -ShortcutPath (Join-Path $startMenu "WeftEnd Launchpad.lnk")
  Install-DownloadShortcut -ShortcutPath (Join-Path $startMenu "WeftEnd Download.lnk")
}

if ($DesktopShortcut.IsPresent) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  if ($desktop -and (Test-Path $desktop)) {
    Install-LibraryShortcut -ShortcutPath (Join-Path $desktop "WeftEnd Library.lnk")
    Install-LaunchpadShortcut -ShortcutPath (Join-Path $desktop "WeftEnd Launchpad.lnk")
    Install-DownloadShortcut -ShortcutPath (Join-Path $desktop "WeftEnd Download.lnk")
  }
}

Write-Output "Installed Run with WeftEnd context menu."
