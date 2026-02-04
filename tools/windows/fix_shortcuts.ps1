# tools/windows/fix_shortcuts.ps1
# Reapply the WeftEnd icon to Desktop and Start Menu shortcuts.

param(
  [switch]$ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$iconPath = (Resolve-Path "assets\\weftend_logo.ico").Path
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$start = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs"

$paths = @(
  (Join-Path $desktop "WeftEnd Library.lnk"),
  (Join-Path $desktop "WeftEnd Download.lnk"),
  (Join-Path $start "WeftEnd Library.lnk"),
  (Join-Path $start "WeftEnd Download.lnk")
)

foreach ($p in $paths) {
  if (Test-Path $p) {
    $sc = $shell.CreateShortcut($p)
    $sc.IconLocation = $iconPath
    $sc.Save()
  }
}

if ($ClearCache.IsPresent) {
  try { ie4uinit.exe -ClearIconCache | Out-Null } catch {}
  try {
    Get-ChildItem "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer" -Filter "iconcache*.db" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer" -Filter "thumbcache*.db" -ErrorAction SilentlyContinue | Remove-Item -Force
  } catch {}
  try { taskkill /f /im explorer.exe | Out-Null } catch {}
  Start-Process explorer.exe
}
