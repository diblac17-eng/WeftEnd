# tools/windows/shell/launchpad_panel.ps1
# Small Launchpad panel for clicking WeftEnd shortcuts.

param(
  [switch]$TopMost
)

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

function Resolve-ExecutablePath {
  param(
    [string]$Preferred,
    [string]$CommandName,
    [string[]]$Fallbacks
  )
  if ($Preferred -and $Preferred.Trim() -ne "" -and (Test-Path -LiteralPath $Preferred)) {
    return $Preferred
  }
  $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path -and (Test-Path -LiteralPath $cmd.Path)) {
    return [string]$cmd.Path
  }
  foreach ($candidate in $Fallbacks) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  return $null
}

function Resolve-LibraryRoot {
  param([string]$Base)
  $trimmed = if ($Base) { $Base.Trim() } else { "" }
  if ($trimmed -eq "") { return $null }
  $leaf = [System.IO.Path]::GetFileName($trimmed.TrimEnd('\', '/'))
  if ($leaf.ToLowerInvariant() -eq "library") { return $trimmed }
  return (Join-Path $trimmed "Library")
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

function Get-IconImage {
  param([string]$ShortcutPath, [string]$FallbackIcon)
  try {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    $iconLoc = if ($sc -and $sc.IconLocation) { [string]$sc.IconLocation } else { "" }
    $targetPath = if ($sc -and $sc.TargetPath) { [string]$sc.TargetPath } else { "" }
    $iconPath = $iconLoc
    if ($iconLoc -match "^(.*),([0-9]+)$") {
      $iconPath = $matches[1]
    }
    $iconPath = $iconPath.Trim()
    if ($iconPath.StartsWith('"') -and $iconPath.EndsWith('"')) {
      $iconPath = $iconPath.Substring(1, $iconPath.Length - 2)
    }
    $iconPath = [Environment]::ExpandEnvironmentVariables($iconPath)
    if (-not $iconPath -or -not (Test-Path -LiteralPath $iconPath)) {
      $iconPath = $targetPath
    }
    if (-not $iconPath -or -not (Test-Path -LiteralPath $iconPath)) {
      $iconPath = $FallbackIcon
    }
    if ($iconPath -and (Test-Path -LiteralPath $iconPath)) {
      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath)
      if ($icon) {
        return $icon.ToBitmap()
      }
    }
  } catch {
    return $null
  }
  return $null
}

function Parse-ShortcutTargetFromArgs {
  param([string]$Arguments)
  if (-not $Arguments) { return $null }
  $match = [System.Text.RegularExpressions.Regex]::Match($Arguments, '-Target\s+"([^"]+)"')
  if ($match.Success -and $match.Groups.Count -gt 1) {
    return [string]$match.Groups[1].Value
  }
  return $null
}

function Get-LaunchpadShortcutMetadata {
  param([string]$ShortcutPath)
  try {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    $targetExe = if ($sc -and $sc.TargetPath) { [string]$sc.TargetPath } else { "" }
    $args = if ($sc -and $sc.Arguments) { [string]$sc.Arguments } else { "" }
    $desc = if ($sc -and $sc.Description) { [string]$sc.Description } else { "" }
    $parsedTarget = Parse-ShortcutTargetFromArgs -Arguments $args
    $expandedTarget = if ($parsedTarget) { [Environment]::ExpandEnvironmentVariables($parsedTarget) } else { "" }
    $targetCanonical = ""
    if ($expandedTarget -and (Test-Path -LiteralPath $expandedTarget)) {
      $targetCanonical = [System.IO.Path]::GetFullPath($expandedTarget)
    }
    $exeName = [System.IO.Path]::GetFileName($targetExe).ToLowerInvariant()
    $isTrusted = $false
    if (
      ($exeName -eq "powershell.exe" -or $exeName -eq "pwsh.exe") -and
      $desc -eq "WeftEnd Launchpad Shortcut v1" -and
      $args -match "weftend_safe_run\.ps1" -and
      $args -match "(^|\s)-LaunchpadMode(\s|$)" -and
      $args -match "(^|\s)-AllowLaunch(\s|$)" -and
      $args -match "(^|\s)-Open\s+0(\s|$)" -and
      -not ($args -match "(^|\s)-OpenLibrary(\s|$)") -and
      $targetCanonical
    ) {
      $isTrusted = $true
    }
    return @{
      trusted = $isTrusted
      arguments = $args
      description = $desc
    }
  } catch {
    return @{
      trusted = $false
      arguments = ""
      description = ""
    }
  }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$colorBg = [System.Drawing.Color]::FromArgb(26, 27, 31)
$colorPanel = [System.Drawing.Color]::FromArgb(34, 36, 41)
$colorHeader = [System.Drawing.Color]::FromArgb(20, 21, 24)
$colorText = [System.Drawing.Color]::FromArgb(235, 237, 242)
$colorMuted = [System.Drawing.Color]::FromArgb(170, 174, 186)
$colorBorder = [System.Drawing.Color]::FromArgb(56, 59, 68)
$colorAccent = [System.Drawing.Color]::FromArgb(56, 94, 217)
$colorAccentHover = [System.Drawing.Color]::FromArgb(66, 108, 235)
$colorRowHover = [System.Drawing.Color]::FromArgb(42, 44, 50)
$colorButtonAlt = [System.Drawing.Color]::FromArgb(42, 44, 50)
$colorButtonAltHover = [System.Drawing.Color]::FromArgb(52, 55, 64)
$fontMain = New-Object System.Drawing.Font "Segoe UI", 9
$fontTitle = New-Object System.Drawing.Font "Segoe UI Semibold", 10
$fontSmall = New-Object System.Drawing.Font "Segoe UI", 8

function Style-Button {
  param(
    [System.Windows.Forms.Button]$Button,
    [bool]$Primary = $false
  )
  if (-not $Button) { return }
  $Button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $Button.FlatAppearance.BorderSize = 0
  $Button.ForeColor = $colorText
  $Button.Font = $fontMain
  $Button.Cursor = [System.Windows.Forms.Cursors]::Hand
  if ($Primary) {
    $Button.BackColor = $colorAccent
    $Button.FlatAppearance.MouseOverBackColor = $colorAccentHover
    $Button.FlatAppearance.MouseDownBackColor = $colorAccentHover
  } else {
    $Button.BackColor = $colorButtonAlt
    $Button.FlatAppearance.MouseOverBackColor = $colorButtonAltHover
    $Button.FlatAppearance.MouseDownBackColor = $colorButtonAltHover
  }
}

$configPath = "HKCU:\Software\WeftEnd\Shell"
$outRoot = Read-RegistryValue -Path $configPath -Name "OutRoot"
if (-not $outRoot -or $outRoot.Trim() -eq "") {
  if ($env:LOCALAPPDATA) {
    $outRoot = Join-Path $env:LOCALAPPDATA "WeftEnd"
  }
}
$libraryRoot = Resolve-LibraryRoot -Base $outRoot
if (-not $libraryRoot -or $libraryRoot.Trim() -eq "") {
  $libraryRoot = Join-Path $env:LOCALAPPDATA "WeftEnd\Library"
}

$launchpadRoot = Join-Path $libraryRoot "Launchpad"
$targetsDir = Join-Path $launchpadRoot "Targets"
New-Item -ItemType Directory -Force -Path $targetsDir | Out-Null
New-Item -ItemType Directory -Force -Path $launchpadRoot | Out-Null

$repoRoot = Get-RepoRoot
$weftendIcon = if ($repoRoot) { Join-Path $repoRoot "assets\weftend_logo.ico" } else { $null }
if (-not $weftendIcon -or -not (Test-Path -LiteralPath $weftendIcon)) {
  $weftendIcon = $null
}

$nodeCmd = Read-RegistryValue -Path $configPath -Name "NodeExe"
$programFiles = [Environment]::GetFolderPath("ProgramFiles")
$programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$repoNodePath = if ($repoRoot) { Join-Path $repoRoot "runtime\node\node.exe" } else { $null }
$nodePath = Resolve-ExecutablePath -Preferred $nodeCmd -CommandName "node" -Fallbacks @(
  $repoNodePath,
  (Join-Path $programFiles "nodejs\node.exe"),
  (Join-Path $programFilesX86 "nodejs\node.exe"),
  (Join-Path $localAppData "Programs\nodejs\node.exe")
)
$mainJs = if ($repoRoot) { Join-Path $repoRoot "dist\src\cli\main.js" } else { $null }
$shellDoctorScript = if ($repoRoot) { Join-Path $repoRoot "tools\windows\shell\weftend_shell_doctor.ps1" } else { $null }
$reportViewerScript = if ($repoRoot) { Join-Path $repoRoot "tools\windows\shell\report_card_viewer.ps1" } else { $null }
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powershellExe)) { $powershellExe = "powershell.exe" }

function Invoke-LaunchpadSync {
  param([switch]$Silent)
  if (-not $nodePath -or -not $mainJs -or -not (Test-Path -LiteralPath $mainJs)) {
    if (-not $Silent.IsPresent) {
      [System.Windows.Forms.MessageBox]::Show(
        "Launchpad sync requires CLI runtime. Run npm run compile (source clone) or use the portable release bundle.",
        "WeftEnd",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
      ) | Out-Null
    }
    return @{
      ok = $false
      code = "LAUNCHPAD_RUNTIME_MISSING"
      scanned = 0
      added = 0
      removed = 0
      failed = 0
    }
  }
  try {
    $args = @($mainJs, "launchpad", "sync", "--allow-launch", "--open-run")
    $syncOutputRaw = & $nodePath @args 2>&1
    $syncOutput = [string]($syncOutputRaw | Out-String)
    if (-not $syncOutput) { $syncOutput = "" }
    $exitCode = [int]$LASTEXITCODE
    $diagPath = Join-Path $launchpadRoot "sync_last.txt"
    $flatOutput = ($syncOutput -replace "`r","" -replace "`n"," | ")
    if (-not $flatOutput) { $flatOutput = "" }
    $diagLines = @(
      "exitCode=$exitCode",
      "output=" + $flatOutput.Trim()
    )
    $diagLines -join "`n" | Set-Content -Path $diagPath -Encoding UTF8
    if ($exitCode -ne 0) {
      $reason = "UNKNOWN"
      $bracket = [System.Text.RegularExpressions.Regex]::Match($syncOutput, "\[([A-Z0-9_]+)\]")
      if ($bracket.Success -and $bracket.Groups.Count -gt 1) {
        $reason = [string]$bracket.Groups[1].Value
      }
      if (-not $Silent.IsPresent) {
        [System.Windows.Forms.MessageBox]::Show(
          ("Launchpad sync failed (" + $reason + ").`nOpen Targets and remove broken entries, then Sync again."),
          "WeftEnd",
          [System.Windows.Forms.MessageBoxButtons]::OK,
          [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
      }
      return @{
        ok = $false
        code = $reason
        scanned = 0
        added = 0
        removed = 0
        failed = 0
      }
    }
    $scan = 0
    $added = 0
    $removed = 0
    $failed = 0
    $mScan = [regex]::Match($syncOutput, "scanned=([0-9]+)")
    if ($mScan.Success) { $scan = [int]$mScan.Groups[1].Value }
    $mAdded = [regex]::Match($syncOutput, "added=([0-9]+)")
    if ($mAdded.Success) { $added = [int]$mAdded.Groups[1].Value }
    $mRemoved = [regex]::Match($syncOutput, "removed=([0-9]+)")
    if ($mRemoved.Success) { $removed = [int]$mRemoved.Groups[1].Value }
    $mFailed = [regex]::Match($syncOutput, "failed=([0-9]+)")
    if ($mFailed.Success) { $failed = [int]$mFailed.Groups[1].Value }
    return @{
      ok = $true
      code = "OK"
      scanned = $scan
      added = $added
      removed = $removed
      failed = $failed
    }
  } catch {
    try {
      $diagPath = Join-Path $launchpadRoot "sync_last.txt"
      $exMsg = [string]$_.Exception.Message
      $diag = @(
        "exitCode=1",
        "exception=LAUNCHPAD_SYNC_EXCEPTION",
        "message=" + $exMsg
      )
      $diag -join "`n" | Set-Content -Path $diagPath -Encoding UTF8
    } catch {
      # ignore diagnostic-write failures
    }
    if (-not $Silent.IsPresent) {
      [System.Windows.Forms.MessageBox]::Show(
        "Launchpad sync failed (LAUNCHPAD_SYNC_EXCEPTION). Check Launchpad/sync_last.txt for details.",
        "WeftEnd",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
    }
    return @{
      ok = $false
      code = "LAUNCHPAD_SYNC_EXCEPTION"
      scanned = 0
      added = 0
      removed = 0
      failed = 0
    }
  }
}

function Invoke-AdapterDoctorText {
  param([switch]$Strict)
  if (-not $nodePath -or -not $mainJs -or -not (Test-Path -LiteralPath $mainJs)) {
    return @{
      ok = $false
      code = "LAUNCHPAD_RUNTIME_MISSING"
      exitCode = 40
      output = "Launchpad runtime missing."
    }
  }
  try {
    $args = @($mainJs, "adapter", "doctor", "--text")
    if ($Strict.IsPresent) {
      $args += "--strict"
    }
    $outputRaw = & $nodePath @args 2>&1
    $outputText = [string]($outputRaw | Out-String)
    if (-not $outputText) { $outputText = "" }
    $exitCode = [int]$LASTEXITCODE
    $ok = ($exitCode -eq 0)
    $code = if ($ok) { "OK" } else { "ADAPTER_DOCTOR_FAILED" }
    return @{
      ok = $ok
      code = $code
      exitCode = $exitCode
      output = $outputText.TrimEnd()
    }
  } catch {
    return @{
      ok = $false
      code = "ADAPTER_DOCTOR_EXCEPTION"
      exitCode = 1
      output = [string]$_.Exception.Message
    }
  }
}

function Invoke-ShellDoctorText {
  if (-not $shellDoctorScript -or -not (Test-Path -LiteralPath $shellDoctorScript)) {
    return @{
      ok = $false
      code = "SHELL_DOCTOR_SCRIPT_MISSING"
      exitCode = 40
      output = "Shell doctor script missing."
    }
  }
  try {
    $outputRaw = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $shellDoctorScript 2>&1)
    $outputText = [string](($outputRaw | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    if (-not $outputText) { $outputText = "" }
    $exitCode = [int]$LASTEXITCODE
    $ok = ($exitCode -eq 0)
    $code = if ($ok) { "OK" } else { "SHELL_DOCTOR_FAILED" }
    return @{
      ok = $ok
      code = $code
      exitCode = $exitCode
      output = $outputText.TrimEnd()
    }
  } catch {
    return @{
      ok = $false
      code = "SHELL_DOCTOR_EXCEPTION"
      exitCode = 1
      output = [string]$_.Exception.Message
    }
  }
}

function Load-Shortcuts {
  param([System.Windows.Forms.FlowLayoutPanel]$Panel)
  $Panel.Controls.Clear()

  $files = @(Get-ChildItem -LiteralPath $launchpadRoot -Filter "*.lnk" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "* (WeftEnd).lnk" } | Sort-Object Name)
  $trustedFiles = @()
  foreach ($f in $files) {
    $meta = Get-LaunchpadShortcutMetadata -ShortcutPath $f.FullName
    if ($meta.trusted) {
      $trustedFiles += $f
    }
  }
  $files = $trustedFiles
  if (-not $files -or $files.Count -eq 0) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "No trusted Launchpad shortcuts yet. Drop items into Targets and click Sync."
    $label.AutoSize = $true
    $label.Margin = New-Object System.Windows.Forms.Padding 8
    $label.ForeColor = $colorMuted
    $label.Font = $fontMain
    $Panel.Controls.Add($label) | Out-Null
    return
  }

  foreach ($file in $files) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $name = $name.Replace(" (WeftEnd)", "")
    $row = New-Object System.Windows.Forms.Panel
    $row.Width = 370
    $row.Height = 58
    $row.Margin = New-Object System.Windows.Forms.Padding 6
    $row.BackColor = $colorPanel
    $row.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $row.Tag = $file.FullName
    $row.Cursor = [System.Windows.Forms.Cursors]::Hand

    $iconBox = New-Object System.Windows.Forms.PictureBox
    $iconBox.Width = 34
    $iconBox.Height = 34
    $iconBox.Location = New-Object System.Drawing.Point 10,11
    $iconBox.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $iconBox.Tag = $file.FullName

    $label = New-Object System.Windows.Forms.Label
    $label.AutoSize = $false
    $label.Width = 305
    $label.Height = 58
    $label.Location = New-Object System.Drawing.Point 58,0
    $label.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $label.ForeColor = $colorText
    $label.Font = $fontMain
    $label.Text = $name
    $label.Tag = $file.FullName

    $iconImg = Get-IconImage -ShortcutPath $file.FullName -FallbackIcon $weftendIcon
    if ($iconImg) {
      try {
        $scaled = New-Object System.Drawing.Bitmap $iconImg, 32, 32
        $iconBox.Image = $scaled
      } catch {
        $iconBox.Image = $iconImg
      }
    }

    $handler = {
      $lnk = $this.Tag
      $meta = Get-LaunchpadShortcutMetadata -ShortcutPath $lnk
      if (
        $lnk -and
        (Test-Path -LiteralPath $lnk) -and
        $lnk.ToLowerInvariant().StartsWith($launchpadRoot.ToLowerInvariant()) -and
        $lnk.ToLowerInvariant().EndsWith(" (weftend).lnk") -and
        $meta.trusted
      ) {
        Start-Process -FilePath $lnk | Out-Null
      }
    }
    $row.Add_Click($handler)
    $iconBox.Add_Click($handler)
    $label.Add_Click($handler)
    $row.Add_MouseEnter({ $this.BackColor = $colorRowHover })
    $row.Add_MouseLeave({ $this.BackColor = $colorPanel })
    $iconBox.Add_MouseEnter({
      if ($this.Parent) { $this.Parent.BackColor = $colorRowHover }
    })
    $iconBox.Add_MouseLeave({
      if ($this.Parent) { $this.Parent.BackColor = $colorPanel }
    })
    $label.Add_MouseEnter({
      if ($this.Parent) { $this.Parent.BackColor = $colorRowHover }
    })
    $label.Add_MouseLeave({
      if ($this.Parent) { $this.Parent.BackColor = $colorPanel }
    })

    $row.Controls.Add($iconBox) | Out-Null
    $row.Controls.Add($label) | Out-Null
    $Panel.Controls.Add($row) | Out-Null
  }

  return $files.Count
}

function Set-StatusLine {
  param(
    [System.Windows.Forms.Label]$StatusLabel,
    [string]$Message,
    [bool]$IsError
  )
  if (-not $StatusLabel) { return }
  $StatusLabel.Text = $Message
  if ($IsError) {
    $StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 186, 186)
  } else {
    $StatusLabel.ForeColor = $colorMuted
  }
}

function Get-ObjectProperty {
  param(
    [object]$ObjectValue,
    [string]$Name
  )
  if ($null -eq $ObjectValue -or -not $Name) { return $null }
  if ($ObjectValue -is [System.Collections.IDictionary]) {
    if ($ObjectValue.Contains($Name)) { return $ObjectValue[$Name] }
    return $null
  }
  try {
    $prop = $ObjectValue.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
  } catch {
    return $null
  }
  return $null
}

function Compute-FileSha256Digest {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return "-" }
  try {
    $hash = Get-FileHash -LiteralPath $PathValue -Algorithm SHA256 -ErrorAction Stop
    if (-not $hash -or -not $hash.Hash) { return "-" }
    return "sha256:" + ([string]$hash.Hash).ToLowerInvariant()
  } catch {
    return "-"
  }
}

