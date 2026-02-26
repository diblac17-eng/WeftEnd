# tools/windows/shell/weftend_shell_doctor.ps1
# Sanity check WeftEnd Safe-Run registry wiring (per-user).

param(
  [switch]$RepairReportViewer,
  [switch]$RepairShortcuts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$configKey = "HKCU:\Software\WeftEnd\Shell"

function Read-RegistryValue {
  param([string]$Path, [string]$Name)
  try {
    $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
    return $item.$Name
  } catch {
    return $null
  }
}

function Read-CommandDefault {
  param([string]$KeyPath)
  try {
    $regPath = $KeyPath
    if ($KeyPath.StartsWith("HKCU:\")) {
      $regPath = $KeyPath.Substring(6)
    }
    $root = [Microsoft.Win32.Registry]::CurrentUser
    $subKey = $root.OpenSubKey($regPath)
    if (-not $subKey) { return $null }
    $value = $subKey.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $subKey.Close()
    if ($null -eq $value) { return $null }
    return [string]$value
  } catch {
    return $null
  }
}

function Redact-Command {
  param([string]$CommandText)
  if (-not $CommandText) { return "" }
  $redacted = $CommandText
  $redacted = [System.Text.RegularExpressions.Regex]::Replace($redacted, '-File\s+"[^"]+"', '-File "..."')
  $redacted = [System.Text.RegularExpressions.Regex]::Replace($redacted, "-File\s+'[^']+'", "-File '...'")
  return $redacted
}

function Print-ConfigStatus {
  param([string]$Name, [string]$Value)
  if ($Value -and $Value.Trim() -ne "") {
    Write-Host "${Name}: OK"
    return $true
  }
  Write-Host "${Name}: MISSING"
  return $false
}

function Check-CommandKey {
  param([string]$Label, [string]$KeyPath, [string]$Token)
  $cmd = Read-CommandDefault -KeyPath $KeyPath
  if (-not $cmd -or $cmd.Trim() -eq "") {
    Write-Host "${Label}: BAD (missing command)"
    return $false
  }
  $ok = $cmd -like "*$Token*"
  $status = if ($ok) { "OK" } else { "BAD" }
  $redacted = Redact-Command -CommandText $cmd
  Write-Host "${Label}: ${status} (${Token}) command=""$redacted"""
  return $ok
}

function Resolve-PowerShellHostPath {
  $candidate = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return "powershell.exe"
}

function Ensure-ShortcutLink {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$IconLocation
  )
  $parent = Split-Path -Parent $ShortcutPath
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WindowStyle = 7
  if ($WorkingDirectory -and $WorkingDirectory.Trim() -ne "") {
    $shortcut.WorkingDirectory = $WorkingDirectory
  }
  if ($IconLocation -and $IconLocation.Trim() -ne "") {
    $shortcut.IconLocation = $IconLocation
  }
  $shortcut.Save()
}

function Check-ShortcutLink {
  param(
    [string]$Label,
    [string]$ShortcutPath,
    [string]$ExpectedTargetPath,
    [string[]]$RequiredArgTokens,
    [switch]$Optional
  )
  if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    if ($Optional.IsPresent) {
      Write-Host ("${Label}: MISSING (optional)")
      return $true
    }
    Write-Host ("${Label}: BAD (missing shortcut)")
    return $false
  }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $targetPath = [string]$shortcut.TargetPath
    $argText = [string]$shortcut.Arguments
    $targetOk = $true
    if ($ExpectedTargetPath -and $ExpectedTargetPath.Trim() -ne "") {
      $expectedLower = $ExpectedTargetPath.Trim().ToLowerInvariant()
      $targetLower = if ($targetPath) { $targetPath.Trim().ToLowerInvariant() } else { "" }
      if ($targetLower -ne $expectedLower -and $targetLower -ne "powershell.exe") {
        $targetOk = $false
      }
    }
    $argsOk = $true
    foreach ($tokenObj in @($RequiredArgTokens)) {
      $token = [string]$tokenObj
      if (-not $token -or $token.Trim() -eq "") { continue }
      if ($argText -notlike "*$token*") {
        $argsOk = $false
        break
      }
    }
    if ($targetOk -and $argsOk) {
      Write-Host ("${Label}: OK")
      return $true
    }
    Write-Host ("${Label}: BAD (shortcut target/args mismatch)")
    return $false
  } catch {
    if ($Optional.IsPresent) {
      Write-Host ("${Label}: BAD (optional shortcut read error)")
      return $true
    }
    Write-Host ("${Label}: BAD (shortcut read error)")
    return $false
  }
}

