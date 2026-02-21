# tools/windows/shell/weftend_shell_doctor.ps1
# Sanity check WeftEnd Safe-Run registry wiring (per-user).

param(
  [switch]$RepairReportViewer
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

if ($RepairReportViewer.IsPresent) {
  $repairOk = $false
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
    Write-Host "RepairReportViewer: FAILED"
  }
  if (-not $repairOk) { exit 40 }
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

if ($allOk) { exit 0 }
exit 40