function Format-ReasonPreview {
  param(
    [object]$ReasonCodes,
    [int]$MaxItems = 4
  )
  $codes = @()
  if ($ReasonCodes) {
    foreach ($rc in @($ReasonCodes)) {
      if ($null -eq $rc) { continue }
      $text = ([string]$rc).Trim()
      if ($text -eq "") { continue }
      $codes += $text
    }
  }
  if ($codes.Count -le 0) { return "-" }
  if ($MaxItems -lt 1) { $MaxItems = 1 }
  $take = [Math]::Min($codes.Count, $MaxItems)
  $shown = @()
  for ($i = 0; $i -lt $take; $i++) { $shown += $codes[$i] }
  $preview = ($shown -join ",")
  if ($codes.Count -gt $take) {
    $preview += ",+" + [string]($codes.Count - $take)
  }
  return $preview
}

function Read-RunEvidenceSnapshot {
  param(
    [string]$TargetDir,
    [string]$RunId
  )
  $out = @{
    runId = if ($RunId) { [string]$RunId } else { "-" }
    artifactFingerprint = "-"
    artifactDigest = "-"
    reportCardDigest = "-"
    safeReceiptDigest = "-"
    operatorReceiptDigest = "-"
    compareReceiptDigest = "-"
    compareReportDigest = "-"
  }
  if (-not $TargetDir -or -not $RunId -or $RunId -eq "-") { return $out }
  $runDir = Join-Path $TargetDir $RunId
  if (-not (Test-Path -LiteralPath $runDir)) { return $out }

  $reportJsonPath = Join-Path $runDir "report_card_v0.json"
  if (Test-Path -LiteralPath $reportJsonPath) {
    try {
      $reportObj = Get-Content -LiteralPath $reportJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $rid = [string](Get-ObjectProperty -ObjectValue $reportObj -Name "runId")
      $fp = [string](Get-ObjectProperty -ObjectValue $reportObj -Name "artifactFingerprint")
      $fd = [string](Get-ObjectProperty -ObjectValue $reportObj -Name "artifactDigest")
      if ($rid -and $rid.Trim() -ne "") { $out.runId = $rid }
      if ($fp -and $fp.Trim() -ne "") { $out.artifactFingerprint = $fp }
      if ($fd -and $fd.Trim() -ne "") { $out.artifactDigest = $fd }
    } catch {
      # best effort only
    }
  }

  if ($out.artifactFingerprint -eq "-" -or $out.artifactDigest -eq "-") {
    $reportTxtPath = Join-Path $runDir "report_card.txt"
    if (Test-Path -LiteralPath $reportTxtPath) {
      try {
        $lines = @(Get-Content -LiteralPath $reportTxtPath -Encoding UTF8)
        foreach ($lineObj in $lines) {
          $line = [string]$lineObj
          if ($out.artifactFingerprint -eq "-" -and $line.StartsWith("artifactFingerprint=")) {
            $value = $line.Substring("artifactFingerprint=".Length).Trim()
            if ($value -ne "") { $out.artifactFingerprint = $value }
          } elseif ($out.artifactDigest -eq "-" -and $line.StartsWith("artifactDigest=")) {
            $value = $line.Substring("artifactDigest=".Length).Trim()
            if ($value -ne "") { $out.artifactDigest = $value }
          } elseif ($out.runId -eq "-" -and $line.StartsWith("runId=")) {
            $value = $line.Substring("runId=".Length).Trim()
            if ($value -ne "") { $out.runId = $value }
          }
        }
      } catch {
        # best effort only
      }
    }
  }

  $safeReceiptPath = Join-Path $runDir "safe_run_receipt.json"
  $operatorReceiptPath = Join-Path $runDir "operator_receipt.json"
  $compareReceiptPath = Join-Path $runDir "compare_receipt.json"
  $compareReportPath = Join-Path $runDir "compare_report.txt"
  $reportCardJsonPath = Join-Path $runDir "report_card_v0.json"
  $reportCardTxtPath = Join-Path $runDir "report_card.txt"
  if (Test-Path -LiteralPath $reportCardJsonPath) {
    $out.reportCardDigest = Compute-FileSha256Digest -PathValue $reportCardJsonPath
  } else {
    $out.reportCardDigest = Compute-FileSha256Digest -PathValue $reportCardTxtPath
  }
  $out.safeReceiptDigest = Compute-FileSha256Digest -PathValue $safeReceiptPath
  $out.operatorReceiptDigest = Compute-FileSha256Digest -PathValue $operatorReceiptPath
  $out.compareReceiptDigest = Compute-FileSha256Digest -PathValue $compareReceiptPath
  $out.compareReportDigest = Compute-FileSha256Digest -PathValue $compareReportPath
  return $out
}

