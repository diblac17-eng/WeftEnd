# tools/windows/shell/uninstall_weftend_context_menu.ps1
# Uninstall per-user context menu entry for WeftEnd Safe-Run.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Remove-ContextMenu {
  param([string]$BaseSubKey, [string]$KeyName)
  $baseClean = $BaseSubKey.TrimEnd('\')
  $menuKey = "$baseClean\shell\$KeyName"
  $root = [Microsoft.Win32.Registry]::CurrentUser
  try {
    $root.DeleteSubKeyTree($menuKey, $false)
  } catch {
    # ignore missing keys
  }
}

Remove-ContextMenu -BaseSubKey "Software\Classes\*" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\*" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\lnkfile" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\lnkfile" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\Directory" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\Directory" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\Directory\Background" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\Directory\Background" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.zip" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.zip" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.eml" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.eml" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.mbox" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.mbox" -KeyName "WeftEndSafeRunOpenLibrary"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.msg" -KeyName "WeftEndSafeRun"
Remove-ContextMenu -BaseSubKey "Software\Classes\SystemFileAssociations\.msg" -KeyName "WeftEndSafeRunOpenLibrary"

$configKey = "HKCU:\Software\WeftEnd\Shell"
if (Test-Path $configKey) {
  Remove-Item -Path $configKey -Recurse -Force
}

function Remove-Shortcut {
  param([string]$ShortcutPath)
  if ($ShortcutPath -and (Test-Path $ShortcutPath)) {
    Remove-Item -Path $ShortcutPath -Force
  }
}

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
if ($startMenu -and (Test-Path $startMenu)) {
  Remove-Shortcut -ShortcutPath (Join-Path $startMenu "WeftEnd.lnk")
  Remove-Shortcut -ShortcutPath (Join-Path $startMenu "WeftEnd Library.lnk")
  Remove-Shortcut -ShortcutPath (Join-Path $startMenu "WeftEnd Launchpad.lnk")
  Remove-Shortcut -ShortcutPath (Join-Path $startMenu "WeftEnd Download.lnk")
}
$desktop = [Environment]::GetFolderPath("Desktop")
if ($desktop -and (Test-Path $desktop)) {
  Remove-Shortcut -ShortcutPath (Join-Path $desktop "WeftEnd.lnk")
  Remove-Shortcut -ShortcutPath (Join-Path $desktop "WeftEnd Library.lnk")
  Remove-Shortcut -ShortcutPath (Join-Path $desktop "WeftEnd Launchpad.lnk")
  Remove-Shortcut -ShortcutPath (Join-Path $desktop "WeftEnd Download.lnk")
}

Write-Output "Uninstalled WeftEnd: Safe-Run context menu."