if ($RepairReportViewer.IsPresent) {
  $repairOk = $false
  $repairCode = "SHELL_DOCTOR_REPAIR_FAILED"
  try {
    if (-not (Test-Path -Path $configKey)) {
      New-Item -Path $configKey | Out-Null
    }
    Set-ItemProperty -Path $configKey -Name "UseReportViewer" -Value "1" -ErrorAction Stop
    Set-ItemProperty -Path $configKey -Name "ReportViewerAutoOpen" -Value "1" -ErrorAction Stop
    Set-ItemProperty -Path $configKey -Name "ReportViewerStartFailCount" -Value "0" -ErrorAction Stop
    $repairOk = $true
    Write-Host "RepairReportViewer: OK"
  } catch {
    Write-Host ("RepairReportViewer: FAILED code=" + $repairCode)
  }
  if (-not $repairOk) { exit 40 }
}

if ($RepairShortcuts.IsPresent) {
  $shortcutRepairOk = $false
  $shortcutRepairCode = "SHELL_DOCTOR_REPAIR_SHORTCUTS_FAILED"
  try {
    $repairRepoRoot = Read-RegistryValue -Path $configKey -Name "RepoRoot"
    if (-not $repairRepoRoot -or $repairRepoRoot.Trim() -eq "" -or -not (Test-Path -LiteralPath $repairRepoRoot)) {
      throw "missing reporoot"
    }
    $psExe = Resolve-PowerShellHostPath
    $launchpadPanel = Join-Path $repairRepoRoot "tools\windows\shell\launchpad_panel.ps1"
    $downloadScript = Join-Path $repairRepoRoot "tools\windows\open_release_folder.ps1"
    if (-not (Test-Path -LiteralPath $launchpadPanel)) { throw "missing launchpad panel script" }
    if (-not (Test-Path -LiteralPath $downloadScript)) { throw "missing download script" }
    $iconPath = Join-Path $repairRepoRoot "assets\weftend_logo.ico"
    if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = $psExe }
    $launchpadArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launchpadPanel`""
    $downloadArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$downloadScript`" -BuildIfMissing"
    $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $startLaunchpad = Join-Path $startMenu "WeftEnd Launchpad.lnk"
    $startDownload = Join-Path $startMenu "WeftEnd Download.lnk"
    Ensure-ShortcutLink -ShortcutPath $startLaunchpad -TargetPath $psExe -Arguments $launchpadArgs -WorkingDirectory $repairRepoRoot -IconLocation $iconPath
    Ensure-ShortcutLink -ShortcutPath $startDownload -TargetPath $psExe -Arguments $downloadArgs -WorkingDirectory $repairRepoRoot -IconLocation $iconPath
    $desktopLaunchpad = Join-Path $desktop "WeftEnd Launchpad.lnk"
    if (Test-Path -LiteralPath $desktopLaunchpad) {
      Ensure-ShortcutLink -ShortcutPath $desktopLaunchpad -TargetPath $psExe -Arguments $launchpadArgs -WorkingDirectory $repairRepoRoot -IconLocation $iconPath
    }
    $desktopDownload = Join-Path $desktop "WeftEnd Download.lnk"
    if (Test-Path -LiteralPath $desktopDownload) {
      Ensure-ShortcutLink -ShortcutPath $desktopDownload -TargetPath $psExe -Arguments $downloadArgs -WorkingDirectory $repairRepoRoot -IconLocation $iconPath
    }
    $shortcutRepairOk = $true
    Write-Host "RepairShortcuts: OK"
  } catch {
    Write-Host ("RepairShortcuts: FAILED code=" + $shortcutRepairCode)
  }
  if (-not $shortcutRepairOk) { exit 40 }
}