function Read-AdapterTagForRun {
  param(
    [string]$TargetDir,
    [string]$RunId
  )
  if (-not $TargetDir -or -not $RunId -or $RunId -eq "-") { return "-" }
  $safePath = Join-Path (Join-Path $TargetDir $RunId) "safe_run_receipt.json"
  if (-not (Test-Path -LiteralPath $safePath)) { return "-" }
  try {
    $safe = Get-Content -LiteralPath $safePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $adapterObj = Get-ObjectProperty -ObjectValue $safe -Name "adapter"
    $adapterId = if ($adapterObj) { [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "adapterId") } else { "" }
    $mode = if ($adapterObj) { [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "mode") } else { "" }
    $adapterClass = "-"
    if ($adapterId -match "^([a-z0-9_]+)_adapter_v[0-9]+$") {
      $adapterClass = [string]$matches[1]
    } elseif ($adapterId.ToLowerInvariant() -eq "docker.local.inspect.v0") {
      $adapterClass = "container"
    } else {
      $contentSummary = Get-ObjectProperty -ObjectValue $safe -Name "contentSummary"
      $adapterSignals = if ($contentSummary) { Get-ObjectProperty -ObjectValue $contentSummary -Name "adapterSignals" } else { $null }
      $adapterSignalClass = if ($adapterSignals) { [string](Get-ObjectProperty -ObjectValue $adapterSignals -Name "class") } else { "" }
      if ($adapterSignalClass -and $adapterSignalClass.Trim() -ne "") {
        $adapterClass = $adapterSignalClass
      }
    }
    $artifactKind = [string](Get-ObjectProperty -ObjectValue $safe -Name "artifactKind")
    if (($adapterClass -eq "-" -or -not $adapterClass) -and $artifactKind -eq "CONTAINER_IMAGE") {
      $adapterClass = "container"
    }
    if (-not $adapterClass -or $adapterClass -eq "-") { return "-" }
    $tag = $adapterClass
    if ($mode -and $mode.ToLowerInvariant() -eq "plugin") {
      $tag = $tag + "+plugin"
    }
    $capPath = Join-Path (Join-Path (Join-Path $TargetDir $RunId) "analysis") "capability_ledger_v0.json"
    if (Test-Path -LiteralPath $capPath) {
      try {
        $cap = Get-Content -LiteralPath $capPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $denied = if ($cap.deniedCaps -is [System.Array]) { [int]$cap.deniedCaps.Count } else { 0 }
        if ($denied -gt 0) { $tag = $tag + " !" }
      } catch {
        # best effort
      }
    }
    return $tag
  } catch {
    return "-"
  }
}

