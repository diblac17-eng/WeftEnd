# tools/windows/shell/weftend_shell_doctor.ps1
# Sanity check WeftEnd Safe-Run registry wiring (per-user).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
    $item = Get-ItemProperty -LiteralPath $KeyPath -Name "(Default)" -ErrorAction Stop
    return $item."(Default)"
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

$configKey = "HKCU:\Software\WeftEnd\Shell"
$repoRoot = Read-RegistryValue -Path $configKey -Name "RepoRoot"
$outRoot = Read-RegistryValue -Path $configKey -Name "OutRoot"

$allOk = $true
if (-not (Print-ConfigStatus -Name "RepoRoot" -Value $repoRoot)) { $allOk = $false }
if (-not (Print-ConfigStatus -Name "OutRoot" -Value $outRoot)) { $allOk = $false }

$starKey = "HKCU:\Software\Classes\*\shell\WeftEndSafeRun\command"
$dirKey = "HKCU:\Software\Classes\Directory\shell\WeftEndSafeRun\command"
$dirBgKey = "HKCU:\Software\Classes\Directory\Background\shell\WeftEndSafeRun\command"
$zipKey = "HKCU:\Software\Classes\SystemFileAssociations\.zip\shell\WeftEndSafeRun\command"
$emlKey = "HKCU:\Software\Classes\SystemFileAssociations\.eml\shell\WeftEndSafeRun\command"
$mboxKey = "HKCU:\Software\Classes\SystemFileAssociations\.mbox\shell\WeftEndSafeRun\command"
$msgKey = "HKCU:\Software\Classes\SystemFileAssociations\.msg\shell\WeftEndSafeRun\command"
$starOpenKey = "HKCU:\Software\Classes\*\shell\WeftEndSafeRunOpenLibrary\command"
$dirOpenKey = "HKCU:\Software\Classes\Directory\shell\WeftEndSafeRunOpenLibrary\command"
$dirBgOpenKey = "HKCU:\Software\Classes\Directory\Background\shell\WeftEndSafeRunOpenLibrary\command"
$zipOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.zip\shell\WeftEndSafeRunOpenLibrary\command"
$emlOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.eml\shell\WeftEndSafeRunOpenLibrary\command"
$mboxOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.mbox\shell\WeftEndSafeRunOpenLibrary\command"
$msgOpenKey = "HKCU:\Software\Classes\SystemFileAssociations\.msg\shell\WeftEndSafeRunOpenLibrary\command"

if (-not (Check-CommandKey -Label "STAR_FILE_CMD" -KeyPath $starKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_CMD" -KeyPath $dirKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_BG_CMD" -KeyPath $dirBgKey -Token "%V")) { $allOk = $false }
if (-not (Check-CommandKey -Label "ZIP_CMD" -KeyPath $zipKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "EML_CMD" -KeyPath $emlKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MBOX_CMD" -KeyPath $mboxKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MSG_CMD" -KeyPath $msgKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "STAR_FILE_OPEN_LIB" -KeyPath $starOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_OPEN_LIB" -KeyPath $dirOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "DIR_BG_OPEN_LIB" -KeyPath $dirBgOpenKey -Token "%V")) { $allOk = $false }
if (-not (Check-CommandKey -Label "ZIP_OPEN_LIB" -KeyPath $zipOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "EML_OPEN_LIB" -KeyPath $emlOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MBOX_OPEN_LIB" -KeyPath $mboxOpenKey -Token "%1")) { $allOk = $false }
if (-not (Check-CommandKey -Label "MSG_OPEN_LIB" -KeyPath $msgOpenKey -Token "%1")) { $allOk = $false }

if ($allOk) { exit 0 }
exit 40