$repoRoot = Read-RegistryValue -Path $configKey -Name "RepoRoot"
$outRoot = Read-RegistryValue -Path $configKey -Name "OutRoot"
$useReportViewer = Read-RegistryValue -Path $configKey -Name "UseReportViewer"
$reportViewerAutoOpen = Read-RegistryValue -Path $configKey -Name "ReportViewerAutoOpen"
$reportViewerFailCount = Read-RegistryValue -Path $configKey -Name "ReportViewerStartFailCount"

$allOk = $true
if (-not (Print-ConfigStatus -Name "RepoRoot" -Value $repoRoot)) { $allOk = $false }
if (-not (Print-ConfigStatus -Name "OutRoot" -Value $outRoot)) { $allOk = $false }
if (-not (Print-ConfigStatus -Name "UseReportViewer" -Value $useReportViewer)) { $allOk = $false }
if (-not (Print-ConfigStatus -Name "ReportViewerAutoOpen" -Value $reportViewerAutoOpen)) { $allOk = $false }
if (-not $reportViewerFailCount -or [string]$reportViewerFailCount -eq "") { $reportViewerFailCount = "0" }
Write-Host ("ReportViewerStartFailCount: " + [string]$reportViewerFailCount)

$starKey = "HKCU:\Software\Classes\*\shell\WeftEndSafeRun\command"
$lnkKey = "HKCU:\Software\Classes\lnkfile\shell\WeftEndSafeRun\command"
$dirKey = "HKCU:\Software\Classes\Directory\shell\WeftEndSafeRun\command"
$dirBgKey = "HKCU:\Software\Classes\Directory\Background\shell\WeftEndSafeRun\command"
$zipKey = "HKCU:\Software\Classes\SystemFileAssociations\.zip\shell\WeftEndSafeRun\command"
$emlKey = "HKCU:\Software\Classes\SystemFileAssociations\.eml\shell\WeftEndSafeRun\command"
$mboxKey = "HKCU:\Software\Classes\SystemFileAssociations\.mbox\shell\WeftEndSafeRun\command"
$msgKey = "HKCU:\Software\Classes\SystemFileAssociations\.msg\shell\WeftEndSafeRun\command"
$starOpenKey = "HKCU:\Software\Classes\*\shell\WeftEndSafeRunOpenLibrary\command"
$lnkOpenKey = "HKCU:\Software\Classes\lnkfile\shell\WeftEndSafeRunOpenLibrary\command"
$dirOpenKey = "HKCU:\Software\Classes\Directory\shell\WeftEndSafeRunOpenLibrary\command"
$dirBgOpenKey = "HKCU:\Software\Classes\Directory\Background\shell\WeftEndSafeRunOpenLibrary\command"
$zipOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.zip\shell\WeftEndSafeRunOpenLibrary\command"
$emlOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.eml\shell\WeftEndSafeRunOpenLibrary\command"
$mboxOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.mbox\shell\WeftEndSafeRunOpenLibrary\command"
$msgOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.msg\shell\WeftEndSafeRunOpenLibrary\command"
$starBindKey = "HKCU:\Software\Classes\*\shell\WeftEndBind\command"
$starUnbindKey = "HKCU:\Software\Classes\*\shell\WeftEndUnbind\command"
$lnkBindKey = "HKCU:\Software\Classes\lnkfile\shell\WeftEndBind\command"
$lnkUnbindKey = "HKCU:\Software\Classes\lnkfile\shell\WeftEndUnbind\command"
$dirBindKey = "HKCU:\Software\Classes\Directory\shell\WeftEndBind\command"
$dirUnbindKey = "HKCU:\Software\Classes\Directory\shell\WeftEndUnbind\command"