function Read-AdapterEvidenceForRun {
  param(
    [string]$TargetDir,
    [string]$RunId
  )
  $out = @{
    available = $false
    adapterTag = "-"
    adapterClass = "-"
    adapterId = "-"
    adapterMode = "-"
    sourceFormat = "-"
    reasons = "-"
    requested = 0
    granted = 0
    denied = 0
  }
  if (-not $TargetDir -or -not $RunId -or $RunId -eq "-") { return $out }
  $runDir = Join-Path $TargetDir $RunId
  if (-not (Test-Path -LiteralPath $runDir)) { return $out }

  $reportPath = Join-Path $runDir "report_card_v0.json"
  if (Test-Path -LiteralPath $reportPath) {
    try {
      $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $adapterObj = Get-ObjectProperty -ObjectValue $report -Name "adapter"
      if ($adapterObj) {
        $class = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "class")
        $id = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "adapterId")
        $mode = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "mode")
        $source = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "sourceFormat")
        $reasons = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "reasons")
        if ($class) { $out.adapterClass = $class }
        if ($id) { $out.adapterId = $id }
        if ($mode) { $out.adapterMode = $mode }
        if ($source) { $out.sourceFormat = $source }
        if ($reasons) { $out.reasons = $reasons }
        $cap = Get-ObjectProperty -ObjectValue $adapterObj -Name "capabilities"
        if ($cap) {
          $out.requested = [int](Get-ObjectProperty -ObjectValue $cap -Name "requested")
          $out.granted = [int](Get-ObjectProperty -ObjectValue $cap -Name "granted")
          $out.denied = [int](Get-ObjectProperty -ObjectValue $cap -Name "denied")
        }
      }
    } catch {
      # best effort
    }
  }

  if ($out.adapterId -eq "-" -or $out.adapterClass -eq "-") {
    $safePath = Join-Path $runDir "safe_run_receipt.json"
    if (Test-Path -LiteralPath $safePath) {
      try {
        $safe = Get-Content -LiteralPath $safePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $adapterObj = Get-ObjectProperty -ObjectValue $safe -Name "adapter"
        if ($adapterObj) {
          $id = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "adapterId")
          $mode = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "mode")
          $source = [string](Get-ObjectProperty -ObjectValue $adapterObj -Name "sourceFormat")
          if ($id -and $out.adapterId -eq "-") { $out.adapterId = $id }
          if ($mode -and $out.adapterMode -eq "-") { $out.adapterMode = $mode }
          if ($source -and $out.sourceFormat -eq "-") { $out.sourceFormat = $source }
          if ($out.reasons -eq "-") {
            $out.reasons = Format-ReasonPreview -ReasonCodes (Get-ObjectProperty -ObjectValue $adapterObj -Name "reasonCodes") -MaxItems 4
          }
        }
        if ($out.adapterClass -eq "-") {
          if ($out.adapterId -match "^([a-z0-9_]+)_adapter_v[0-9]+$") {
            $out.adapterClass = [string]$matches[1]
          } elseif ($out.adapterId.ToLowerInvariant() -eq "docker.local.inspect.v0") {
            $out.adapterClass = "container"
          } else {
            $contentSummary = Get-ObjectProperty -ObjectValue $safe -Name "contentSummary"
            $signals = if ($contentSummary) { Get-ObjectProperty -ObjectValue $contentSummary -Name "adapterSignals" } else { $null }
            $signalClass = if ($signals) { [string](Get-ObjectProperty -ObjectValue $signals -Name "class") } else { "" }
            if ($signalClass -and $signalClass.Trim() -ne "") { $out.adapterClass = $signalClass }
          }
        }
      } catch {
        # best effort
      }
    }
  }

  $capPath = Join-Path (Join-Path $runDir "analysis") "capability_ledger_v0.json"
  if (Test-Path -LiteralPath $capPath) {
    try {
      $cap = Get-Content -LiteralPath $capPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $req = Get-ObjectProperty -ObjectValue $cap -Name "requestedCaps"
      $gr = Get-ObjectProperty -ObjectValue $cap -Name "grantedCaps"
      $den = Get-ObjectProperty -ObjectValue $cap -Name "deniedCaps"
      $out.requested = @($req).Count
      $out.granted = @($gr).Count
      $out.denied = @($den).Count
    } catch {
      # best effort
    }
  }

  $out.adapterTag = Read-AdapterTagForRun -TargetDir $TargetDir -RunId $RunId
  if (
    ($out.adapterTag -and $out.adapterTag -ne "-") -or
    ($out.adapterClass -and $out.adapterClass -ne "-") -or
    ($out.requested -gt 0) -or
    ($out.granted -gt 0) -or
    ($out.denied -gt 0)
  ) {
    $out.available = $true
  }
  return $out
}

function Get-LatestRunIdForTargetDir {
  param([string]$TargetDir)
  if (-not $TargetDir -or -not (Test-Path -LiteralPath $TargetDir)) { return "-" }
  try {
    $runs = @(
      Get-ChildItem -LiteralPath $TargetDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "run_*" } |
        ForEach-Object { [string]$_.Name }
    )
    if (-not $runs -or $runs.Count -le 0) { return "-" }
    [System.Array]::Sort($runs, [System.StringComparer]::Ordinal)
    return [string]$runs[$runs.Count - 1]
  } catch {
    return "-"
  }
}

function Read-ReportCardSummaryForRun {
  param(
    [string]$TargetDir,
    [string]$RunId
  )
  $out = @{
    status = "UNKNOWN"
    baseline = "-"
    buckets = "-"
  }
  if (-not $TargetDir -or -not $RunId -or $RunId -eq "-") { return $out }
  $runDir = Join-Path $TargetDir $RunId
  if (-not (Test-Path -LiteralPath $runDir)) { return $out }

  $jsonPath = Join-Path $runDir "report_card_v0.json"
  if (Test-Path -LiteralPath $jsonPath) {
    try {
      $obj = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $status = [string](Get-ObjectProperty -ObjectValue $obj -Name "status")
      $baseline = [string](Get-ObjectProperty -ObjectValue $obj -Name "baseline")
      $buckets = [string](Get-ObjectProperty -ObjectValue $obj -Name "buckets")
      if ($status -and $status.Trim() -ne "") { $out.status = $status }
      if ($baseline -and $baseline.Trim() -ne "") { $out.baseline = $baseline }
      if ($buckets -and $buckets.Trim() -ne "") { $out.buckets = $buckets }
      return $out
    } catch {
      # best effort only
    }
  }

  $txtPath = Join-Path $runDir "report_card.txt"
  if (Test-Path -LiteralPath $txtPath) {
    try {
      $lines = @(Get-Content -LiteralPath $txtPath -Encoding UTF8)
      foreach ($lineObj in $lines) {
        $line = [string]$lineObj
        if ($line.StartsWith("STATUS:")) {
          $m = [System.Text.RegularExpressions.Regex]::Match($line, "STATUS:\s*([A-Z_]+)")
          if ($m.Success -and $m.Groups.Count -gt 1) { $out.status = [string]$m.Groups[1].Value }
        } elseif ($line.StartsWith("BASELINE:")) {
          $value = $line.Substring("BASELINE:".Length).Trim()
          if ($value -ne "") { $out.baseline = $value }
        } elseif ($line.StartsWith("BUCKETS:")) {
          $value = $line.Substring("BUCKETS:".Length).Trim()
          if ($value -ne "") { $out.buckets = $value }
        }
      }
    } catch {
      # best effort only
    }
  }
  return $out
}

function Read-ViewStateSummary {
  param([string]$TargetDir)
  $viewPath = Join-Path $TargetDir "view\view_state.json"
  if (-not (Test-Path -LiteralPath $viewPath)) {
    $latestFallback = Get-LatestRunIdForTargetDir -TargetDir $TargetDir
    $reportFallback = Read-ReportCardSummaryForRun -TargetDir $TargetDir -RunId $latestFallback
    return @{
      status = $reportFallback.status
      baseline = $reportFallback.baseline
      latest = $latestFallback
      buckets = $reportFallback.buckets
      adapter = (Read-AdapterTagForRun -TargetDir $TargetDir -RunId $latestFallback)
    }
  }
  try {
    $obj = Get-Content -LiteralPath $viewPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $status = "UNKNOWN"
    $baseline = if ($obj.baselineRunId) { [string]$obj.baselineRunId } else { "-" }
    $latest = if ($obj.latestRunId) { [string]$obj.latestRunId } else { "-" }
    $buckets = "-"

    if ($obj.blocked -and $obj.blocked.runId) {
      $status = "BLOCKED"
    }

    $lastN = @()
    if ($obj.lastN -is [System.Array]) {
      $lastN = @($obj.lastN | ForEach-Object { [string]$_ })
    }
    $keys = @()
    if ($obj.keys -is [System.Array]) {
      $keys = @($obj.keys)
    }

    if ($latest -ne "-" -and $lastN.Count -gt 0 -and $keys.Count -gt 0) {
      $latestIdx = $lastN.IndexOf($latest)
      if ($latestIdx -ge 0 -and $latestIdx -lt $keys.Count) {
        $k = $keys[$latestIdx]
        if ($k -and $k.verdictVsBaseline) {
          $status = [string]$k.verdictVsBaseline
        }
        if ($k -and $k.buckets -is [System.Array] -and $k.buckets.Count -gt 0) {
          $buckets = (($k.buckets | ForEach-Object { [string]$_ }) -join ",")
        }
      }
    } elseif ($obj.lastCompare -and $obj.lastCompare.verdict) {
      # Backward compatibility for older view-state snapshots.
      $status = [string]$obj.lastCompare.verdict
      if ($obj.lastCompare.buckets -is [System.Array] -and $obj.lastCompare.buckets.Count -gt 0) {
        $buckets = (($obj.lastCompare.buckets | ForEach-Object { [string]$_ }) -join ",")
      }
    }

    if (-not $latest -or $latest -eq "-") {
      $latest = Get-LatestRunIdForTargetDir -TargetDir $TargetDir
    }
    if ($latest -and $latest -ne "-" -and ($status -eq "UNKNOWN" -or $buckets -eq "-" -or $baseline -eq "-")) {
      $reportFallback = Read-ReportCardSummaryForRun -TargetDir $TargetDir -RunId $latest
      if ($status -eq "UNKNOWN" -and $reportFallback.status -and $reportFallback.status -ne "UNKNOWN") {
        $status = [string]$reportFallback.status
      }
      if ($baseline -eq "-" -and $reportFallback.baseline -and $reportFallback.baseline -ne "-") {
        $baseline = [string]$reportFallback.baseline
      }
      if ($buckets -eq "-" -and $reportFallback.buckets -and $reportFallback.buckets -ne "-") {
        $buckets = [string]$reportFallback.buckets
      }
    }
    return @{
      status = $status
      baseline = $baseline
      latest = $latest
      buckets = $buckets
      adapter = (Read-AdapterTagForRun -TargetDir $TargetDir -RunId $latest)
    }
  } catch {
    $latestFallback = Get-LatestRunIdForTargetDir -TargetDir $TargetDir
    $reportFallback = Read-ReportCardSummaryForRun -TargetDir $TargetDir -RunId $latestFallback
    return @{
      status = $reportFallback.status
      baseline = $reportFallback.baseline
      latest = $latestFallback
      buckets = $reportFallback.buckets
      adapter = (Read-AdapterTagForRun -TargetDir $TargetDir -RunId $latestFallback)
    }
  }
}

function Update-HistoryDetailsBox {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.TextBox]$DetailBox
  )
  if (-not $DetailBox) { return }
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    $DetailBox.Text = "Select a history row to view adapter evidence and capability summary."
    return
  }
  $selected = $ListView.SelectedItems[0]
  $meta = $selected.Tag
  $targetDir = if ($meta -and $meta.targetDir) { [string]$meta.targetDir } else { "" }
  $targetKey = if ($meta -and $meta.targetKey) { [string]$meta.targetKey } else { [string]$selected.Text }
  $latestRun = if ($meta -and $meta.latestRun) { [string]$meta.latestRun } else { "-" }
  if ($latestRun -eq "-" -and $targetDir) {
    $latestRun = Get-LatestRunIdForTargetDir -TargetDir $targetDir
  }
  $status = if ($selected.SubItems.Count -gt 1) { [string]$selected.SubItems[1].Text } else { "UNKNOWN" }
  $adapterTag = if ($selected.SubItems.Count -gt 2) { [string]$selected.SubItems[2].Text } else { "-" }
  $baseline = if ($selected.SubItems.Count -gt 3) { [string]$selected.SubItems[3].Text } else { "-" }
  $buckets = if ($selected.SubItems.Count -gt 5) { [string]$selected.SubItems[5].Text } else { "-" }

  $lines = @(
    "Target: " + $targetKey,
    "Status: " + $status,
    "Adapter Tag: " + $adapterTag,
    "Baseline: " + $baseline,
    "Latest: " + $latestRun,
    "Buckets: " + $buckets
  )

  if ($targetDir -and $latestRun -and $latestRun -ne "-") {
    $snapshot = Read-RunEvidenceSnapshot -TargetDir $targetDir -RunId $latestRun
    $lines += ""
    $lines += "RunId: " + [string]$snapshot.runId
    $lines += "Artifact Fingerprint: " + [string]$snapshot.artifactFingerprint
    $lines += "Artifact Digest: " + [string]$snapshot.artifactDigest
    $lines += "Report Card Digest: " + [string]$snapshot.reportCardDigest
    $lines += "Safe Receipt Digest: " + [string]$snapshot.safeReceiptDigest
    $lines += "Operator Receipt Digest: " + [string]$snapshot.operatorReceiptDigest
    $lines += "Compare Receipt Digest: " + [string]$snapshot.compareReceiptDigest
    $lines += "Compare Report Digest: " + [string]$snapshot.compareReportDigest

    $ev = Read-AdapterEvidenceForRun -TargetDir $targetDir -RunId $latestRun
    if ($ev.available) {
      $lines += ""
      $lines += "Adapter Class: " + [string]$ev.adapterClass
      $lines += "Adapter Id: " + [string]$ev.adapterId
      $lines += "Adapter Mode: " + [string]$ev.adapterMode
      $lines += "Source Format: " + [string]$ev.sourceFormat
      $lines += "Adapter Reasons: " + [string]$ev.reasons
      $lines += "Capabilities: requested=" + [string]$ev.requested + " granted=" + [string]$ev.granted + " denied=" + [string]$ev.denied
    } else {
      $lines += ""
      $lines += "Adapter evidence: none for latest run."
    }
  } else {
    $lines += ""
    $lines += "Adapter evidence: latest run not available."
  }

  $lines += ""
  $lines += "Tip: Use View Report for full run details."
  $DetailBox.Text = ($lines -join [Environment]::NewLine)
}

function Update-HistoryActionButtons {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Button]$RunButton,
    [System.Windows.Forms.Button]$EvidenceButton
  )
  if ($RunButton) { $RunButton.Enabled = $false }
  if ($EvidenceButton) { $EvidenceButton.Enabled = $false }
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) { return }
  $selected = $ListView.SelectedItems[0]
  $meta = $selected.Tag
  $targetDir = if ($meta -and $meta.targetDir) { [string]$meta.targetDir } else { "" }
  $latestRun = if ($meta -and $meta.latestRun) { [string]$meta.latestRun } else { "-" }
  if ($latestRun -eq "-" -and $targetDir) {
    $latestRun = Get-LatestRunIdForTargetDir -TargetDir $targetDir
  }
  if ($RunButton -and $targetDir -and (Test-Path -LiteralPath $targetDir)) {
    $RunButton.Enabled = $true
  }
  if ($EvidenceButton -and $targetDir -and $latestRun -and $latestRun -ne "-") {
    $analysisPath = Join-Path (Join-Path $targetDir $latestRun) "analysis"
    if (Test-Path -LiteralPath $analysisPath) {
      $EvidenceButton.Enabled = $true
    }
  }
}

function Copy-HistoryDetailsText {
  param(
    [System.Windows.Forms.TextBox]$DetailBox,
    [System.Windows.Forms.Label]$StatusLabel
  )
  try {
    $text = if ($DetailBox -and $DetailBox.Text) { [string]$DetailBox.Text } else { "" }
    if (-not $text -or $text.Trim() -eq "") {
      Set-StatusLine -StatusLabel $StatusLabel -Message "No history details to copy." -IsError $true
      return
    }
    [System.Windows.Forms.Clipboard]::SetText($text)
    Set-StatusLine -StatusLabel $StatusLabel -Message "Copied history details." -IsError $false
  } catch {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Copy failed." -IsError $true
  }
}

function Copy-HistoryDigestText {
  param(
    [System.Windows.Forms.TextBox]$DetailBox,
    [System.Windows.Forms.Label]$StatusLabel
  )
  try {
    $text = if ($DetailBox -and $DetailBox.Text) { [string]$DetailBox.Text } else { "" }
    if (-not $text -or $text.Trim() -eq "") {
      Set-StatusLine -StatusLabel $StatusLabel -Message "No history digest lines to copy." -IsError $true
      return
    }
    $wantedPrefixes = @(
      "RunId:",
      "Artifact Fingerprint:",
      "Artifact Digest:",
      "Report Card Digest:",
      "Safe Receipt Digest:",
      "Operator Receipt Digest:",
      "Compare Receipt Digest:",
      "Compare Report Digest:"
    )
    $digestLines = @()
    foreach ($lineObj in ($text -split "`r?`n")) {
      $line = [string]$lineObj
      foreach ($prefix in $wantedPrefixes) {
        if ($line.StartsWith($prefix)) {
          $digestLines += $line
          break
        }
      }
    }
    if ($digestLines.Count -le 0) {
      Set-StatusLine -StatusLabel $StatusLabel -Message "No history digest lines to copy." -IsError $true
      return
    }
    [System.Windows.Forms.Clipboard]::SetText(($digestLines -join [Environment]::NewLine))
    Set-StatusLine -StatusLabel $StatusLabel -Message "Copied history digests." -IsError $false
  } catch {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Digest copy failed." -IsError $true
  }
}

function Copy-DoctorOutputText {
  param(
    [System.Windows.Forms.TextBox]$DoctorBox,
    [System.Windows.Forms.Label]$StatusLabel
  )
  try {
    $text = if ($DoctorBox -and $DoctorBox.Text) { [string]$DoctorBox.Text } else { "" }
    if (-not $text -or $text.Trim() -eq "") {
      Set-StatusLine -StatusLabel $StatusLabel -Message "No doctor output to copy." -IsError $true
      return
    }
    [System.Windows.Forms.Clipboard]::SetText($text)
    Set-StatusLine -StatusLabel $StatusLabel -Message "Copied doctor output." -IsError $false
  } catch {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Doctor output copy failed." -IsError $true
  }
}