if (-not (Check-CommandKey -Label "STAR_FILE_CMD" -KeyPath $starKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "LNK_FILE_CMD" -KeyPath $lnkKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_CMD" -KeyPath $dirKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_BG_CMD" -KeyPath $dirBgKey -Token "%V")) { $allOk = $false }
if (-not (Check-CommandKey -Label "ZIP_CMD" -KeyPath $zipKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "EML_CMD" -KeyPath $emlKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MBOX_CMD" -KeyPath $mboxKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MSG_CMD" -KeyPath $msgKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "STAR_FILE_OPEN_LIB" -KeyPath $starOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "LNK_FILE_OPEN_LIB" -KeyPath $lnkOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_OPEN_LIB" -KeyPath $dirOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_BG_OPEN_LIB" -KeyPath $dirBgOpenKey -Token "%V")) { $allOk = $false }
if (-not (Check-CommandKey -Label "ZIP_OPEN_LIB" -KeyPath $zipOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "EML_OPEN_LIB" -KeyPath $emlOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MBOX_OPEN_LIB" -KeyPath $mboxOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MSG_OPEN_LIB" -KeyPath $msgOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "STAR_BIND" -KeyPath $starBindKey -Token "-Action bind")) { $allOk = $false }
if (-not (Check-CommandKey -Label "STAR_UNBIND" -KeyPath $starUnbindKey -Token "-Action unbind")) { $allOk = $false }
if (-not (Check-CommandKey -Label "LNK_BIND" -KeyPath $lnkBindKey -Token "-Action bind")) { $allOk = $false }
if (-not (Check-CommandKey -Label "LNK_UNBIND" -KeyPath $lnkUnbindKey -Token "-Action unbind")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_BIND" -KeyPath $dirBindKey -Token "-Action bind")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_UNBIND" -KeyPath $dirUnbindKey -Token "-Action unbind")) { $allOk = $false }

$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$desktopDir = [Environment]::GetFolderPath("Desktop")
$startLaunchpadShortcut = Join-Path $startMenuDir "WeftEnd Launchpad.lnk"
$startDownloadShortcut = Join-Path $startMenuDir "WeftEnd Download.lnk"
$desktopLaunchpadShortcut = Join-Path $desktopDir "WeftEnd Launchpad.lnk"
$desktopDownloadShortcut = Join-Path $desktopDir "WeftEnd Download.lnk"
$expectedPsExe = Resolve-PowerShellHostPath
$launchpadScriptPath = if ($repoRoot -and $repoRoot.Trim() -ne "") { Join-Path $repoRoot "tools\windows\shell\launchpad_panel.ps1" } else { "" }
$downloadScriptPath = if ($repoRoot -and $repoRoot.Trim() -ne "") { Join-Path $repoRoot "tools\windows\open_release_folder.ps1" } else { "" }
if (-not (Check-ShortcutLink -Label "STARTMENU_LAUNCHPAD_SHORTCUT" -ShortcutPath $startLaunchpadShortcut -ExpectedTargetPath $expectedPsExe -RequiredArgTokens @("launchpad_panel.ps1", $launchpadScriptPath))) { $allOk = $false }
if (-not (Check-ShortcutLink -Label "STARTMENU_DOWNLOAD_SHORTCUT" -ShortcutPath $startDownloadShortcut -ExpectedTargetPath $expectedPsExe -RequiredArgTokens @("open_release_folder.ps1", "-BuildIfMissing", $downloadScriptPath))) { $allOk = $false }
[void](Check-ShortcutLink -Label "DESKTOP_LAUNCHPAD_SHORTCUT" -ShortcutPath $desktopLaunchpadShortcut -ExpectedTargetPath $expectedPsExe -RequiredArgTokens @("launchpad_panel.ps1", $launchpadScriptPath) -Optional)
[void](Check-ShortcutLink -Label "DESKTOP_DOWNLOAD_SHORTCUT" -ShortcutPath $desktopDownloadShortcut -ExpectedTargetPath $expectedPsExe -RequiredArgTokens @("open_release_folder.ps1", "-BuildIfMissing", $downloadScriptPath) -Optional)

if ($allOk) {
  Write-Host "ShellDoctorStatus: PASS"
  exit 0
}
Write-Host "ShellDoctorStatus: FAIL code=SHELL_DOCTOR_CONFIG_INVALID"
exit 40