function Load-HistoryRows {
  param([System.Windows.Forms.ListView]$ListView)
  if (-not $ListView) { return 0 }
  $ListView.BeginUpdate()
  $ListView.Items.Clear()

  $dirs = @(
    Get-ChildItem -LiteralPath $libraryRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne "Launchpad" } |
      Sort-Object Name
  )
  foreach ($dir in $dirs) {
    $s = Read-ViewStateSummary -TargetDir $dir.FullName
    $item = New-Object System.Windows.Forms.ListViewItem($dir.Name)
    [void]$item.SubItems.Add($s.status)
    [void]$item.SubItems.Add($s.adapter)
    [void]$item.SubItems.Add($s.baseline)
    [void]$item.SubItems.Add($s.latest)
    [void]$item.SubItems.Add($s.buckets)
    $item.Tag = [PSCustomObject]@{
      targetDir = $dir.FullName
      targetKey = $dir.Name
      latestRun = $s.latest
    }
    [void]$ListView.Items.Add($item)
  }

  $ListView.EndUpdate()
  return $dirs.Count
}

function Open-ReportViewerFromHistory {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $meta = $selected.Tag
  $targetDir = if ($meta -and $meta.targetDir) { [string]$meta.targetDir } else { "" }
  $targetKey = if ($meta -and $meta.targetKey) { [string]$meta.targetKey } else { [string]$selected.Text }
  $latestRun = if ($meta -and $meta.latestRun) { [string]$meta.latestRun } else { "" }
  if (-not $latestRun -or $latestRun -eq "-") {
    $latestRun = Get-LatestRunIdForTargetDir -TargetDir $targetDir
  }
  if (-not $targetDir -or -not (Test-Path -LiteralPath $targetDir)) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Target history folder missing." -IsError $true
    return
  }
  if (-not $reportViewerScript -or -not (Test-Path -LiteralPath $reportViewerScript)) {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $targetDir | Out-Null
    Set-StatusLine -StatusLabel $StatusLabel -Message "Viewer missing. Opened target history folder." -IsError $true
    return
  }
  $runDir = if ($latestRun -and $latestRun -ne "-") { Join-Path $targetDir $latestRun } else { "" }
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $reportViewerScript)
  if ($runDir -and (Test-Path -LiteralPath $runDir)) {
    $args += @("-RunDir", $runDir)
  } else {
    $args += @("-TargetDir", $targetDir)
    if ($latestRun -and $latestRun -ne "-") {
      $args += @("-RunId", $latestRun)
    }
  }
  if ($targetKey -and $targetKey.Trim() -ne "") {
    $args += @("-LibraryKey", $targetKey)
  }
  try {
    $proc = Start-Process -FilePath $powershellExe -ArgumentList $args -WindowStyle Hidden -PassThru -ErrorAction Stop
    Start-Sleep -Milliseconds 350
    try { $proc.Refresh() } catch {}
    if ($proc -and $proc.HasExited -and [int]$proc.ExitCode -ne 0) {
      $explorerPath = Join-Path $env:WINDIR "explorer.exe"
      if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
      Start-Process -FilePath $explorerPath -ArgumentList $targetDir | Out-Null
      Set-StatusLine -StatusLabel $StatusLabel -Message "Viewer failed to start. Opened target history folder." -IsError $true
      return
    }
    $statusText = if ($latestRun -and $latestRun -ne "-") { "Opened report: " + $targetKey + " / " + $latestRun } else { "Opened report viewer: " + $targetKey }
    Set-StatusLine -StatusLabel $StatusLabel -Message $statusText -IsError $false
  } catch {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Failed to open report viewer." -IsError $true
  }
}

function Open-HistoryRunFolder {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $meta = $selected.Tag
  $targetDir = if ($meta -and $meta.targetDir) { [string]$meta.targetDir } else { "" }
  $latestRun = if ($meta -and $meta.latestRun) { [string]$meta.latestRun } else { "-" }
  $targetKey = if ($meta -and $meta.targetKey) { [string]$meta.targetKey } else { [string]$selected.Text }
  if ($latestRun -eq "-" -and $targetDir) {
    $latestRun = Get-LatestRunIdForTargetDir -TargetDir $targetDir
  }
  if (-not $targetDir -or -not (Test-Path -LiteralPath $targetDir)) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Target history folder missing." -IsError $true
    return
  }
  $openPath = if ($latestRun -and $latestRun -ne "-") { Join-Path $targetDir $latestRun } else { $targetDir }
  if (-not (Test-Path -LiteralPath $openPath)) { $openPath = $targetDir }
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $openPath | Out-Null
  Set-StatusLine -StatusLabel $StatusLabel -Message ("Opened run folder: " + $targetKey) -IsError $false
}

function Open-HistoryAdapterEvidenceFolder {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $meta = $selected.Tag
  $targetDir = if ($meta -and $meta.targetDir) { [string]$meta.targetDir } else { "" }
  $latestRun = if ($meta -and $meta.latestRun) { [string]$meta.latestRun } else { "-" }
  $targetKey = if ($meta -and $meta.targetKey) { [string]$meta.targetKey } else { [string]$selected.Text }
  if ($latestRun -eq "-" -and $targetDir) {
    $latestRun = Get-LatestRunIdForTargetDir -TargetDir $targetDir
  }
  if (-not $targetDir -or -not $latestRun -or $latestRun -eq "-") {
    Set-StatusLine -StatusLabel $StatusLabel -Message "No latest run available for adapter evidence." -IsError $true
    return
  }
  $analysisPath = Join-Path (Join-Path $targetDir $latestRun) "analysis"
  if (-not (Test-Path -LiteralPath $analysisPath)) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Adapter evidence folder missing for latest run." -IsError $true
    return
  }
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $analysisPath | Out-Null
  Set-StatusLine -StatusLabel $StatusLabel -Message ("Opened adapter evidence: " + $targetKey + " / " + $latestRun) -IsError $false
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "WeftEnd Launchpad v2"
$form.Width = 456
$form.Height = 680
$form.StartPosition = "CenterScreen"
$form.BackColor = $colorBg
$form.ForeColor = $colorText
$form.Font = $fontMain
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.FormBorderStyle = "FixedDialog"
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.MinimumSize = New-Object System.Drawing.Size(456, 680)
$form.MaximumSize = New-Object System.Drawing.Size(456, 680)
if ($TopMost.IsPresent) { $form.TopMost = $true }

$header = New-Object System.Windows.Forms.TableLayoutPanel
$header.Dock = "Top"
$header.Height = 78
$header.BackColor = $colorHeader
$header.ColumnCount = 1
$header.RowCount = 2
$header.Padding = New-Object System.Windows.Forms.Padding(12, 8, 12, 8)
$header.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
$header.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 24)))

$title = New-Object System.Windows.Forms.Label
$title.Text = "WeftEnd Launchpad v2"
$title.Dock = "Fill"
$title.Font = $fontTitle
$title.ForeColor = $colorText
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Tabbed operator launcher: gated scan then launch."
$subtitle.Dock = "Fill"
$subtitle.Font = $fontSmall
$subtitle.ForeColor = $colorMuted
$subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$header.Controls.Add($title, 0, 0)
$header.Controls.Add($subtitle, 0, 1)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = "Fill"
$tabs.Padding = New-Object System.Drawing.Point(14, 6)

$tabLaunch = New-Object System.Windows.Forms.TabPage("Launch")
$tabLibrary = New-Object System.Windows.Forms.TabPage("Library")
$tabHistory = New-Object System.Windows.Forms.TabPage("History")
$tabDoctor = New-Object System.Windows.Forms.TabPage("Doctor")
$tabSettings = New-Object System.Windows.Forms.TabPage("Settings")
foreach ($tp in @($tabLaunch, $tabLibrary, $tabHistory, $tabDoctor, $tabSettings)) {
  $tp.BackColor = $colorBg
  $tp.ForeColor = $colorText
  [void]$tabs.TabPages.Add($tp)
}

$launchLayout = New-Object System.Windows.Forms.TableLayoutPanel
$launchLayout.Dock = "Fill"
$launchLayout.ColumnCount = 1
$launchLayout.RowCount = 3
$launchLayout.Padding = New-Object System.Windows.Forms.Padding(6, 8, 6, 8)
$launchLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 42)))
$launchLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 34)))
$launchLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$tabLaunch.Controls.Add($launchLayout)

$launchActions = New-Object System.Windows.Forms.FlowLayoutPanel
$launchActions.Dock = "Fill"
$launchActions.FlowDirection = "LeftToRight"
$launchActions.WrapContents = $false
$launchActions.BackColor = $colorBg

$btnTargets = New-Object System.Windows.Forms.Button
$btnTargets.Text = "Open Targets"
$btnTargets.Width = 116
$btnTargets.Height = 30
Style-Button -Button $btnTargets -Primary:$false
$btnTargets.Add_Click({
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $targetsDir | Out-Null
})

$btnSync = New-Object System.Windows.Forms.Button
$btnSync.Text = "Sync"
$btnSync.Width = 74
$btnSync.Height = 30
Style-Button -Button $btnSync -Primary:$true

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = "Refresh"
$btnRefresh.Width = 80
$btnRefresh.Height = 30
Style-Button -Button $btnRefresh -Primary:$false

$launchActions.Controls.Add($btnTargets) | Out-Null
$launchActions.Controls.Add($btnSync) | Out-Null
$launchActions.Controls.Add($btnRefresh) | Out-Null

$launchHint = New-Object System.Windows.Forms.Label
$launchHint.Dock = "Fill"
$launchHint.ForeColor = $colorMuted
$launchHint.Font = $fontSmall
$launchHint.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$launchHint.Text = "Drop apps/files into Targets, click Sync, then launch here. Right-click Run with WeftEnd works immediately after install."

$listPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$listPanel.Dock = "Fill"
$listPanel.FlowDirection = "TopDown"
$listPanel.WrapContents = $false
$listPanel.AutoScroll = $true
$listPanel.BackColor = $colorBg
$listPanel.Padding = New-Object System.Windows.Forms.Padding(0, 2, 0, 0)

$launchLayout.Controls.Add($launchActions, 0, 0)
$launchLayout.Controls.Add($launchHint, 0, 1)
$launchLayout.Controls.Add($listPanel, 0, 2)

$libLayout = New-Object System.Windows.Forms.TableLayoutPanel
$libLayout.Dock = "Fill"
$libLayout.ColumnCount = 1
$libLayout.RowCount = 5
$libLayout.Padding = New-Object System.Windows.Forms.Padding(10)
$libLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 36)))
$libLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 36)))
$libLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 36)))
$libLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 36)))
$libLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$tabLibrary.Controls.Add($libLayout)

$btnOpenLibrary = New-Object System.Windows.Forms.Button
$btnOpenLibrary.Text = "Open Library Root"
$btnOpenLibrary.Height = 30
$btnOpenLibrary.Dock = "Fill"
Style-Button -Button $btnOpenLibrary -Primary:$false
$btnOpenLibrary.Add_Click({
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $libraryRoot | Out-Null
})

$btnOpenLaunchpad = New-Object System.Windows.Forms.Button
$btnOpenLaunchpad.Text = "Open Launchpad Folder"
$btnOpenLaunchpad.Height = 30
$btnOpenLaunchpad.Dock = "Fill"
Style-Button -Button $btnOpenLaunchpad -Primary:$false
$btnOpenLaunchpad.Add_Click({
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $launchpadRoot | Out-Null
})

$btnOpenTargets2 = New-Object System.Windows.Forms.Button
$btnOpenTargets2.Text = "Open Targets Folder"
$btnOpenTargets2.Height = 30
$btnOpenTargets2.Dock = "Fill"
Style-Button -Button $btnOpenTargets2 -Primary:$false
$btnOpenTargets2.Add_Click({
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $targetsDir | Out-Null
})

$btnSync2 = New-Object System.Windows.Forms.Button
$btnSync2.Text = "Sync Targets Now"
$btnSync2.Height = 30
$btnSync2.Dock = "Fill"
Style-Button -Button $btnSync2 -Primary:$true

$libHint = New-Object System.Windows.Forms.Label
$libHint.Text = "Use Launch for day-to-day starts. Library tab is for navigation."
$libHint.Dock = "Fill"
$libHint.ForeColor = $colorMuted
$libHint.Font = $fontSmall
$libHint.TextAlign = [System.Drawing.ContentAlignment]::TopLeft

$libLayout.Controls.Add($btnOpenLibrary, 0, 0)
$libLayout.Controls.Add($btnOpenLaunchpad, 0, 1)
$libLayout.Controls.Add($btnOpenTargets2, 0, 2)
$libLayout.Controls.Add($btnSync2, 0, 3)
$libLayout.Controls.Add($libHint, 0, 4)

$historyLayout = New-Object System.Windows.Forms.TableLayoutPanel
$historyLayout.Dock = "Fill"
$historyLayout.ColumnCount = 1
$historyLayout.RowCount = 3
$historyLayout.Padding = New-Object System.Windows.Forms.Padding(6, 8, 6, 8)
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 42)))
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 132)))
$tabHistory.Controls.Add($historyLayout)

$historyActions = New-Object System.Windows.Forms.FlowLayoutPanel
$historyActions.Dock = "Fill"
$historyActions.FlowDirection = "LeftToRight"
$historyActions.WrapContents = $false
$historyActions.BackColor = $colorBg

$btnHistoryRefresh = New-Object System.Windows.Forms.Button
$btnHistoryRefresh.Text = "Refresh History"
$btnHistoryRefresh.Width = 112
$btnHistoryRefresh.Height = 30
Style-Button -Button $btnHistoryRefresh -Primary:$false
$historyActions.Controls.Add($btnHistoryRefresh) | Out-Null

$btnHistoryView = New-Object System.Windows.Forms.Button
$btnHistoryView.Text = "View Report"
$btnHistoryView.Width = 96
$btnHistoryView.Height = 30
Style-Button -Button $btnHistoryView -Primary:$true
$historyActions.Controls.Add($btnHistoryView) | Out-Null

$btnHistoryRun = New-Object System.Windows.Forms.Button
$btnHistoryRun.Text = "Open Run"
$btnHistoryRun.Width = 86
$btnHistoryRun.Height = 30
$btnHistoryRun.Enabled = $false
Style-Button -Button $btnHistoryRun -Primary:$false
$historyActions.Controls.Add($btnHistoryRun) | Out-Null

$btnHistoryEvidence = New-Object System.Windows.Forms.Button
$btnHistoryEvidence.Text = "Open Evidence"
$btnHistoryEvidence.Width = 106
$btnHistoryEvidence.Height = 30
$btnHistoryEvidence.Enabled = $false
Style-Button -Button $btnHistoryEvidence -Primary:$false
$historyActions.Controls.Add($btnHistoryEvidence) | Out-Null

$btnHistoryCopy = New-Object System.Windows.Forms.Button
$btnHistoryCopy.Text = "Copy Details"
$btnHistoryCopy.Width = 98
$btnHistoryCopy.Height = 30
Style-Button -Button $btnHistoryCopy -Primary:$false
$historyActions.Controls.Add($btnHistoryCopy) | Out-Null

$btnHistoryCopyDigests = New-Object System.Windows.Forms.Button
$btnHistoryCopyDigests.Text = "Copy Digests"
$btnHistoryCopyDigests.Width = 102
$btnHistoryCopyDigests.Height = 30
Style-Button -Button $btnHistoryCopyDigests -Primary:$false
$historyActions.Controls.Add($btnHistoryCopyDigests) | Out-Null

$historyList = New-Object System.Windows.Forms.ListView
$historyList.Dock = "Fill"
$historyList.View = [System.Windows.Forms.View]::Details
$historyList.FullRowSelect = $true
$historyList.GridLines = $true
$historyList.HideSelection = $false
$historyList.BackColor = $colorPanel
$historyList.ForeColor = $colorText
[void]$historyList.Columns.Add("Target", 116)
[void]$historyList.Columns.Add("Status", 68)
[void]$historyList.Columns.Add("Adapter", 82)
[void]$historyList.Columns.Add("Baseline", 66)
[void]$historyList.Columns.Add("Latest", 66)
[void]$historyList.Columns.Add("Buckets", 76)

$historyDetail = New-Object System.Windows.Forms.TextBox
$historyDetail.Dock = "Fill"
$historyDetail.Multiline = $true
$historyDetail.ScrollBars = "Vertical"
$historyDetail.ReadOnly = $true
$historyDetail.BackColor = $colorPanel
$historyDetail.ForeColor = $colorText
$historyDetail.Font = $fontSmall
$historyDetail.Text = "Select a history row to view adapter evidence and capability summary."

$historyLayout.Controls.Add($historyActions, 0, 0)
$historyLayout.Controls.Add($historyList, 0, 1)
$historyLayout.Controls.Add($historyDetail, 0, 2)

$doctorLayout = New-Object System.Windows.Forms.TableLayoutPanel
$doctorLayout.Dock = "Fill"
$doctorLayout.ColumnCount = 1
$doctorLayout.RowCount = 2
$doctorLayout.Padding = New-Object System.Windows.Forms.Padding(6, 8, 6, 8)
$doctorLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 42)))
$doctorLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$tabDoctor.Controls.Add($doctorLayout)

$doctorActions = New-Object System.Windows.Forms.FlowLayoutPanel
$doctorActions.Dock = "Fill"
$doctorActions.FlowDirection = "LeftToRight"
$doctorActions.WrapContents = $false
$doctorActions.BackColor = $colorBg

$btnDoctorRun = New-Object System.Windows.Forms.Button
$btnDoctorRun.Text = "Run Shell Doctor"
$btnDoctorRun.Width = 118
$btnDoctorRun.Height = 30
Style-Button -Button $btnDoctorRun -Primary:$false
$doctorActions.Controls.Add($btnDoctorRun) | Out-Null

$btnAdapterDoctorRun = New-Object System.Windows.Forms.Button
$btnAdapterDoctorRun.Text = "Run Adapter Doctor"
$btnAdapterDoctorRun.Width = 132
$btnAdapterDoctorRun.Height = 30
Style-Button -Button $btnAdapterDoctorRun -Primary:$false
$doctorActions.Controls.Add($btnAdapterDoctorRun) | Out-Null

$btnAdapterDoctorStrictRun = New-Object System.Windows.Forms.Button
$btnAdapterDoctorStrictRun.Text = "Run Adapter Doctor (Strict)"
$btnAdapterDoctorStrictRun.Width = 176
$btnAdapterDoctorStrictRun.Height = 30
Style-Button -Button $btnAdapterDoctorStrictRun -Primary:$false
$doctorActions.Controls.Add($btnAdapterDoctorStrictRun) | Out-Null

$btnDoctorCopy = New-Object System.Windows.Forms.Button
$btnDoctorCopy.Text = "Copy Doctor Output"
$btnDoctorCopy.Width = 130
$btnDoctorCopy.Height = 30
Style-Button -Button $btnDoctorCopy -Primary:$false
$doctorActions.Controls.Add($btnDoctorCopy) | Out-Null

$doctorText = New-Object System.Windows.Forms.TextBox
$doctorText.Dock = "Fill"
$doctorText.Multiline = $true
$doctorText.ScrollBars = "Vertical"
$doctorText.ReadOnly = $true
$doctorText.BackColor = $colorPanel
$doctorText.ForeColor = $colorText
$doctorText.Font = $fontSmall
$doctorText.Text = "Doctor output appears here."

$doctorLayout.Controls.Add($doctorActions, 0, 0)
$doctorLayout.Controls.Add($doctorText, 0, 1)

$settingsLayout = New-Object System.Windows.Forms.TableLayoutPanel
$settingsLayout.Dock = "Fill"
$settingsLayout.ColumnCount = 1
$settingsLayout.RowCount = 4
$settingsLayout.Padding = New-Object System.Windows.Forms.Padding(10)
$settingsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 28)))
$settingsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 28)))
$settingsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 28)))
$settingsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$tabSettings.Controls.Add($settingsLayout)

$chkAuto = New-Object System.Windows.Forms.CheckBox
$chkAuto.Text = "Auto refresh every 5 seconds"
$chkAuto.Checked = $true
$chkAuto.AutoSize = $true
$chkAuto.ForeColor = $colorText

$chkTop = New-Object System.Windows.Forms.CheckBox
$chkTop.Text = "Topmost window"
$chkTop.Checked = $TopMost.IsPresent
$chkTop.AutoSize = $true
$chkTop.ForeColor = $colorText
$chkTop.Add_CheckedChanged({
  $form.TopMost = $chkTop.Checked
  if ($chkTop.Checked) {
    $form.Activate()
    $form.BringToFront()
    Set-StatusLine -StatusLabel $statusLabel -Message "Topmost enabled." -IsError $false
  } else {
    Set-StatusLine -StatusLabel $statusLabel -Message "Topmost disabled." -IsError $false
  }
})

$settingsHint = New-Object System.Windows.Forms.Label
$settingsHint.Text = "SAME launches target. CHANGED blocks launch until accepted."
$settingsHint.ForeColor = $colorMuted
$settingsHint.Font = $fontSmall
$settingsHint.Dock = "Fill"
$settingsHint.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$settingsLayout.Controls.Add($chkAuto, 0, 0)
$settingsLayout.Controls.Add($chkTop, 0, 1)
$settingsLayout.Controls.Add($settingsHint, 0, 2)

$statusBar = New-Object System.Windows.Forms.Panel
$statusBar.Dock = "Bottom"
$statusBar.Height = 28
$statusBar.BackColor = $colorHeader

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.AutoSize = $false
$statusLabel.Dock = "Fill"
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$statusLabel.Padding = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
$statusLabel.ForeColor = $colorMuted
$statusLabel.Font = $fontSmall
$statusLabel.Text = "Ready."
$statusBar.Controls.Add($statusLabel) | Out-Null

$syncNow = {
  param([switch]$Silent)
  $sync = if ($Silent.IsPresent) { Invoke-LaunchpadSync -Silent } else { Invoke-LaunchpadSync }
  $count = Load-Shortcuts -Panel $listPanel
  $tracked = Load-HistoryRows -ListView $historyList
  Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
  Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence
  if ($sync.ok) {
    $msg = "Synced. targets=" + $sync.scanned + " added=" + $sync.added + " removed=" + $sync.removed + " failed=" + $sync.failed + " visible=" + $count + " tracked=" + $tracked
    Set-StatusLine -StatusLabel $statusLabel -Message $msg -IsError $false
  } else {
    $label = if ($Silent.IsPresent) { "Refresh warning: " } else { "Sync error: " }
    Set-StatusLine -StatusLabel $statusLabel -Message ($label + $sync.code) -IsError $true
  }
}

$btnSync.Add_Click({ & $syncNow })
$btnSync2.Add_Click({ & $syncNow })
$btnRefresh.Add_Click({ & $syncNow -Silent })
$btnHistoryRefresh.Add_Click({
  $tracked = Load-HistoryRows -ListView $historyList
  Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
  Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence
  Set-StatusLine -StatusLabel $statusLabel -Message ("History refreshed. tracked=" + $tracked) -IsError $false
})
$btnHistoryView.Add_Click({
  Open-ReportViewerFromHistory -ListView $historyList -StatusLabel $statusLabel
})
$btnHistoryRun.Add_Click({
  Open-HistoryRunFolder -ListView $historyList -StatusLabel $statusLabel
})
$btnHistoryEvidence.Add_Click({
  Open-HistoryAdapterEvidenceFolder -ListView $historyList -StatusLabel $statusLabel
})
$btnHistoryCopy.Add_Click({
  Copy-HistoryDetailsText -DetailBox $historyDetail -StatusLabel $statusLabel
})
$btnHistoryCopyDigests.Add_Click({
  Copy-HistoryDigestText -DetailBox $historyDetail -StatusLabel $statusLabel
})
$historyList.Add_DoubleClick({
  Open-ReportViewerFromHistory -ListView $historyList -StatusLabel $statusLabel
})
$historyList.Add_KeyDown({
  param($sender, $e)
  if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
    $e.Handled = $true
    Open-ReportViewerFromHistory -ListView $historyList -StatusLabel $statusLabel
    return
  }
  if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) {
    $e.Handled = $true
    if ($e.Shift) {
      Copy-HistoryDigestText -DetailBox $historyDetail -StatusLabel $statusLabel
    } else {
      Copy-HistoryDetailsText -DetailBox $historyDetail -StatusLabel $statusLabel
    }
  }
})
$historyDetail.Add_KeyDown({
  param($sender, $e)
  if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) {
    $e.Handled = $true
    if ($e.Shift) {
      Copy-HistoryDigestText -DetailBox $historyDetail -StatusLabel $statusLabel
    } else {
      Copy-HistoryDetailsText -DetailBox $historyDetail -StatusLabel $statusLabel
    }
  }
})
$historyList.Add_SelectedIndexChanged({
  Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
  Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence
})
$btnDoctorRun.Add_Click({
  $result = Invoke-ShellDoctorText
  $header = @(
    "Shell doctor exitCode=" + [string]$result.exitCode,
    "Shell doctor code=" + [string]$result.code
  )
  $body = if ($result.output -and [string]$result.output -ne "") {
    [string]$result.output
  } else {
    "(no shell doctor output)"
  }
  $doctorText.Text = (($header + @("", $body)) -join [Environment]::NewLine)
  if ($result.ok) {
    Set-StatusLine -StatusLabel $statusLabel -Message "Shell doctor completed." -IsError $false
  } else {
    Set-StatusLine -StatusLabel $statusLabel -Message ("Shell doctor failed (" + [string]$result.code + ").") -IsError $true
  }
})
$btnAdapterDoctorRun.Add_Click({
  $result = Invoke-AdapterDoctorText
  $header = @(
    "Adapter doctor exitCode=" + [string]$result.exitCode,
    "Adapter doctor code=" + [string]$result.code
  )
  $body = if ($result.output -and [string]$result.output -ne "") {
    [string]$result.output
  } else {
    "(no adapter doctor output)"
  }
  $doctorText.Text = (($header + @("", $body)) -join [Environment]::NewLine)
  if ($result.ok) {
    Set-StatusLine -StatusLabel $statusLabel -Message "Adapter doctor completed." -IsError $false
  } else {
    Set-StatusLine -StatusLabel $statusLabel -Message ("Adapter doctor failed (" + [string]$result.code + ").") -IsError $true
  }
})
$btnAdapterDoctorStrictRun.Add_Click({
  $result = Invoke-AdapterDoctorText -Strict
  $header = @(
    "Adapter doctor strict=true",
    "Adapter doctor exitCode=" + [string]$result.exitCode,
    "Adapter doctor code=" + [string]$result.code
  )
  $body = if ($result.output -and [string]$result.output -ne "") {
    [string]$result.output
  } else {
    "(no adapter doctor output)"
  }
  $doctorText.Text = (($header + @("", $body)) -join [Environment]::NewLine)
  if ($result.ok) {
    Set-StatusLine -StatusLabel $statusLabel -Message "Adapter doctor strict check passed." -IsError $false
  } else {
    Set-StatusLine -StatusLabel $statusLabel -Message ("Adapter doctor strict check failed (" + [string]$result.code + ").") -IsError $true
  }
})
$btnDoctorCopy.Add_Click({
  Copy-DoctorOutputText -DoctorBox $doctorText -StatusLabel $statusLabel
})
$doctorText.Add_KeyDown({
  param($sender, $e)
  if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) {
    $e.Handled = $true
    Copy-DoctorOutputText -DoctorBox $doctorText -StatusLabel $statusLabel
  }
})

$initialCount = Load-Shortcuts -Panel $listPanel
$initialTracked = Load-HistoryRows -ListView $historyList
Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence
Set-StatusLine -StatusLabel $statusLabel -Message ("Ready. visible=" + $initialCount + " tracked=" + $initialTracked) -IsError $false

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
  if ($chkAuto.Checked) {
    & $syncNow -Silent
  }
})
$timer.Start()

$form.Controls.Add($tabs)
$form.Controls.Add($statusBar)
$form.Controls.Add($header)
[void]$form.ShowDialog()
