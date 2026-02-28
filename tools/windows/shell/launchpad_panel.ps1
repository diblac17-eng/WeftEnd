# tools/windows/shell/launchpad_panel.ps1
# Small Launchpad panel for clicking WeftEnd shortcuts.

param(
  [switch]$TopMost
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-NativeCommandCapture {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )
  $tmpOut = [System.IO.Path]::GetTempFileName()
  $tmpErr = [System.IO.Path]::GetTempFileName()
  try {
    $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -NoNewWindow -PassThru -Wait -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    $stdout = ""
    $stderr = ""
    if (Test-Path -LiteralPath $tmpOut) {
      $stdout = [string](Get-Content -LiteralPath $tmpOut -Raw -Encoding UTF8)
    }
    if (Test-Path -LiteralPath $tmpErr) {
      $stderr = [string](Get-Content -LiteralPath $tmpErr -Raw -Encoding UTF8)
    }
    $combined = @()
    if ($stdout -and $stdout.Trim() -ne "") { $combined += $stdout.TrimEnd() }
    if ($stderr -and $stderr.Trim() -ne "") { $combined += $stderr.TrimEnd() }
    return [ordered]@{
      exitCode = [int]$proc.ExitCode
      stdout = $stdout
      stderr = $stderr
      output = if ($combined.Count -gt 0) { $combined -join [Environment]::NewLine } else { "" }
    }
  } finally {
    Remove-Item -LiteralPath $tmpOut -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmpErr -Force -ErrorAction SilentlyContinue
  }
}

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

function Get-StableSortKey {
  param([string]$Value)
  if (-not $Value) { return "" }
  $normalized = [string]$Value
  try {
    $normalized = $normalized.Normalize([Text.NormalizationForm]::FormKC)
  } catch {
    # keep original text when normalization is unavailable
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) {
    [void]$sb.AppendFormat("{0:x2}", $b)
  }
  return $sb.ToString()
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
$colorPass = [System.Drawing.Color]::FromArgb(120, 210, 150)
$colorWarn = [System.Drawing.Color]::FromArgb(242, 194, 96)
$colorFail = [System.Drawing.Color]::FromArgb(242, 118, 118)
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
    Write-TextFileAtomic -PathValue $diagPath -TextValue ($diagLines -join "`n")
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
      Write-TextFileAtomic -PathValue $diagPath -TextValue ($diag -join "`n")
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
    $captured = Invoke-NativeCommandCapture -FilePath $nodePath -Arguments $args
    $outputText = [string](Get-ObjectProperty -ObjectValue $captured -Name "output")
    if (-not $outputText) { $outputText = "" }
    $exitCode = [int](Get-ObjectProperty -ObjectValue $captured -Name "exitCode")
    $ok = ($exitCode -eq 0)
    $code = "OK"
    if (-not $ok) {
      $code = "ADAPTER_DOCTOR_FAILED"
      $reasonMatch = [System.Text.RegularExpressions.Regex]::Match($outputText, "(?m)^\[([A-Z0-9_]+)\]")
      if ($reasonMatch.Success -and $reasonMatch.Groups.Count -gt 1) {
        $parsedCode = [string]$reasonMatch.Groups[1].Value
        if ($parsedCode -and $parsedCode.Trim() -ne "") {
          $code = $parsedCode.Trim()
        }
      } else {
        $strictReasonMatch = [System.Text.RegularExpressions.Regex]::Match($outputText, "strict\.reasons=([A-Z0-9_, -]+)")
        if ($strictReasonMatch.Success -and $strictReasonMatch.Groups.Count -gt 1) {
          $strictRaw = [string]$strictReasonMatch.Groups[1].Value
          if ($strictRaw -and $strictRaw.Trim() -ne "" -and $strictRaw.Trim() -ne "-") {
            $first = ($strictRaw.Split(",")[0]).Trim()
            if ($first -and $first -match "^[A-Z0-9_]+$") {
              $code = $first
            }
          }
        }
      }
    }
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
  param(
    [switch]$RepairReportViewer,
    [switch]$RepairShortcuts
  )
  if (-not $shellDoctorScript -or -not (Test-Path -LiteralPath $shellDoctorScript)) {
    return @{
      ok = $false
      code = "SHELL_DOCTOR_SCRIPT_MISSING"
      exitCode = 40
      output = "Shell doctor script missing."
    }
  }
  try {
    $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $shellDoctorScript)
    if ($RepairReportViewer.IsPresent) {
      $args += "-RepairReportViewer"
    }
    if ($RepairShortcuts.IsPresent) {
      $args += "-RepairShortcuts"
    }
    $outputRaw = @(& $powershellExe @args 2>&1)
    $outputText = [string](($outputRaw | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    if (-not $outputText) { $outputText = "" }
    $exitCode = [int]$LASTEXITCODE
    $ok = ($exitCode -eq 0)
    $code = "OK"
    if (-not $ok) {
      $code = "SHELL_DOCTOR_FAILED"
      $statusCodeMatch = [System.Text.RegularExpressions.Regex]::Match($outputText, "(?m)^ShellDoctorStatus:\s*FAIL\s+code=([A-Z0-9_]+)\s*$")
      if ($statusCodeMatch.Success -and $statusCodeMatch.Groups.Count -gt 1) {
        $parsedStatusCode = [string]$statusCodeMatch.Groups[1].Value
        if ($parsedStatusCode -and $parsedStatusCode.Trim() -ne "") {
          $code = $parsedStatusCode.Trim()
        }
      }
      if ($code -eq "SHELL_DOCTOR_FAILED") {
        $codeMatch = [System.Text.RegularExpressions.Regex]::Match($outputText, "code=([A-Z0-9_]+)")
        if ($codeMatch.Success -and $codeMatch.Groups.Count -gt 1) {
          $parsedCode = [string]$codeMatch.Groups[1].Value
          if ($parsedCode -and $parsedCode.Trim() -ne "") {
            $code = $parsedCode.Trim()
          }
        }
      }
    }
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

  $files = @(
    Get-ChildItem -LiteralPath $launchpadRoot -Filter "*.lnk" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "* (WeftEnd).lnk" } |
      Sort-Object @{ Expression = { Get-StableSortKey -Value $_.Name } }
  )
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

function Write-LaunchpadUiError {
  param([string]$Code)
  try {
    $errorCode = if ($Code -and $Code.Trim() -ne "") { $Code.Trim() } else { "LAUNCHPAD_UI_ERROR" }
    $path = Join-Path $launchpadRoot "ui_last_error.txt"
    $lines = @(
      "code=" + $errorCode,
      "message=UI action failed; restart Launchpad and retry."
    )
    Write-TextFileAtomic -PathValue $path -TextValue ($lines -join "`n")
  } catch {
    # best effort only
  }
}

function Invoke-UiSafe {
  param(
    [string]$Code,
    [System.Windows.Forms.Label]$StatusLabel,
    [string]$Message,
    [scriptblock]$Action
  )
  if (-not $Action) { return }
  try {
    & $Action
  } catch {
    $errorCode = if ($Code -and $Code.Trim() -ne "") { $Code.Trim() } else { "LAUNCHPAD_UI_ERROR" }
    Write-LaunchpadUiError -Code $errorCode
    $safeMessage = if ($Message -and $Message.Trim() -ne "") { $Message.Trim() } else { "Launchpad action failed." }
    Set-StatusLine -StatusLabel $StatusLabel -Message ($safeMessage + " (" + $errorCode + ")") -IsError $true
  }
}

function New-DoctorLampLabel {
  param([string]$Name)
  $label = New-Object System.Windows.Forms.Label
  $label.AutoSize = $true
  $label.Margin = New-Object System.Windows.Forms.Padding(0, 6, 12, 6)
  $label.Font = $fontSmall
  $label.ForeColor = $colorMuted
  $label.Tag = "UNKNOWN"
  $label.Text = ("[UNKNOWN] " + $Name)
  return $label
}

function Set-DoctorLampState {
  param(
    [System.Windows.Forms.Label]$Label,
    [string]$Name,
    [string]$State,
    [string]$Detail
  )
  if (-not $Label) { return }
  $stateToken = if ($State) { $State.Trim().ToUpperInvariant() } else { "UNKNOWN" }
  if (-not $stateToken) { $stateToken = "UNKNOWN" }
  $Label.Tag = $stateToken
  $Label.ForeColor = switch ($stateToken) {
    "PASS" { $colorPass; break }
    "WARN" { $colorWarn; break }
    "FAIL" { $colorFail; break }
    default { $colorMuted }
  }
  $suffix = if ($Detail -and $Detail.Trim() -ne "") { " (" + $Detail.Trim() + ")" } else { "" }
  $Label.Text = ("[" + $stateToken + "] " + $Name + $suffix)
}

function Update-DoctorOverallLamp {
  param(
    [System.Windows.Forms.Label]$OverallLamp,
    [System.Windows.Forms.Label]$ShellLamp,
    [System.Windows.Forms.Label]$AdapterLamp,
    [System.Windows.Forms.Label]$AdapterStrictLamp
  )
  $shellState = if ($ShellLamp) { [string]$ShellLamp.Tag } else { "UNKNOWN" }
  $adapterState = if ($AdapterLamp) { [string]$AdapterLamp.Tag } else { "UNKNOWN" }
  $adapterStrictState = if ($AdapterStrictLamp) { [string]$AdapterStrictLamp.Tag } else { "UNKNOWN" }
  $states = @($shellState, $adapterState, $adapterStrictState)
  $overall = "UNKNOWN"
  $detail = ""
  if ($states -contains "FAIL") {
    $overall = "FAIL"
    $detail = "action needed"
  } elseif ($states -contains "WARN") {
    $overall = "WARN"
    $detail = "review warnings"
  } elseif ($states -contains "PASS") {
    $allPass = $true
    foreach ($s in $states) {
      if ($s -ne "PASS" -and $s -ne "UNKNOWN") { $allPass = $false; break }
    }
    if ($allPass) {
      $overall = "PASS"
      $detail = "healthy"
    }
  }
  Set-DoctorLampState -Label $OverallLamp -Name "Overall" -State $overall -Detail $detail
}

function Get-AdapterDoctorLampState {
  param(
    [hashtable]$Result,
    [switch]$Strict
  )
  $out = [ordered]@{
    state = "UNKNOWN"
    detail = ""
  }
  if (-not $Result) { return $out }
  if (-not [bool](Get-ObjectProperty -ObjectValue $Result -Name "ok")) {
    $out.state = "FAIL"
    $out.detail = [string](Get-ObjectProperty -ObjectValue $Result -Name "code")
    return $out
  }
  $text = [string](Get-ObjectProperty -ObjectValue $Result -Name "output")
  if ($Strict.IsPresent) {
    $out.state = "PASS"
    $out.detail = "strict"
    return $out
  }
  if ($text -match "(?m)plugins=.*:missing") {
    $out.state = "WARN"
    $out.detail = "missing plugin"
    return $out
  }
  $out.state = "PASS"
  $out.detail = "ok"
  return $out
}

function Get-NonEmptyLines {
  param([string]$TextValue)
  $lines = @()
  if (-not $TextValue -or $TextValue.Trim() -eq "") { return $lines }
  foreach ($lineObj in @([string]$TextValue -split "`r?`n")) {
    $line = [string]$lineObj
    if ($line.Trim() -eq "") { continue }
    $lines += $line
  }
  return $lines
}

function Get-DoctorStateToken {
  param([string]$StateValue)
  $state = if ($StateValue) { $StateValue.Trim().ToUpperInvariant() } else { "UNKNOWN" }
  if (-not $state) { $state = "UNKNOWN" }
  switch ($state) {
    "OK" { return "PASS" }
    "MISSING" { return "FAIL" }
    default { return $state }
  }
}

function Get-DoctorLightToken {
  param([string]$StateValue)
  $state = Get-DoctorStateToken -StateValue $StateValue
  switch ($state) {
    "PASS" { return "GREEN" }
    "WARN" { return "YELLOW" }
    "FAIL" { return "RED" }
    default { return "GRAY" }
  }
}

function Build-ShellDoctorPanelText {
  param(
    [hashtable]$Result,
    [string]$ModeToken = "run"
  )
  $ok = [bool](Get-ObjectProperty -ObjectValue $Result -Name "ok")
  $code = [string](Get-ObjectProperty -ObjectValue $Result -Name "code")
  $exitCode = [string](Get-ObjectProperty -ObjectValue $Result -Name "exitCode")
  $output = [string](Get-ObjectProperty -ObjectValue $Result -Name "output")
  $lines = @(Get-NonEmptyLines -TextValue $output)

  $status = if ($ok) { "PASS" } else { "FAIL" }
  $statusMatch = [System.Text.RegularExpressions.Regex]::Match($output, "(?m)^ShellDoctorStatus:\s*([A-Z]+)\s*$")
  if ($statusMatch.Success -and $statusMatch.Groups.Count -gt 1) {
    $parsedStatus = [string]$statusMatch.Groups[1].Value
    if ($parsedStatus -and $parsedStatus.Trim() -ne "") { $status = $parsedStatus.Trim() }
  }

  $okCount = 0
  $failCount = 0
  $missingCount = 0
  $warnCount = 0
  $issueLines = @()
  $checkRows = @()
  foreach ($line in $lines) {
    $trimmed = [string]$line
    $checkMatch = [System.Text.RegularExpressions.Regex]::Match($trimmed, "^\s*([A-Za-z0-9_.-]+):\s*(OK|WARN|FAIL|MISSING)\b(.*)$")
    if ($checkMatch.Success -and $checkMatch.Groups.Count -ge 3 -and $checkRows.Count -lt 16) {
      $checkName = [string]$checkMatch.Groups[1].Value
      $checkRawState = [string]$checkMatch.Groups[2].Value
      $checkDetailRaw = if ($checkMatch.Groups.Count -ge 4) { [string]$checkMatch.Groups[3].Value } else { "" }
      $checkRows += [ordered]@{
        name = if ($checkName) { $checkName.Trim() } else { "CHECK" }
        state = Get-DoctorStateToken -StateValue $checkRawState
        detail = if ($checkDetailRaw) { $checkDetailRaw.Trim() } else { "" }
      }
    }
    if ($trimmed -match ":\s*OK(\b| )") { $okCount++; continue }
    if ($trimmed -match ":\s*MISSING(\b| )") {
      $missingCount++
      if ($issueLines.Count -lt 8) { $issueLines += $trimmed }
      continue
    }
    if ($trimmed -match ":\s*FAIL(\b| )") {
      $failCount++
      if ($issueLines.Count -lt 8) { $issueLines += $trimmed }
      continue
    }
    if ($trimmed -match ":\s*WARN(\b| )") {
      $warnCount++
      if ($issueLines.Count -lt 8) { $issueLines += $trimmed }
      continue
    }
  }

  $mode = if ($ModeToken -and $ModeToken.Trim() -ne "") { $ModeToken.Trim() } else { "run" }
  $header = @(
    "DOCTOR SUMMARY (Shell/" + $mode + ")",
    "overall=" + $status,
    "exitCode=" + $exitCode,
    "code=" + $code,
    "checks.ok=" + [string]$okCount,
    "checks.warn=" + [string]$warnCount,
    "checks.fail=" + [string]$failCount,
    "checks.missing=" + [string]$missingCount
  )

  $header += ""
  $header += "status.lines:"
  $header += ("  [" + (Get-DoctorStateToken -StateValue $status) + "] overall")
  $warnSignal = if (($warnCount + $missingCount + $failCount) -gt 0) { "WARN" } else { "PASS" }
  $header += ("  [" + $warnSignal + "] warnings=" + [string]($warnCount + $missingCount + $failCount))
  $header += ""
  $header += "doctor.lights:"
  $header += ("  overall=" + (Get-DoctorLightToken -StateValue $status))
  $header += ("  warnings=" + (Get-DoctorLightToken -StateValue $warnSignal))

  if ($checkRows.Count -gt 0) {
    $header += ""
    $header += "check.matrix:"
    foreach ($row in @($checkRows | Sort-Object @{ Expression = { Get-StableSortKey -Value ([string]$_.name) } })) {
      $detailSuffix = if ($row.detail -and ([string]$row.detail).Trim() -ne "") { " " + [string]$row.detail } else { "" }
      $header += ("  [" + [string]$row.state + "] " + [string]$row.name + $detailSuffix)
    }
  }

  if ($issueLines.Count -gt 0) {
    $header += ""
    $header += "issues:"
    foreach ($issue in $issueLines) {
      $header += ("  - " + $issue)
    }
  }

  $header += ""
  $header += "raw:"
  if ($output -and $output.Trim() -ne "") {
    $header += $output
  } else {
    $header += "(no shell doctor output)"
  }
  return ($header -join [Environment]::NewLine)
}

function Build-AdapterDoctorPanelText {
  param(
    [hashtable]$Result,
    [switch]$Strict
  )
  $ok = [bool](Get-ObjectProperty -ObjectValue $Result -Name "ok")
  $code = [string](Get-ObjectProperty -ObjectValue $Result -Name "code")
  $exitCode = [string](Get-ObjectProperty -ObjectValue $Result -Name "exitCode")
  $output = [string](Get-ObjectProperty -ObjectValue $Result -Name "output")
  $lines = @(Get-NonEmptyLines -TextValue $output)

  $missingAdapters = @()
  $adapterRows = @()
  $enabledCount = 0
  foreach ($line in $lines) {
    $trimmed = [string]$line
    $adapterMatch = [System.Text.RegularExpressions.Regex]::Match($trimmed, "^\s*([a-z0-9_]+)\s+status=([a-z_]+)\s+mode=([a-z_]+)\s+plugins=(.*)$")
    if ($adapterMatch.Success -and $adapterMatch.Groups.Count -ge 5) {
      $name = [string]$adapterMatch.Groups[1].Value
      $statusToken = [string]$adapterMatch.Groups[2].Value
      $modeToken = [string]$adapterMatch.Groups[3].Value
      $pluginsToken = [string]$adapterMatch.Groups[4].Value
      if ($statusToken -eq "enabled") { $enabledCount++ }
      $rowState = "PASS"
      $rowDetail = @("status=" + $statusToken, "mode=" + $modeToken)
      if ($pluginsToken -and $pluginsToken.Trim() -ne "" -and $pluginsToken.Trim() -ne "-") {
        $rowDetail += ("plugins=" + $pluginsToken.Trim())
      }
      if ($statusToken -ne "enabled") {
        $rowState = "WARN"
      }
      if ($pluginsToken -match ":missing") {
        $rowState = "WARN"
      }
      $adapterRows += [ordered]@{
        name = if ($name) { $name.Trim() } else { "adapter" }
        state = $rowState
        detail = $rowDetail -join " "
      }
    }
    if ($trimmed -match "^\s+([a-z0-9_]+)\s+status=.*plugins=.*:missing") {
      $name = [string]$matches[1]
      if (-not ($missingAdapters -contains $name)) { $missingAdapters += $name }
    }
  }

  $strictStatus = "OFF"
  $strictMatch = [System.Text.RegularExpressions.Regex]::Match($output, "(?m)^strict\.status=([A-Z]+)\s*$")
  if ($strictMatch.Success -and $strictMatch.Groups.Count -gt 1) {
    $strictStatus = [string]$strictMatch.Groups[1].Value
  }
  $strictReasons = "-"
  $strictReasonMatch = [System.Text.RegularExpressions.Regex]::Match($output, "(?m)^strict\.reasons=([A-Z0-9_, -]+)\s*$")
  if ($strictReasonMatch.Success -and $strictReasonMatch.Groups.Count -gt 1) {
    $strictReasonsValue = [string]$strictReasonMatch.Groups[1].Value
    if ($strictReasonsValue -and $strictReasonsValue.Trim() -ne "") {
      $strictReasons = $strictReasonsValue.Trim()
    }
  }
  $actionLines = @()
  foreach ($line in $lines) {
    $trimmed = [string]$line
    if ($trimmed -match "^\s*-\s+(.+)$") {
      $actionText = [string]$matches[1]
      if ($actionText -and $actionText.Trim() -ne "" -and $actionLines.Count -lt 8) {
        $actionLines += $actionText.Trim()
      }
    }
  }

  $overall = "UNKNOWN"
  if (-not $ok) {
    $overall = "FAIL"
  } elseif ($Strict.IsPresent) {
    $overall = "PASS"
  } elseif ($missingAdapters.Count -gt 0) {
    $overall = "WARN"
  } else {
    $overall = "PASS"
  }

  $mode = if ($Strict.IsPresent) { "strict" } else { "run" }
  $header = @(
    "DOCTOR SUMMARY (Adapter/" + $mode + ")",
    "overall=" + $overall,
    "exitCode=" + $exitCode,
    "code=" + $code,
    "strict.status=" + $strictStatus,
    "strict.reasons=" + $strictReasons,
    "adapters.enabled=" + [string]$enabledCount,
    "plugins.missing=" + [string]$missingAdapters.Count
  )
  if ($missingAdapters.Count -gt 0) {
    $header += ("missing.adapters=" + ($missingAdapters -join ","))
  }

  $header += ""
  $header += "status.lines:"
  $header += ("  [" + $overall + "] overall")
  $strictSignal = if ($strictStatus -eq "FAIL") { "FAIL" } elseif ($strictStatus -eq "PASS") { "PASS" } elseif ($strictStatus -eq "OFF") { "WARN" } else { "UNKNOWN" }
  $header += ("  [" + $strictSignal + "] strict.status=" + $strictStatus)
  if ($strictReasons -and $strictReasons -ne "-") {
    $strictReasonsSignal = if ($strictStatus -eq "FAIL") { "FAIL" } else { "WARN" }
    $header += ("  [" + $strictReasonsSignal + "] strict.reasons=" + $strictReasons)
  }
  $header += ""
  $header += "doctor.lights:"
  $header += ("  overall=" + (Get-DoctorLightToken -StateValue $overall))
  $header += ("  strict=" + (Get-DoctorLightToken -StateValue $strictSignal))
  $pluginSignal = if ($missingAdapters.Count -gt 0) { "WARN" } else { "PASS" }
  $header += ("  plugins=" + (Get-DoctorLightToken -StateValue $pluginSignal))

  if ($adapterRows.Count -gt 0) {
    $header += ""
    $header += "adapter.matrix:"
    foreach ($row in @($adapterRows | Sort-Object @{ Expression = { Get-StableSortKey -Value ([string]$_.name) } })) {
      $header += ("  [" + [string]$row.state + "] " + [string]$row.name + " " + [string]$row.detail)
    }
  }
  if ($actionLines.Count -gt 0) {
    $header += ""
    $header += "recommended.actions:"
    foreach ($action in @($actionLines | Sort-Object @{ Expression = { Get-StableSortKey -Value ([string]$_) } })) {
      $header += ("  - " + [string]$action)
    }
  }

  $header += ""
  $header += "raw:"
  if ($output -and $output.Trim() -ne "") {
    $header += $output
  } else {
    $header += "(no adapter doctor output)"
  }
  return ($header -join [Environment]::NewLine)
}

function Compute-TextSha256Digest {
  param([string]$TextValue)
  if ($null -eq $TextValue) { $TextValue = "" }
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$TextValue)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha.ComputeHash($bytes)
    } finally {
      $sha.Dispose()
    }
    $sb = New-Object System.Text.StringBuilder
    foreach ($b in $hashBytes) { [void]$sb.AppendFormat("{0:x2}", $b) }
    return "sha256:" + $sb.ToString()
  } catch {
    return "-"
  }
}

function Write-TextFileAtomic {
  param(
    [string]$PathValue,
    [string]$TextValue
  )
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

function Get-SnapshotTrustRoot {
  return (Join-Path $libraryRoot "SnapshotTrust")
}

function Get-SnapshotBindingsPath {
  return (Join-Path (Get-SnapshotTrustRoot) "bindings_v0.json")
}

function Get-SnapshotBucketsRoot {
  return (Join-Path (Get-SnapshotTrustRoot) "buckets")
}

function Get-SnapshotTargetToken {
  param([string]$TargetKey)
  $token = if ($TargetKey) { ([string]$TargetKey -replace "[^A-Za-z0-9_]+", "_").Trim("_") } else { "target" }
  if (-not $token -or $token -eq "") { $token = "target" }
  return $token
}

function Get-SnapshotBucketDir {
  param([string]$TargetKey)
  $token = Get-SnapshotTargetToken -TargetKey $TargetKey
  return (Join-Path (Get-SnapshotBucketsRoot) $token)
}

function Ensure-SnapshotBucketDir {
  param([string]$TargetKey)
  $dir = Get-SnapshotBucketDir -TargetKey $TargetKey
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Get-SnapshotLatestReferencePath {
  param([string]$TargetKey)
  if (-not $TargetKey -or $TargetKey.Trim() -eq "") { return $null }
  $bucketDir = Get-SnapshotBucketDir -TargetKey $TargetKey
  if (-not (Test-Path -LiteralPath $bucketDir)) { return $null }
  $path = Join-Path $bucketDir "snapshot_ref_latest.json"
  if (Test-Path -LiteralPath $path) { return $path }
  return $null
}

function Get-SnapshotActionsDir {
  return (Join-Path (Get-SnapshotTrustRoot) "actions")
}

function Ensure-SnapshotTrustStore {
  $root = Get-SnapshotTrustRoot
  $buckets = Get-SnapshotBucketsRoot
  $actions = Get-SnapshotActionsDir
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  New-Item -ItemType Directory -Force -Path $buckets | Out-Null
  New-Item -ItemType Directory -Force -Path $actions | Out-Null
}

function Read-SnapshotBindings {
  $path = Get-SnapshotBindingsPath
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  try {
    $obj = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($obj -is [System.Array]) { return @($obj) }
    return @()
  } catch {
    return @()
  }
}

function Get-SnapshotBindingForTarget {
  param([string]$TargetKey)
  if (-not $TargetKey -or $TargetKey.Trim() -eq "") { return $null }
  foreach ($b in @(Read-SnapshotBindings)) {
    $key = [string](Get-ObjectProperty -ObjectValue $b -Name "targetKey")
    if ($key -and $key -eq $TargetKey) { return $b }
  }
  return $null
}

function Test-SnapshotBindingForTarget {
  param([string]$TargetKey)
  return ($null -ne (Get-SnapshotBindingForTarget -TargetKey $TargetKey))
}

function Get-SnapshotGateStateForRun {
  param(
    [string]$TargetKey,
    [hashtable]$Snapshot
  )
  $out = [ordered]@{
    state = "UNBOUND"
    reason = "SNAPSHOT_BINDING_NONE"
    matchCount = 0
    checkedCount = 0
    mismatchCount = 0
    missingCount = 0
  }
  $binding = Get-SnapshotBindingForTarget -TargetKey $TargetKey
  if (-not $binding) { return $out }
  $fields = @(
    "artifactFingerprint",
    "artifactDigest",
    "safeReceiptDigest",
    "reportCardDigest"
  )
  foreach ($field in $fields) {
    $expected = [string](Get-ObjectProperty -ObjectValue $binding -Name $field)
    if (-not $expected -or $expected -eq "-") {
      $out.missingCount++
      continue
    }
    $out.checkedCount++
    $actual = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name $field)
    if (-not $actual -or $actual -eq "-") {
      $out.mismatchCount++
      continue
    }
    if ($actual -eq $expected) {
      $out.matchCount++
    } else {
      $out.mismatchCount++
    }
  }
  if ($out.checkedCount -le 0) {
    $out.state = "BOUND_INCOMPLETE"
    $out.reason = "SNAPSHOT_BINDING_INCOMPLETE"
    return $out
  }
  if ($out.mismatchCount -gt 0) {
    $out.state = "BOUND_DRIFT"
    $out.reason = "SNAPSHOT_BINDING_MISMATCH"
  } else {
    $out.state = "BOUND_MATCH"
    $out.reason = "SNAPSHOT_BINDING_MATCH"
  }
  return $out
}

function Write-SnapshotBindings {
  param([object[]]$Bindings)
  Ensure-SnapshotTrustStore
  $path = Get-SnapshotBindingsPath
  $safeList = @()
  foreach ($binding in @($Bindings)) {
    if ($null -eq $binding) { continue }
    $safeList += [ordered]@{
      schema = "weftend.snapshotBinding/0"
      schemaVersion = 0
      bindingId = [string](Get-ObjectProperty -ObjectValue $binding -Name "bindingId")
      targetKey = [string](Get-ObjectProperty -ObjectValue $binding -Name "targetKey")
      targetDirDigest = [string](Get-ObjectProperty -ObjectValue $binding -Name "targetDirDigest")
      referenceFileDigest = [string](Get-ObjectProperty -ObjectValue $binding -Name "referenceFileDigest")
      snapshotDigest = [string](Get-ObjectProperty -ObjectValue $binding -Name "snapshotDigest")
      artifactFingerprint = [string](Get-ObjectProperty -ObjectValue $binding -Name "artifactFingerprint")
      artifactDigest = [string](Get-ObjectProperty -ObjectValue $binding -Name "artifactDigest")
      safeReceiptDigest = [string](Get-ObjectProperty -ObjectValue $binding -Name "safeReceiptDigest")
      reportCardDigest = [string](Get-ObjectProperty -ObjectValue $binding -Name "reportCardDigest")
      policy = "EXACT_DIGESTS"
      reasonCodes = @("SNAPSHOT_BINDING_LOCAL_ONLY")
    }
  }
  $json = ($safeList | ConvertTo-Json -Depth 8)
  Write-TextFileAtomic -PathValue $path -TextValue ($json + "`n")
}

function Read-SnapshotReferenceFile {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return $null }
  try {
    $obj = Get-Content -LiteralPath $PathValue -Raw -Encoding UTF8 | ConvertFrom-Json
    $schema = [string](Get-ObjectProperty -ObjectValue $obj -Name "schema")
    if ($schema -ne "weftend.snapshotReference/0") { return $null }
    $identity = Get-ObjectProperty -ObjectValue $obj -Name "identity"
    if (-not $identity) { return $null }
    $out = [ordered]@{
      schema = $schema
      schemaVersion = [int](Get-ObjectProperty -ObjectValue $obj -Name "schemaVersion")
      targetKey = [string](Get-ObjectProperty -ObjectValue $obj -Name "targetKey")
      runId = [string](Get-ObjectProperty -ObjectValue $obj -Name "runId")
      snapshotDigest = [string](Get-ObjectProperty -ObjectValue $obj -Name "snapshotDigest")
      artifactFingerprint = [string](Get-ObjectProperty -ObjectValue $identity -Name "artifactFingerprint")
      artifactDigest = [string](Get-ObjectProperty -ObjectValue $identity -Name "artifactDigest")
      safeReceiptDigest = [string](Get-ObjectProperty -ObjectValue $identity -Name "safeReceiptDigest")
      reportCardDigest = [string](Get-ObjectProperty -ObjectValue $identity -Name "reportCardDigest")
      operatorReceiptDigest = [string](Get-ObjectProperty -ObjectValue $identity -Name "operatorReceiptDigest")
      privacyLintDigest = [string](Get-ObjectProperty -ObjectValue $identity -Name "privacyLintDigest")
      fileDigest = Compute-FileSha256Digest -PathValue $PathValue
      path = $PathValue
    }
    return $out
  } catch {
    return $null
  }
}

function Compare-SnapshotReference {
  param(
    [hashtable]$LocalSnapshot,
    [hashtable]$Reference
  )
  $result = [ordered]@{
    verdict = "CHANGED"
    reasonCodes = @()
    matchFields = @()
    mismatchFields = @()
    missingFields = @()
  }
  $fields = @(
    "artifactFingerprint",
    "artifactDigest",
    "safeReceiptDigest",
    "reportCardDigest"
  )
  foreach ($field in $fields) {
    $left = [string](Get-ObjectProperty -ObjectValue $LocalSnapshot -Name $field)
    $right = [string](Get-ObjectProperty -ObjectValue $Reference -Name $field)
    if (-not $right -or $right -eq "-") {
      $result.missingFields += $field
      continue
    }
    if (-not $left -or $left -eq "-") {
      $result.mismatchFields += $field
      continue
    }
    if ($left -eq $right) {
      $result.matchFields += $field
    } else {
      $result.mismatchFields += $field
    }
  }
  if ($result.matchFields.Count -gt 0 -and $result.mismatchFields.Count -eq 0) {
    $result.verdict = "SAME"
    $result.reasonCodes = @("SNAPSHOT_COMPARE_SAME", "SNAPSHOT_COMPARE_LOCAL_ONLY")
  } else {
    $result.verdict = "CHANGED"
    $result.reasonCodes = @("SNAPSHOT_COMPARE_CHANGED", "SNAPSHOT_COMPARE_LOCAL_ONLY")
  }
  if ($result.missingFields.Count -ge $fields.Count) {
    $result.verdict = "CHANGED"
    $result.reasonCodes += "SNAPSHOT_REFERENCE_INVALID"
  }
  if ($result.mismatchFields.Count -gt 0) {
    $result.reasonCodes += "SNAPSHOT_DIGEST_MISMATCH"
  }
  $result.reasonCodes = @(Get-NormalizedBucketList -Value $result.reasonCodes)
  return $result
}

function New-SnapshotReferenceFromHistoryRow {
  param(
    [string]$TargetKey,
    [hashtable]$Snapshot
  )
  $body = [ordered]@{
    schema = "weftend.snapshotReference/0"
    schemaVersion = 0
    targetKey = [string]$TargetKey
    runId = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "runId")
    identity = [ordered]@{
      artifactFingerprint = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "artifactFingerprint")
      artifactDigest = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "artifactDigest")
      safeReceiptDigest = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "safeReceiptDigest")
      reportCardDigest = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "reportCardDigest")
      operatorReceiptDigest = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "operatorReceiptDigest")
      privacyLintDigest = [string](Get-ObjectProperty -ObjectValue $Snapshot -Name "privacyLintDigest")
    }
    reasonCodes = @("SNAPSHOT_REFERENCE_LOCAL_ONLY")
  }
  $snapshotCore = [ordered]@{
    schema = $body.schema
    schemaVersion = $body.schemaVersion
    targetKey = $body.targetKey
    runId = $body.runId
    identity = $body.identity
    reasonCodes = $body.reasonCodes
  }
  $body.snapshotDigest = Compute-TextSha256Digest -TextValue (($snapshotCore | ConvertTo-Json -Depth 8) + "`n")
  return $body
}

function Ensure-LatestSnapshotReferenceForTarget {
  param(
    [string]$TargetDir,
    [string]$TargetKey,
    [string]$RunId
  )
  $out = [ordered]@{
    ok = $false
    wroteLatest = $false
    wroteRunRef = $false
    latestPath = ""
    runPath = ""
  }
  if (-not $TargetDir -or -not $TargetKey -or -not $RunId -or $RunId -eq "-") { return $out }
  if (-not (Test-Path -LiteralPath $TargetDir)) { return $out }

  $snapshot = Read-RunEvidenceSnapshot -TargetDir $TargetDir -RunId $RunId
  $reference = New-SnapshotReferenceFromHistoryRow -TargetKey $TargetKey -Snapshot $snapshot
  $text = (($reference | ConvertTo-Json -Depth 10) + "`n")
  $safeKey = Get-SnapshotTargetToken -TargetKey $TargetKey
  $bucketDir = Ensure-SnapshotBucketDir -TargetKey $TargetKey
  $runPath = Join-Path $bucketDir ("snapshot_ref_{0}_{1}.json" -f $safeKey, $RunId)
  $latestPath = Join-Path $bucketDir "snapshot_ref_latest.json"
  $out.latestPath = $latestPath
  $out.runPath = $runPath

  $existingRunText = ""
  if (Test-Path -LiteralPath $runPath) {
    try { $existingRunText = [string](Get-Content -LiteralPath $runPath -Raw -Encoding UTF8) } catch { $existingRunText = "" }
  }
  if ($existingRunText -ne $text) {
    Write-TextFileAtomic -PathValue $runPath -TextValue $text
    $out.wroteRunRef = $true
  }

  $existingLatestText = ""
  if (Test-Path -LiteralPath $latestPath) {
    try { $existingLatestText = [string](Get-Content -LiteralPath $latestPath -Raw -Encoding UTF8) } catch { $existingLatestText = "" }
  }
  if ($existingLatestText -ne $text) {
    Write-TextFileAtomic -PathValue $latestPath -TextValue $text
    $out.wroteLatest = $true
  }

  $out.ok = $true
  return $out
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

function Get-NormalizedBucketList {
  param([object]$Value)
  $items = @()
  foreach ($entry in @($Value)) {
    if ($null -eq $entry) { continue }
    $text = ([string]$entry).Trim()
    if ($text -eq "") { continue }
    if ($items -contains $text) { continue }
    $items += $text
  }
  if ($items.Count -gt 1) {
    [System.Array]::Sort($items, [System.StringComparer]::Ordinal)
  }
  return $items
}

function Read-CompareFallbackFromReportText {
  param([string]$TextValue)
  $out = @{
    verdict = "-"
    buckets = "-"
    bucketCount = "-"
  }
  if (-not $TextValue -or $TextValue.Trim() -eq "") { return $out }
  $lines = @([string]$TextValue -split "`r?`n")
  foreach ($lineObj in $lines) {
    $line = ([string]$lineObj).Trim()
    if ($line -eq "") { continue }
    if ($out.verdict -eq "-" -and $line.StartsWith("verdict=")) {
      $token = $line.Substring("verdict=".Length).Trim()
      if ($token -match "^([A-Za-z0-9_]+)") {
        $candidate = [string]$matches[1]
        if ($candidate -eq "SAME" -or $candidate -eq "CHANGED") { $out.verdict = $candidate }
      }
      continue
    }
    if ($out.verdict -eq "-" -and $line.StartsWith("COMPARE ")) {
      $token = $line.Substring("COMPARE ".Length).Trim()
      if ($token -match "^([A-Za-z0-9_]+)") {
        $candidate = [string]$matches[1]
        if ($candidate -eq "SAME" -or $candidate -eq "CHANGED") { $out.verdict = $candidate }
      }
      continue
    }
    if ($out.buckets -eq "-" -and $line.StartsWith("buckets=")) {
      $payload = $line.Substring("buckets=".Length).Trim()
      $match = [System.Text.RegularExpressions.Regex]::Match($payload, "^([0-9]+)\s*\((.*)\)$")
      if (-not $match.Success) { continue }
      $countValue = [int]$match.Groups[1].Value
      $bucketBody = [string]$match.Groups[2].Value
      $bucketList = @()
      if ($bucketBody -and $bucketBody.Trim() -ne "-" -and $bucketBody.Trim() -ne "") {
        $bucketList = Get-NormalizedBucketList -Value ($bucketBody -split ",")
      }
      $out.buckets = if ($bucketList.Count -gt 0) { $bucketList -join "," } else { "-" }
      $out.bucketCount = [string]$countValue
      continue
    }
  }
  if ($out.bucketCount -eq "-" -and $out.buckets -ne "-") {
    $parts = @($out.buckets -split ",")
    $out.bucketCount = [string]$parts.Count
  }
  return $out
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
    privacyLintDigest = "-"
    safeReceiptDigest = "-"
    operatorReceiptDigest = "-"
    compareReceiptDigest = "-"
    compareReportDigest = "-"
    compareVerdict = "-"
    compareBuckets = "-"
    compareBucketCount = "-"
    compareChangeCount = "-"
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
  $privacyLintPath = Join-Path (Join-Path $runDir "weftend") "privacy_lint_v0.json"
  $reportCardJsonPath = Join-Path $runDir "report_card_v0.json"
  $reportCardTxtPath = Join-Path $runDir "report_card.txt"
  if (Test-Path -LiteralPath $reportCardJsonPath) {
    $out.reportCardDigest = Compute-FileSha256Digest -PathValue $reportCardJsonPath
  } else {
    $out.reportCardDigest = Compute-FileSha256Digest -PathValue $reportCardTxtPath
  }
  $out.safeReceiptDigest = Compute-FileSha256Digest -PathValue $safeReceiptPath
  $out.privacyLintDigest = Compute-FileSha256Digest -PathValue $privacyLintPath
  $out.operatorReceiptDigest = Compute-FileSha256Digest -PathValue $operatorReceiptPath
  $out.compareReceiptDigest = Compute-FileSha256Digest -PathValue $compareReceiptPath
  $out.compareReportDigest = Compute-FileSha256Digest -PathValue $compareReportPath
  if (Test-Path -LiteralPath $compareReceiptPath) {
    try {
      $compareObj = Get-Content -LiteralPath $compareReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $compareVerdict = [string](Get-ObjectProperty -ObjectValue $compareObj -Name "verdict")
      if ($compareVerdict -eq "SAME" -or $compareVerdict -eq "CHANGED") { $out.compareVerdict = $compareVerdict }
      $bucketList = Get-NormalizedBucketList -Value (Get-ObjectProperty -ObjectValue $compareObj -Name "changeBuckets")
      $out.compareBuckets = if ($bucketList.Count -gt 0) { $bucketList -join "," } else { "-" }
      $out.compareBucketCount = [string]$bucketList.Count
      $changes = Get-ObjectProperty -ObjectValue $compareObj -Name "changes"
      if ($changes -is [System.Array]) {
        $out.compareChangeCount = [string]$changes.Count
      }
    } catch {
      # best effort only
    }
  }
  if (($out.compareVerdict -eq "-" -or $out.compareBuckets -eq "-" -or $out.compareBucketCount -eq "-") -and (Test-Path -LiteralPath $compareReportPath)) {
    try {
      $fallback = Read-CompareFallbackFromReportText -TextValue (Get-Content -LiteralPath $compareReportPath -Raw -Encoding UTF8)
      if ($out.compareVerdict -eq "-" -and $fallback.verdict -and $fallback.verdict -ne "-") { $out.compareVerdict = [string]$fallback.verdict }
      if ($out.compareBuckets -eq "-" -and $fallback.buckets -and $fallback.buckets -ne "-") { $out.compareBuckets = [string]$fallback.buckets }
      if ($out.compareBucketCount -eq "-" -and $fallback.bucketCount -and $fallback.bucketCount -ne "-") { $out.compareBucketCount = [string]$fallback.bucketCount }
    } catch {
      # best effort only
    }
  }
  if ($out.compareChangeCount -eq "-" -and $out.compareBucketCount -ne "-") {
    $out.compareChangeCount = [string]$out.compareBucketCount
  }
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

function Get-HistoryKindLabel {
  param(
    [string]$TargetKind,
    [string]$ArtifactKind
  )
  $target = if ($TargetKind) { [string]$TargetKind } else { "" }
  $artifact = if ($ArtifactKind) { [string]$ArtifactKind } else { "" }
  $targetNorm = $target.ToLowerInvariant()
  $artifactNorm = $artifact.ToLowerInvariant()

  if ($targetNorm -eq "directory") { return "folder" }
  if ($targetNorm -eq "nativebinary") { return "native" }
  if ($targetNorm -eq "shortcut") { return "shortcut" }
  if ($targetNorm -eq "emailartifact") { return "email" }
  if ($artifactNorm -eq "webbundle") { return "web" }
  if ($artifactNorm -and $artifactNorm -ne "unknown") { return $artifact }
  if ($targetNorm -and $targetNorm -ne "unknown") { return $target }
  return "-"
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
    kind = "-"
    targetKind = "-"
    artifactKind = "-"
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
      $targetKind = [string](Get-ObjectProperty -ObjectValue $obj -Name "targetKind")
      $artifactKind = [string](Get-ObjectProperty -ObjectValue $obj -Name "artifactKind")
      if ($status -and $status.Trim() -ne "") { $out.status = $status }
      if ($baseline -and $baseline.Trim() -ne "") { $out.baseline = $baseline }
      if ($buckets -and $buckets.Trim() -ne "") { $out.buckets = $buckets }
      if ($targetKind -and $targetKind.Trim() -ne "") { $out.targetKind = $targetKind }
      if ($artifactKind -and $artifactKind.Trim() -ne "") { $out.artifactKind = $artifactKind }
      $out.kind = Get-HistoryKindLabel -TargetKind $out.targetKind -ArtifactKind $out.artifactKind
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
        } elseif ($line.StartsWith("classification=target:")) {
          $m = [System.Text.RegularExpressions.Regex]::Match($line, "classification=target:([^\s]+)\s+artifact:([^\s]+)")
          if ($m.Success -and $m.Groups.Count -gt 2) {
            $targetValue = [string]$m.Groups[1].Value
            $artifactValue = [string]$m.Groups[2].Value
            if ($targetValue -and $targetValue.Trim() -ne "") { $out.targetKind = $targetValue }
            if ($artifactValue -and $artifactValue.Trim() -ne "") { $out.artifactKind = $artifactValue }
          }
        }
      }
    } catch {
      # best effort only
    }
  }
  $out.kind = Get-HistoryKindLabel -TargetKind $out.targetKind -ArtifactKind $out.artifactKind
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
      kind = $reportFallback.kind
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
    $kind = "-"
    if ($latest -and $latest -ne "-") {
      $reportKind = Read-ReportCardSummaryForRun -TargetDir $TargetDir -RunId $latest
      if ($reportKind -and $reportKind.kind) { $kind = [string]$reportKind.kind }
    }
    return @{
      status = $status
      baseline = $baseline
      latest = $latest
      buckets = $buckets
      adapter = (Read-AdapterTagForRun -TargetDir $TargetDir -RunId $latest)
      kind = $kind
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
      kind = $reportFallback.kind
    }
  }
}

function Get-HistoryDetailToken {
  param(
    [object]$Value,
    [string]$MissingToken = "NOT_REPORTED"
  )
  $s = ""
  if ($null -ne $Value) { $s = [string]$Value }
  if (-not $s -or $s.Trim() -eq "" -or $s -eq "-") { return $MissingToken }
  return $s
}

function Get-AutoRefreshStateToken {
  $chk = $null
  try {
    $chk = Get-Variable -Name chkAuto -Scope Script -ValueOnly -ErrorAction Stop
  } catch {
    return "UNKNOWN"
  }
  if ($chk -and $chk.Checked) { return "ON" }
  return "OFF"
}

function Update-HistoryDetailsBox {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.TextBox]$DetailBox
  )
  if (-not $DetailBox) { return }
  $autoRefreshState = Get-AutoRefreshStateToken
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    $DetailBox.Text = ("Select a history row to view adapter evidence and capability summary." + [Environment]::NewLine + "Auto Refresh: " + $autoRefreshState + [Environment]::NewLine + "Tip: use Import Snapshot or drag .json files here to import into a target bucket.")
    return
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $targetKey = [string]$row.targetKey
  $latestRun = [string]$row.latestRun
  $latestRunDisplay = $latestRun
  $status = if ($selected.SubItems.Count -gt 1) { [string]$selected.SubItems[1].Text } else { "UNKNOWN" }
  $adapterTag = if ($selected.SubItems.Count -gt 2) { [string]$selected.SubItems[2].Text } else { "NOT_REPORTED" }
  $baseline = if ($selected.SubItems.Count -gt 3) { [string]$selected.SubItems[3].Text } else { "NONE" }
  $buckets = if ($selected.SubItems.Count -gt 5) { [string]$selected.SubItems[5].Text } else { "NONE" }
  $kind = if ($selected.SubItems.Count -gt 6) { [string]$selected.SubItems[6].Text } else { "NOT_REPORTED" }
  if (-not $adapterTag -or $adapterTag.Trim() -eq "" -or $adapterTag -eq "-") { $adapterTag = "NOT_REPORTED" }
  if (-not $baseline -or $baseline.Trim() -eq "" -or $baseline -eq "-") { $baseline = "NONE" }
  if (-not $buckets -or $buckets.Trim() -eq "" -or $buckets -eq "-") { $buckets = "NONE" }
  if (-not $kind -or $kind.Trim() -eq "" -or $kind -eq "-") { $kind = "NOT_REPORTED" }
  if (-not $latestRunDisplay -or $latestRunDisplay.Trim() -eq "" -or $latestRunDisplay -eq "-") { $latestRunDisplay = "LATEST_UNAVAILABLE" }
  $snapshotBindingState = "NONE"
  if (Test-SnapshotBindingForTarget -TargetKey $targetKey) { $snapshotBindingState = "PRESENT" }
  $snapshotBucketCount = 0
  if ($targetKey -and $targetKey.Trim() -ne "") {
    $bucketDir = Get-SnapshotBucketDir -TargetKey $targetKey
    if (Test-Path -LiteralPath $bucketDir) {
      $snapshotBucketCount = @(
        Get-ChildItem -LiteralPath $bucketDir -Filter *.json -File -ErrorAction SilentlyContinue
      ).Count
    }
  }

  $lines = @(
    "Target: " + $targetKey,
    "Status: " + $status,
    "Kind: " + $kind,
    "Adapter Tag: " + $adapterTag,
    "Baseline: " + $baseline,
    "Latest: " + $latestRunDisplay,
    "Buckets: " + $buckets,
    "Snapshot Binding: " + $snapshotBindingState,
    "Snapshot Bucket: " + [string]$snapshotBucketCount + " file(s)"
  )

  if ($targetDir -and $latestRun -and $latestRun -ne "-") {
    $snapshot = Read-RunEvidenceSnapshot -TargetDir $targetDir -RunId $latestRun
    $snapshotGate = Get-SnapshotGateStateForRun -TargetKey $targetKey -Snapshot $snapshot
    $lines += ""
    $lines += "RunId: " + (Get-HistoryDetailToken -Value $snapshot.runId -MissingToken "LATEST_UNAVAILABLE")
    $lines += "Artifact Fingerprint: " + (Get-HistoryDetailToken -Value $snapshot.artifactFingerprint -MissingToken "NOT_REPORTED")
    $lines += "Artifact Digest: " + (Get-HistoryDetailToken -Value $snapshot.artifactDigest -MissingToken "NOT_REPORTED")
    $lines += "Report Card Digest: " + (Get-HistoryDetailToken -Value $snapshot.reportCardDigest -MissingToken "NOT_AVAILABLE")
    $lines += "Safe Receipt Digest: " + (Get-HistoryDetailToken -Value $snapshot.safeReceiptDigest -MissingToken "NOT_AVAILABLE")
    $lines += "Privacy Lint Digest: " + (Get-HistoryDetailToken -Value $snapshot.privacyLintDigest -MissingToken "NOT_AVAILABLE")
    $lines += "Operator Receipt Digest: " + (Get-HistoryDetailToken -Value $snapshot.operatorReceiptDigest -MissingToken "NOT_AVAILABLE")
    $lines += "Compare Receipt Digest: " + (Get-HistoryDetailToken -Value $snapshot.compareReceiptDigest -MissingToken "NOT_APPLICABLE")
    $lines += "Compare Report Digest: " + (Get-HistoryDetailToken -Value $snapshot.compareReportDigest -MissingToken "NOT_APPLICABLE")
    $lines += "Compare Verdict: " + (Get-HistoryDetailToken -Value $snapshot.compareVerdict -MissingToken "NOT_APPLICABLE")
    $lines += "Compare Buckets: " + (Get-HistoryDetailToken -Value $snapshot.compareBuckets -MissingToken "NONE")
    $lines += "Compare Bucket Count: " + (Get-HistoryDetailToken -Value $snapshot.compareBucketCount -MissingToken "NOT_APPLICABLE")
    $lines += "Compare Change Count: " + (Get-HistoryDetailToken -Value $snapshot.compareChangeCount -MissingToken "NOT_APPLICABLE")
    $lines += "Snapshot Gate: " + [string](Get-ObjectProperty -ObjectValue $snapshotGate -Name "state") + " (" + [string](Get-ObjectProperty -ObjectValue $snapshotGate -Name "reason") + ")"
    $lines += "Snapshot Gate Match: " + [string](Get-ObjectProperty -ObjectValue $snapshotGate -Name "matchCount") + "/" + [string](Get-ObjectProperty -ObjectValue $snapshotGate -Name "checkedCount")

    $ev = Read-AdapterEvidenceForRun -TargetDir $targetDir -RunId $latestRun
    if ($ev.available) {
      $lines += ""
      $lines += "Adapter Class: " + (Get-HistoryDetailToken -Value $ev.adapterClass -MissingToken "NOT_REPORTED")
      $lines += "Adapter Id: " + (Get-HistoryDetailToken -Value $ev.adapterId -MissingToken "NOT_REPORTED")
      $lines += "Adapter Mode: " + (Get-HistoryDetailToken -Value $ev.adapterMode -MissingToken "NOT_REPORTED")
      $lines += "Source Format: " + (Get-HistoryDetailToken -Value $ev.sourceFormat -MissingToken "NOT_REPORTED")
      $lines += "Adapter Reasons: " + (Get-HistoryDetailToken -Value $ev.reasons -MissingToken "NONE")
      $lines += "Capabilities: requested=" + (Get-HistoryDetailToken -Value $ev.requested -MissingToken "0") + " granted=" + (Get-HistoryDetailToken -Value $ev.granted -MissingToken "0") + " denied=" + (Get-HistoryDetailToken -Value $ev.denied -MissingToken "0")
    } else {
      $lines += ""
      $lines += "Adapter evidence: NOT_AVAILABLE for latest run."
    }
  } else {
    $lines += ""
    $lines += "Snapshot Gate: UNCHECKED (LATEST_UNAVAILABLE)."
    $lines += "Adapter evidence: LATEST_UNAVAILABLE."
  }

  $lines += ""
  $lines += "Tip: Use View Report for full run details."
  $DetailBox.Text = ($lines -join [Environment]::NewLine)
}

function Update-HistoryActionButtons {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Button]$RunButton,
    [System.Windows.Forms.Button]$EvidenceButton,
    [System.Windows.Forms.Button]$SnapshotExportButton,
    [System.Windows.Forms.Button]$SnapshotCompareButton,
    [System.Windows.Forms.Button]$SnapshotTrustButton,
    [System.Windows.Forms.Button]$SnapshotOpenBindingButton,
    [System.Windows.Forms.Button]$SnapshotRemoveBindingButton,
    [System.Windows.Forms.Button]$SnapshotBucketButton,
    [System.Windows.Forms.Button]$SnapshotImportButton
  )
  if ($RunButton) { $RunButton.Enabled = $false }
  if ($EvidenceButton) { $EvidenceButton.Enabled = $false }
  if ($SnapshotExportButton) { $SnapshotExportButton.Enabled = $false }
  if ($SnapshotCompareButton) { $SnapshotCompareButton.Enabled = $false }
  if ($SnapshotTrustButton) { $SnapshotTrustButton.Enabled = $false }
  if ($SnapshotOpenBindingButton) { $SnapshotOpenBindingButton.Enabled = $false }
  if ($SnapshotRemoveBindingButton) { $SnapshotRemoveBindingButton.Enabled = $false }
  if ($SnapshotBucketButton) { $SnapshotBucketButton.Enabled = $false }
  if ($SnapshotImportButton) { $SnapshotImportButton.Enabled = $false }
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) { return }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $latestRun = [string]$row.latestRun
  if ($RunButton -and $targetDir -and (Test-Path -LiteralPath $targetDir)) {
    $RunButton.Enabled = $true
  }
  if ($EvidenceButton -and $targetDir -and $latestRun -and $latestRun -ne "-") {
    $analysisPath = Join-Path (Join-Path $targetDir $latestRun) "analysis"
    if (Test-Path -LiteralPath $analysisPath) {
      $EvidenceButton.Enabled = $true
    }
  }
  $hasLatest = ($targetDir -and (Test-Path -LiteralPath $targetDir) -and $latestRun -and $latestRun -ne "-")
  if ($hasLatest) {
    if ($SnapshotExportButton) { $SnapshotExportButton.Enabled = $true }
    if ($SnapshotCompareButton) { $SnapshotCompareButton.Enabled = $true }
    if ($SnapshotTrustButton) { $SnapshotTrustButton.Enabled = $true }
    if ($SnapshotBucketButton) { $SnapshotBucketButton.Enabled = $true }
    if ($SnapshotImportButton) { $SnapshotImportButton.Enabled = $true }
  }
  $targetKey = [string]$row.targetKey
  $hasBinding = Test-SnapshotBindingForTarget -TargetKey $targetKey
  if ($hasBinding) {
    if ($SnapshotOpenBindingButton) { $SnapshotOpenBindingButton.Enabled = $true }
    if ($SnapshotRemoveBindingButton) { $SnapshotRemoveBindingButton.Enabled = $true }
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
      "Privacy Lint Digest:",
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
  $selectedTargetKey = ""
  if ($ListView.SelectedItems.Count -gt 0) {
    $selectedItem = $ListView.SelectedItems[0]
    $selectedTag = $selectedItem.Tag
    if ($selectedTag -and $selectedTag.targetKey) {
      $selectedTargetKey = [string]$selectedTag.targetKey
    } else {
      $selectedTargetKey = [string]$selectedItem.Text
    }
  }
  $ListView.BeginUpdate()
  $ListView.Items.Clear()

  $dirs = @(
    Get-ChildItem -LiteralPath $libraryRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne "Launchpad" } |
      Sort-Object @{ Expression = { Get-StableSortKey -Value $_.Name } }
  )
  foreach ($dir in $dirs) {
    $s = Read-ViewStateSummary -TargetDir $dir.FullName
    $item = New-Object System.Windows.Forms.ListViewItem($dir.Name)
    [void]$item.SubItems.Add($s.status)
    [void]$item.SubItems.Add($s.adapter)
    [void]$item.SubItems.Add($s.baseline)
    [void]$item.SubItems.Add($s.latest)
    [void]$item.SubItems.Add($s.buckets)
    [void]$item.SubItems.Add($s.kind)
    $item.Tag = [PSCustomObject]@{
      targetDir = $dir.FullName
      targetKey = $dir.Name
      latestRun = $s.latest
    }
    [void]$ListView.Items.Add($item)
  }

  if ($selectedTargetKey -and $selectedTargetKey.Trim() -ne "") {
    foreach ($candidateObj in @($ListView.Items)) {
      $candidate = [System.Windows.Forms.ListViewItem]$candidateObj
      if (-not $candidate) { continue }
      $candidateTag = $candidate.Tag
      $candidateKey = if ($candidateTag -and $candidateTag.targetKey) { [string]$candidateTag.targetKey } else { [string]$candidate.Text }
      if ($candidateKey -and $candidateKey -eq $selectedTargetKey) {
        $candidate.Selected = $true
        $candidate.Focused = $true
        $candidate.EnsureVisible()
        break
      }
    }
  }

  $ListView.EndUpdate()
  return $dirs.Count
}

function Sync-HistoryRowSnapshot {
  param([System.Windows.Forms.ListViewItem]$Item)

  $out = @{
    targetDir = ""
    targetKey = ""
    latestRun = "-"
  }
  if (-not $Item) { return $out }

  $meta = $Item.Tag
  $targetDir = if ($meta -and $meta.targetDir) { [string]$meta.targetDir } else { "" }
  $targetKey = if ($meta -and $meta.targetKey) { [string]$meta.targetKey } else { [string]$Item.Text }
  $latestRun = if ($meta -and $meta.latestRun) { [string]$meta.latestRun } else { "-" }

  $out.targetDir = $targetDir
  $out.targetKey = $targetKey
  $out.latestRun = $latestRun

  if (-not $targetDir -or -not (Test-Path -LiteralPath $targetDir)) {
    return $out
  }

  try {
    $s = Read-ViewStateSummary -TargetDir $targetDir
    if ($s) {
      if ($Item.SubItems.Count -gt 1) { $Item.SubItems[1].Text = [string]$s.status }
      if ($Item.SubItems.Count -gt 2) { $Item.SubItems[2].Text = [string]$s.adapter }
      if ($Item.SubItems.Count -gt 3) { $Item.SubItems[3].Text = [string]$s.baseline }
      if ($Item.SubItems.Count -gt 4) { $Item.SubItems[4].Text = [string]$s.latest }
      if ($Item.SubItems.Count -gt 5) { $Item.SubItems[5].Text = [string]$s.buckets }
      if ($Item.SubItems.Count -gt 6) { $Item.SubItems[6].Text = [string]$s.kind }
      if (-not $meta) {
        $meta = [PSCustomObject]@{
          targetDir = $targetDir
          targetKey = $targetKey
          latestRun = "-"
        }
        $Item.Tag = $meta
      }
      if ($meta) {
        $meta.latestRun = if ($s.latest) { [string]$s.latest } else { "-" }
      }
      $out.latestRun = if ($s.latest) { [string]$s.latest } else { "-" }
      if ($out.latestRun -and $out.latestRun -ne "-" -and $targetKey -and $targetKey.Trim() -ne "") {
        [void](Ensure-LatestSnapshotReferenceForTarget -TargetDir $targetDir -TargetKey $targetKey -RunId $out.latestRun)
      }
    }
  } catch {
    # best effort only; keep cached row values
  }

  return $out
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
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $targetKey = [string]$row.targetKey
  $latestRun = [string]$row.latestRun
  if (-not $targetDir -or -not (Test-Path -LiteralPath $targetDir)) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Target history folder missing." -IsError $true
    return
  }
  if (-not $reportViewerScript -or -not (Test-Path -LiteralPath $reportViewerScript)) {
    Write-LaunchpadUiError -Code "HISTORY_REPORT_VIEWER_SCRIPT_MISSING"
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $targetDir | Out-Null
    Set-StatusLine -StatusLabel $StatusLabel -Message "Viewer missing. Opened target history folder. (HISTORY_REPORT_VIEWER_SCRIPT_MISSING)" -IsError $true
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
      Write-LaunchpadUiError -Code "HISTORY_REPORT_VIEWER_START_NONZERO"
      $explorerPath = Join-Path $env:WINDIR "explorer.exe"
      if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
      Start-Process -FilePath $explorerPath -ArgumentList $targetDir | Out-Null
      Set-StatusLine -StatusLabel $StatusLabel -Message "Viewer failed to start. Opened target history folder. (HISTORY_REPORT_VIEWER_START_NONZERO)" -IsError $true
      return
    }
    try {
      Set-ItemProperty -Path $configPath -Name "UseReportViewer" -Value "1" -ErrorAction Stop
      Set-ItemProperty -Path $configPath -Name "ReportViewerAutoOpen" -Value "1" -ErrorAction Stop
      Set-ItemProperty -Path $configPath -Name "ReportViewerStartFailCount" -Value "0" -ErrorAction Stop
    } catch {
      # best effort only
    }
    $statusText = if ($latestRun -and $latestRun -ne "-") { "Opened report: " + $targetKey + " / " + $latestRun } else { "Opened report viewer: " + $targetKey }
    Set-StatusLine -StatusLabel $StatusLabel -Message $statusText -IsError $false
  } catch {
    Write-LaunchpadUiError -Code "HISTORY_OPEN_REPORT_FAILED"
    $fallbackPath = if ($runDir -and (Test-Path -LiteralPath $runDir)) { $runDir } else { $targetDir }
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $fallbackPath | Out-Null
    Set-StatusLine -StatusLabel $StatusLabel -Message "Failed to open report viewer. Opened fallback folder. (HISTORY_OPEN_REPORT_FAILED)" -IsError $true
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
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $latestRun = [string]$row.latestRun
  $targetKey = [string]$row.targetKey
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
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $latestRun = [string]$row.latestRun
  $targetKey = [string]$row.targetKey
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

function Write-SnapshotActionRecord {
  param(
    [string]$ActionType,
    [string]$TargetKey,
    [string]$RunId,
    [hashtable]$CompareResult,
    [hashtable]$Reference
  )
  Ensure-SnapshotTrustStore
  $actionsDir = Get-SnapshotActionsDir
  $targetToken = if ($TargetKey) { ([string]$TargetKey -replace "[^A-Za-z0-9_]+", "_").Trim("_") } else { "target" }
  if (-not $targetToken -or $targetToken -eq "") { $targetToken = "target" }
  $runToken = if ($RunId) { ([string]$RunId -replace "[^A-Za-z0-9_]+", "_").Trim("_") } else { "run" }
  if (-not $runToken -or $runToken -eq "") { $runToken = "run" }
  $fileName = ("{0}_{1}_{2}.json" -f $ActionType, $targetToken, $runToken)
  $outPath = Join-Path $actionsDir $fileName
  $record = [ordered]@{
    schema = "weftend.snapshotAction/0"
    schemaVersion = 0
    action = [string]$ActionType
    targetKey = [string]$TargetKey
    runId = [string]$RunId
    referenceFileDigest = if ($Reference) { [string](Get-ObjectProperty -ObjectValue $Reference -Name "fileDigest") } else { "-" }
    referenceSnapshotDigest = if ($Reference) { [string](Get-ObjectProperty -ObjectValue $Reference -Name "snapshotDigest") } else { "-" }
    verdict = if ($CompareResult) { [string](Get-ObjectProperty -ObjectValue $CompareResult -Name "verdict") } else { "-" }
    reasonCodes = if ($CompareResult) { @(Get-ObjectProperty -ObjectValue $CompareResult -Name "reasonCodes") } else { @() }
    matchFields = if ($CompareResult) { @(Get-ObjectProperty -ObjectValue $CompareResult -Name "matchFields") } else { @() }
    mismatchFields = if ($CompareResult) { @(Get-ObjectProperty -ObjectValue $CompareResult -Name "mismatchFields") } else { @() }
  }
  Write-TextFileAtomic -PathValue $outPath -TextValue (($record | ConvertTo-Json -Depth 10) + "`n")
}

function Select-SnapshotReferencePath {
  param([string]$TargetKey)
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Select Snapshot Reference"
  $dialog.Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*"
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  if ($TargetKey -and $TargetKey.Trim() -ne "") {
    $bucketDir = Ensure-SnapshotBucketDir -TargetKey $TargetKey
    if ($bucketDir -and (Test-Path -LiteralPath $bucketDir)) {
      $dialog.InitialDirectory = $bucketDir
      $latestRef = Join-Path $bucketDir "snapshot_ref_latest.json"
      if (Test-Path -LiteralPath $latestRef) {
        $dialog.FileName = "snapshot_ref_latest.json"
      }
    }
  }
  $res = $dialog.ShowDialog()
  if ($res -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return [string]$dialog.FileName
}

function Export-HistorySnapshotReference {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $targetKey = [string]$row.targetKey
  $latestRun = [string]$row.latestRun
  if (-not $targetDir -or -not $latestRun -or $latestRun -eq "-") {
    Set-StatusLine -StatusLabel $StatusLabel -Message "No latest run available to export snapshot." -IsError $true
    return
  }
  $snapshot = Read-RunEvidenceSnapshot -TargetDir $targetDir -RunId $latestRun
  $reference = New-SnapshotReferenceFromHistoryRow -TargetKey $targetKey -Snapshot $snapshot
  $safeKey = Get-SnapshotTargetToken -TargetKey $targetKey
  $bucketDir = Ensure-SnapshotBucketDir -TargetKey $targetKey
  $outPath = Join-Path $bucketDir ("snapshot_ref_{0}_{1}.json" -f $safeKey, $latestRun)
  $latestPath = Join-Path $bucketDir "snapshot_ref_latest.json"
  try {
    $text = (($reference | ConvertTo-Json -Depth 10) + "`n")
    Write-TextFileAtomic -PathValue $outPath -TextValue $text
    Write-TextFileAtomic -PathValue $latestPath -TextValue $text
    Set-StatusLine -StatusLabel $StatusLabel -Message ("Snapshot exported to bucket: " + [System.IO.Path]::GetFileName($outPath)) -IsError $false
  } catch {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Snapshot export failed." -IsError $true
  }
}

function Invoke-HistorySnapshotCompareCore {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return $null
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetDir = [string]$row.targetDir
  $targetKey = [string]$row.targetKey
  $latestRun = [string]$row.latestRun
  if (-not $targetDir -or -not $latestRun -or $latestRun -eq "-") {
    Set-StatusLine -StatusLabel $StatusLabel -Message "No latest run available for snapshot compare." -IsError $true
    return $null
  }
  $refSource = "picker"
  $refPath = Get-SnapshotLatestReferencePath -TargetKey $targetKey
  if ($refPath) {
    $refSource = "bucket_latest"
  } else {
    $refPath = Select-SnapshotReferencePath -TargetKey $targetKey
    if (-not $refPath) {
      Set-StatusLine -StatusLabel $StatusLabel -Message "Snapshot compare cancelled." -IsError $true
      return $null
    }
  }
  $reference = Read-SnapshotReferenceFile -PathValue $refPath
  if (-not $reference) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Snapshot reference invalid (expected weftend.snapshotReference/0)." -IsError $true
    return $null
  }
  $snapshot = Read-RunEvidenceSnapshot -TargetDir $targetDir -RunId $latestRun
  $compare = Compare-SnapshotReference -LocalSnapshot $snapshot -Reference $reference
  Write-SnapshotActionRecord -ActionType "compare" -TargetKey $targetKey -RunId $latestRun -CompareResult $compare -Reference $reference
  $msg = ("Snapshot compare(" + $refSource + "): " + $targetKey + " / " + $latestRun + " => " + [string]$compare.verdict)
  if ($compare.verdict -eq "SAME") {
    Set-StatusLine -StatusLabel $StatusLabel -Message $msg -IsError $false
  } else {
    Set-StatusLine -StatusLabel $StatusLabel -Message $msg -IsError $true
  }
  return [ordered]@{
    targetDir = $targetDir
    targetKey = $targetKey
    latestRun = $latestRun
    referenceSource = $refSource
    referencePath = $refPath
    local = $snapshot
    reference = $reference
    compare = $compare
  }
}

function Compare-HistorySnapshotReference {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  [void](Invoke-HistorySnapshotCompareCore -ListView $ListView -StatusLabel $StatusLabel)
}

function CompareAndTrust-HistorySnapshotReference {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  $result = Invoke-HistorySnapshotCompareCore -ListView $ListView -StatusLabel $StatusLabel
  if (-not $result) { return }
  $compare = $result.compare
  $targetKey = [string]$result.targetKey
  $latestRun = [string]$result.latestRun
  if ([string](Get-ObjectProperty -ObjectValue $compare -Name "verdict") -ne "SAME") {
    Set-StatusLine -StatusLabel $StatusLabel -Message ("Snapshot trust blocked: " + $targetKey + " mismatch.") -IsError $true
    return
  }
  $prompt = [System.Windows.Forms.MessageBox]::Show(
    ("Trust snapshot for target '" + $targetKey + "' based on run '" + $latestRun + "'?" + [Environment]::NewLine + "This creates or replaces a local trust binding."),
    "WeftEnd Snapshot Trust",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($prompt -ne [System.Windows.Forms.DialogResult]::Yes) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Snapshot trust cancelled." -IsError $true
    return
  }
  $local = $result.local
  $reference = $result.reference
  $targetDir = [string]$result.targetDir
  $targetDirDigest = Compute-TextSha256Digest -TextValue ([string]$targetDir)
  $referenceFileDigest = [string](Get-ObjectProperty -ObjectValue $reference -Name "fileDigest")
  $bindingSeed = [string]$targetKey + "|" + [string]$referenceFileDigest + "|" + [string](Get-ObjectProperty -ObjectValue $local -Name "artifactDigest")
  $bindingId = "binding_" + ((Compute-TextSha256Digest -TextValue $bindingSeed).Replace("sha256:", "").Substring(0, 16))
  $binding = [ordered]@{
    bindingId = $bindingId
    targetKey = $targetKey
    targetDirDigest = $targetDirDigest
    referenceFileDigest = $referenceFileDigest
    snapshotDigest = [string](Get-ObjectProperty -ObjectValue $reference -Name "snapshotDigest")
    artifactFingerprint = [string](Get-ObjectProperty -ObjectValue $local -Name "artifactFingerprint")
    artifactDigest = [string](Get-ObjectProperty -ObjectValue $local -Name "artifactDigest")
    safeReceiptDigest = [string](Get-ObjectProperty -ObjectValue $local -Name "safeReceiptDigest")
    reportCardDigest = [string](Get-ObjectProperty -ObjectValue $local -Name "reportCardDigest")
  }
  $bindings = @(Read-SnapshotBindings)
  $next = @()
  foreach ($b in $bindings) {
    $key = [string](Get-ObjectProperty -ObjectValue $b -Name "targetKey")
    if ($key -and $key -eq $targetKey) { continue }
    $next += $b
  }
  $next += $binding
  Write-SnapshotBindings -Bindings $next
  Write-SnapshotActionRecord -ActionType "trust" -TargetKey $targetKey -RunId $latestRun -CompareResult $compare -Reference $reference
  Set-StatusLine -StatusLabel $StatusLabel -Message ("Trusted snapshot binding saved: " + $targetKey) -IsError $false
}

function Remove-HistorySnapshotBinding {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetKey = [string]$row.targetKey
  if (-not $targetKey -or $targetKey.Trim() -eq "") {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Target key unavailable." -IsError $true
    return
  }
  $bindings = @(Read-SnapshotBindings)
  $next = @()
  $removed = $false
  foreach ($b in $bindings) {
    $key = [string](Get-ObjectProperty -ObjectValue $b -Name "targetKey")
    if ($key -and $key -eq $targetKey) {
      $removed = $true
      continue
    }
    $next += $b
  }
  if (-not $removed) {
    Set-StatusLine -StatusLabel $StatusLabel -Message ("No snapshot binding found for " + $targetKey + ".") -IsError $true
    return
  }
  Write-SnapshotBindings -Bindings $next
  Write-SnapshotActionRecord -ActionType "unbind" -TargetKey $targetKey -RunId [string]$row.latestRun -CompareResult $null -Reference $null
  Set-StatusLine -StatusLabel $StatusLabel -Message ("Removed snapshot binding: " + $targetKey) -IsError $false
}

function Open-HistorySnapshotBinding {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetKey = [string]$row.targetKey
  $binding = $null
  foreach ($b in @(Read-SnapshotBindings)) {
    $key = [string](Get-ObjectProperty -ObjectValue $b -Name "targetKey")
    if ($key -and $key -eq $targetKey) {
      $binding = $b
      break
    }
  }
  if (-not $binding) {
    Set-StatusLine -StatusLabel $StatusLabel -Message ("No snapshot binding found for " + $targetKey + ".") -IsError $true
    return
  }
  Ensure-SnapshotTrustStore
  $targetToken = if ($targetKey) { ([string]$targetKey -replace "[^A-Za-z0-9_]+", "_").Trim("_") } else { "target" }
  if (-not $targetToken -or $targetToken -eq "") { $targetToken = "target" }
  $bindingPath = Join-Path (Get-SnapshotTrustRoot) ("binding_" + $targetToken + ".json")
  Write-TextFileAtomic -PathValue $bindingPath -TextValue (([ordered]@{
    schema = "weftend.snapshotBinding/0"
    schemaVersion = 0
    binding = $binding
  } | ConvertTo-Json -Depth 10) + "`n")
  Start-Process -FilePath $bindingPath | Out-Null
  Set-StatusLine -StatusLabel $StatusLabel -Message ("Opened snapshot binding: " + $targetKey) -IsError $false
}

function Open-HistorySnapshotBucket {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetKey = [string]$row.targetKey
  if (-not $targetKey -or $targetKey.Trim() -eq "") {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Target key unavailable." -IsError $true
    return
  }
  $bucketDir = Ensure-SnapshotBucketDir -TargetKey $targetKey
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $bucketDir | Out-Null
  Set-StatusLine -StatusLabel $StatusLabel -Message ("Opened snapshot bucket: " + $targetKey) -IsError $false
}

function Select-SnapshotImportPaths {
  param([string]$TargetKey)
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Import Snapshot References"
  $dialog.Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*"
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $true
  if ($TargetKey -and $TargetKey.Trim() -ne "") {
    $bucketDir = Ensure-SnapshotBucketDir -TargetKey $TargetKey
    if ($bucketDir -and (Test-Path -LiteralPath $bucketDir)) {
      $dialog.InitialDirectory = $bucketDir
    }
  }
  $res = $dialog.ShowDialog()
  if ($res -ne [System.Windows.Forms.DialogResult]::OK) { return @() }
  return @($dialog.FileNames)
}

function Import-SnapshotReferencesFromPaths {
  param(
    [string]$TargetKey,
    [string[]]$InputPaths
  )
  $result = [ordered]@{
    imported = 0
    skipped = 0
    invalid = 0
    latestUpdated = $false
  }
  if (-not $TargetKey -or $TargetKey.Trim() -eq "") { return $result }
  if (-not $InputPaths -or $InputPaths.Count -le 0) { return $result }
  $bucketDir = Ensure-SnapshotBucketDir -TargetKey $TargetKey
  $orderedPaths = @()
  foreach ($path in @($InputPaths)) {
    if ($null -eq $path) { continue }
    $orderedPaths += [string]$path
  }
  if ($orderedPaths.Count -gt 1) {
    [System.Array]::Sort($orderedPaths, [System.StringComparer]::Ordinal)
  }
  $latestPriority = -1
  $latestText = ""
  foreach ($path in @($orderedPaths)) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { $result.skipped++; continue }
    if ([System.IO.Directory]::Exists($path)) { $result.skipped++; continue }
    if ([string]([System.IO.Path]::GetExtension($path)).ToLowerInvariant() -ne ".json") { $result.skipped++; continue }
    $ref = Read-SnapshotReferenceFile -PathValue $path
    if (-not $ref) { $result.invalid++; continue }
    $name = [System.IO.Path]::GetFileName($path)
    if (-not $name -or $name.Trim() -eq "") { $name = ("snapshot_ref_import_{0}.json" -f $result.imported) }
    $dest = Join-Path $bucketDir $name
    $text = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    Write-TextFileAtomic -PathValue $dest -TextValue $text
    $priority = if ($name.ToLowerInvariant() -eq "snapshot_ref_latest.json") { 2 } else { 1 }
    if ($priority -gt $latestPriority) {
      $latestPriority = $priority
      $latestText = $text
    }
    $result.imported++
  }
  if ($result.imported -gt 0 -and $latestText -and $latestText.Trim() -ne "") {
    $latestPath = Join-Path $bucketDir "snapshot_ref_latest.json"
    Write-TextFileAtomic -PathValue $latestPath -TextValue $latestText
    $result.latestUpdated = $true
  }
  return $result
}

function Build-SnapshotImportStatusMessage {
  param([hashtable]$ImportResult)
  if (-not $ImportResult) { return "Snapshot import: imported=0 invalid=0 skipped=0 latest=UNCHANGED" }
  $latestState = if ([bool](Get-ObjectProperty -ObjectValue $ImportResult -Name "latestUpdated")) { "UPDATED" } else { "UNCHANGED" }
  return (
    "Snapshot import: imported=" + [string](Get-ObjectProperty -ObjectValue $ImportResult -Name "imported") +
    " invalid=" + [string](Get-ObjectProperty -ObjectValue $ImportResult -Name "invalid") +
    " skipped=" + [string](Get-ObjectProperty -ObjectValue $ImportResult -Name "skipped") +
    " latest=" + $latestState
  )
}

function Import-HistorySnapshotReferenceFiles {
  param(
    [System.Windows.Forms.ListView]$ListView,
    [System.Windows.Forms.Label]$StatusLabel
  )
  if (-not $ListView -or $ListView.SelectedItems.Count -lt 1) {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Select a history row first." -IsError $true
    return
  }
  $selected = $ListView.SelectedItems[0]
  $row = Sync-HistoryRowSnapshot -Item $selected
  $targetKey = [string]$row.targetKey
  $targetDir = [string]$row.targetDir
  $latestRun = [string]$row.latestRun
  if (-not $targetKey -or $targetKey.Trim() -eq "") {
    Set-StatusLine -StatusLabel $StatusLabel -Message "Target key unavailable." -IsError $true
    return
  }
  $localSnapshot = Ensure-LatestSnapshotReferenceForTarget -TargetDir $targetDir -TargetKey $targetKey -RunId $latestRun
  $paths = Select-SnapshotImportPaths -TargetKey $targetKey
  if (-not $paths -or $paths.Count -le 0) {
    if ($localSnapshot.ok) {
      Set-StatusLine -StatusLabel $StatusLabel -Message ("Snapshot import: using latest local run (" + $latestRun + ").") -IsError $false
    } else {
      Set-StatusLine -StatusLabel $StatusLabel -Message "Snapshot import cancelled." -IsError $true
    }
    return
  }
  $import = Import-SnapshotReferencesFromPaths -TargetKey $targetKey -InputPaths $paths
  $msg = Build-SnapshotImportStatusMessage -ImportResult $import
  if ([int]$import.imported -gt 0) {
    Set-StatusLine -StatusLabel $StatusLabel -Message $msg -IsError $false
  } else {
    Set-StatusLine -StatusLabel $StatusLabel -Message $msg -IsError $true
  }
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
$launchLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 56)))
$launchLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 34)))
$launchLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$tabLaunch.Controls.Add($launchLayout)

$launchActions = New-Object System.Windows.Forms.FlowLayoutPanel
$launchActions.Dock = "Fill"
$launchActions.FlowDirection = "LeftToRight"
$launchActions.WrapContents = $false
$launchActions.AutoScroll = $true
$launchActions.BackColor = $colorBg
$launchActions.Padding = New-Object System.Windows.Forms.Padding(0, 0, 6, 0)

$btnTargets = New-Object System.Windows.Forms.Button
$btnTargets.Text = "Open Targets"
$btnTargets.Width = 116
$btnTargets.Height = 30
Style-Button -Button $btnTargets -Primary:$false
$btnTargets.Add_Click({
  Invoke-UiSafe -Code "OPEN_TARGETS_FAILED" -StatusLabel $statusLabel -Message "Open Targets failed." -Action {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $targetsDir | Out-Null
  }
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
$launchHint.Text = "Drop apps/files into Targets, click Sync, then launch here. Right-click Scan with WeftEnd works immediately after install."

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
  Invoke-UiSafe -Code "OPEN_LIBRARY_FAILED" -StatusLabel $statusLabel -Message "Open Library failed." -Action {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $libraryRoot | Out-Null
  }
})

$btnOpenLaunchpad = New-Object System.Windows.Forms.Button
$btnOpenLaunchpad.Text = "Open Launchpad Folder"
$btnOpenLaunchpad.Height = 30
$btnOpenLaunchpad.Dock = "Fill"
Style-Button -Button $btnOpenLaunchpad -Primary:$false
$btnOpenLaunchpad.Add_Click({
  Invoke-UiSafe -Code "OPEN_LAUNCHPAD_FOLDER_FAILED" -StatusLabel $statusLabel -Message "Open Launchpad folder failed." -Action {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $launchpadRoot | Out-Null
  }
})

$btnOpenTargets2 = New-Object System.Windows.Forms.Button
$btnOpenTargets2.Text = "Open Targets Folder"
$btnOpenTargets2.Height = 30
$btnOpenTargets2.Dock = "Fill"
Style-Button -Button $btnOpenTargets2 -Primary:$false
$btnOpenTargets2.Add_Click({
  Invoke-UiSafe -Code "OPEN_TARGETS_FOLDER_FAILED" -StatusLabel $statusLabel -Message "Open Targets folder failed." -Action {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
    Start-Process -FilePath $explorerPath -ArgumentList $targetsDir | Out-Null
  }
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
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 56)))
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 132)))
$tabHistory.Controls.Add($historyLayout)

$historyActions = New-Object System.Windows.Forms.FlowLayoutPanel
$historyActions.Dock = "Fill"
$historyActions.FlowDirection = "LeftToRight"
$historyActions.WrapContents = $false
$historyActions.AutoScroll = $true
$historyActions.BackColor = $colorBg
$historyActions.Padding = New-Object System.Windows.Forms.Padding(0, 0, 6, 0)

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

$btnHistorySnapshotExport = New-Object System.Windows.Forms.Button
$btnHistorySnapshotExport.Text = "Export Snapshot"
$btnHistorySnapshotExport.Width = 114
$btnHistorySnapshotExport.Height = 30
$btnHistorySnapshotExport.Enabled = $false
Style-Button -Button $btnHistorySnapshotExport -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotExport) | Out-Null

$btnHistorySnapshotCompare = New-Object System.Windows.Forms.Button
$btnHistorySnapshotCompare.Text = "Compare Snapshot"
$btnHistorySnapshotCompare.Width = 118
$btnHistorySnapshotCompare.Height = 30
$btnHistorySnapshotCompare.Enabled = $false
Style-Button -Button $btnHistorySnapshotCompare -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotCompare) | Out-Null

$btnHistorySnapshotTrust = New-Object System.Windows.Forms.Button
$btnHistorySnapshotTrust.Text = "Compare + Trust"
$btnHistorySnapshotTrust.Width = 114
$btnHistorySnapshotTrust.Height = 30
$btnHistorySnapshotTrust.Enabled = $false
Style-Button -Button $btnHistorySnapshotTrust -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotTrust) | Out-Null

$btnHistorySnapshotOpen = New-Object System.Windows.Forms.Button
$btnHistorySnapshotOpen.Text = "Open Binding"
$btnHistorySnapshotOpen.Width = 98
$btnHistorySnapshotOpen.Height = 30
$btnHistorySnapshotOpen.Enabled = $false
Style-Button -Button $btnHistorySnapshotOpen -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotOpen) | Out-Null

$btnHistorySnapshotRemove = New-Object System.Windows.Forms.Button
$btnHistorySnapshotRemove.Text = "Remove Binding"
$btnHistorySnapshotRemove.Width = 108
$btnHistorySnapshotRemove.Height = 30
$btnHistorySnapshotRemove.Enabled = $false
Style-Button -Button $btnHistorySnapshotRemove -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotRemove) | Out-Null

$btnHistorySnapshotBucket = New-Object System.Windows.Forms.Button
$btnHistorySnapshotBucket.Text = "Open Bucket"
$btnHistorySnapshotBucket.Width = 94
$btnHistorySnapshotBucket.Height = 30
$btnHistorySnapshotBucket.Enabled = $false
Style-Button -Button $btnHistorySnapshotBucket -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotBucket) | Out-Null

$btnHistorySnapshotImport = New-Object System.Windows.Forms.Button
$btnHistorySnapshotImport.Text = "Import Snapshot"
$btnHistorySnapshotImport.Width = 106
$btnHistorySnapshotImport.Height = 30
$btnHistorySnapshotImport.Enabled = $false
Style-Button -Button $btnHistorySnapshotImport -Primary:$false
$historyActions.Controls.Add($btnHistorySnapshotImport) | Out-Null

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
$historyList.MultiSelect = $false
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
[void]$historyList.Columns.Add("Kind", 72)

$historyDetail = New-Object System.Windows.Forms.TextBox
$historyDetail.Dock = "Fill"
$historyDetail.Multiline = $true
$historyDetail.ScrollBars = "Vertical"
$historyDetail.ReadOnly = $true
$historyDetail.AllowDrop = $true
$historyDetail.BackColor = $colorPanel
$historyDetail.ForeColor = $colorText
$historyDetail.Font = $fontSmall
$historyDetail.Text = ("Select a history row to view adapter evidence and capability summary." + [Environment]::NewLine + "Auto Refresh: ON" + [Environment]::NewLine + "Tip: use Import Snapshot or drag .json files here to import into a target bucket.")

$historyLayout.Controls.Add($historyActions, 0, 0)
$historyLayout.Controls.Add($historyList, 0, 1)
$historyLayout.Controls.Add($historyDetail, 0, 2)

$doctorLayout = New-Object System.Windows.Forms.TableLayoutPanel
$doctorLayout.Dock = "Fill"
$doctorLayout.ColumnCount = 1
$doctorLayout.RowCount = 2
$doctorLayout.Padding = New-Object System.Windows.Forms.Padding(6, 8, 6, 8)
$doctorLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 64)))
$doctorLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$tabDoctor.Controls.Add($doctorLayout)

$doctorActions = New-Object System.Windows.Forms.FlowLayoutPanel
$doctorActions.Dock = "Fill"
$doctorActions.FlowDirection = "LeftToRight"
$doctorActions.WrapContents = $false
$doctorActions.AutoScroll = $true
$doctorActions.HorizontalScroll.Enabled = $true
$doctorActions.HorizontalScroll.Visible = $true
$doctorActions.VerticalScroll.Enabled = $false
$doctorActions.VerticalScroll.Visible = $false
$doctorActions.BackColor = $colorBg
$doctorActions.Padding = New-Object System.Windows.Forms.Padding(0, 0, 6, 0)

$btnDoctorRun = New-Object System.Windows.Forms.Button
$btnDoctorRun.Text = "Run Shell Doctor"
$btnDoctorRun.Width = 118
$btnDoctorRun.Height = 30
Style-Button -Button $btnDoctorRun -Primary:$false
$doctorActions.Controls.Add($btnDoctorRun) | Out-Null

$btnDoctorRepairViewer = New-Object System.Windows.Forms.Button
$btnDoctorRepairViewer.Text = "Repair Viewer"
$btnDoctorRepairViewer.Width = 110
$btnDoctorRepairViewer.Height = 30
Style-Button -Button $btnDoctorRepairViewer -Primary:$false
$doctorActions.Controls.Add($btnDoctorRepairViewer) | Out-Null

$btnDoctorRepairShortcuts = New-Object System.Windows.Forms.Button
$btnDoctorRepairShortcuts.Text = "Repair Shortcuts"
$btnDoctorRepairShortcuts.Width = 124
$btnDoctorRepairShortcuts.Height = 30
Style-Button -Button $btnDoctorRepairShortcuts -Primary:$false
$doctorActions.Controls.Add($btnDoctorRepairShortcuts) | Out-Null

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

$doctorBody = New-Object System.Windows.Forms.TableLayoutPanel
$doctorBody.Dock = "Fill"
$doctorBody.ColumnCount = 1
$doctorBody.RowCount = 2
$doctorBody.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 64)))
$doctorBody.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))

$doctorSummary = New-Object System.Windows.Forms.FlowLayoutPanel
$doctorSummary.Dock = "Fill"
$doctorSummary.FlowDirection = "LeftToRight"
$doctorSummary.WrapContents = $false
$doctorSummary.AutoScroll = $true
$doctorSummary.HorizontalScroll.Enabled = $true
$doctorSummary.HorizontalScroll.Visible = $true
$doctorSummary.VerticalScroll.Enabled = $false
$doctorSummary.VerticalScroll.Visible = $false
$doctorSummary.BackColor = $colorPanel
$doctorSummary.Padding = New-Object System.Windows.Forms.Padding(4, 2, 4, 2)

$doctorLampOverall = New-DoctorLampLabel -Name "Overall"
$doctorLampShell = New-DoctorLampLabel -Name "Shell"
$doctorLampAdapter = New-DoctorLampLabel -Name "Adapter"
$doctorLampAdapterStrict = New-DoctorLampLabel -Name "Adapter Strict"

$doctorSummary.Controls.Add($doctorLampOverall) | Out-Null
$doctorSummary.Controls.Add($doctorLampShell) | Out-Null
$doctorSummary.Controls.Add($doctorLampAdapter) | Out-Null
$doctorSummary.Controls.Add($doctorLampAdapterStrict) | Out-Null

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
$doctorBody.Controls.Add($doctorSummary, 0, 0)
$doctorBody.Controls.Add($doctorText, 0, 1)
$doctorLayout.Controls.Add($doctorBody, 0, 1)

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
  Invoke-UiSafe -Code "TOPMOST_TOGGLE_FAILED" -StatusLabel $statusLabel -Message "Topmost toggle failed." -Action {
    $form.TopMost = $chkTop.Checked
    if ($chkTop.Checked) {
      $form.Activate()
      $form.BringToFront()
      Set-StatusLine -StatusLabel $statusLabel -Message "Topmost enabled." -IsError $false
    } else {
      Set-StatusLine -StatusLabel $statusLabel -Message "Topmost disabled." -IsError $false
    }
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
  try {
    $sync = if ($Silent.IsPresent) { Invoke-LaunchpadSync -Silent } else { Invoke-LaunchpadSync }
    $count = Load-Shortcuts -Panel $listPanel
    $tracked = Load-HistoryRows -ListView $historyList
    Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
    if ($sync.ok) {
      if (-not $Silent.IsPresent) {
        $msg = "Synced. targets=" + $sync.scanned + " added=" + $sync.added + " removed=" + $sync.removed + " failed=" + $sync.failed + " visible=" + $count + " tracked=" + $tracked
        Set-StatusLine -StatusLabel $statusLabel -Message $msg -IsError $false
      }
    } else {
      $label = if ($Silent.IsPresent) { "Refresh warning: " } else { "Sync error: " }
      Set-StatusLine -StatusLabel $statusLabel -Message ($label + $sync.code) -IsError $true
    }
  } catch {
    Write-LaunchpadUiError -Code "SYNC_NOW_FAILED"
    $label = if ($Silent.IsPresent) { "Auto refresh failed." } else { "Sync failed." }
    Set-StatusLine -StatusLabel $statusLabel -Message $label -IsError $true
  }
}

$btnSync.Add_Click({
  Invoke-UiSafe -Code "SYNC_BUTTON_FAILED" -StatusLabel $statusLabel -Message "Sync failed." -Action { & $syncNow }
})
$btnSync2.Add_Click({
  Invoke-UiSafe -Code "SYNC_BUTTON_FAILED" -StatusLabel $statusLabel -Message "Sync failed." -Action { & $syncNow }
})
$btnRefresh.Add_Click({
  Invoke-UiSafe -Code "REFRESH_BUTTON_FAILED" -StatusLabel $statusLabel -Message "Refresh failed." -Action { & $syncNow -Silent }
})
$btnHistoryRefresh.Add_Click({
  Invoke-UiSafe -Code "HISTORY_REFRESH_FAILED" -StatusLabel $statusLabel -Message "History refresh failed." -Action {
    $tracked = Load-HistoryRows -ListView $historyList
    Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
    Set-StatusLine -StatusLabel $statusLabel -Message ("History refreshed. tracked=" + $tracked) -IsError $false
  }
})
$btnHistoryView.Add_Click({
  Invoke-UiSafe -Code "HISTORY_OPEN_REPORT_FAILED" -StatusLabel $statusLabel -Message "Open report failed." -Action {
    Open-ReportViewerFromHistory -ListView $historyList -StatusLabel $statusLabel
  }
})
$btnHistoryRun.Add_Click({
  Invoke-UiSafe -Code "HISTORY_OPEN_RUN_FAILED" -StatusLabel $statusLabel -Message "Open run folder failed." -Action {
    Open-HistoryRunFolder -ListView $historyList -StatusLabel $statusLabel
  }
})
$btnHistoryEvidence.Add_Click({
  Invoke-UiSafe -Code "HISTORY_OPEN_EVIDENCE_FAILED" -StatusLabel $statusLabel -Message "Open adapter evidence failed." -Action {
    Open-HistoryAdapterEvidenceFolder -ListView $historyList -StatusLabel $statusLabel
  }
})
$btnHistorySnapshotExport.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_EXPORT_FAILED" -StatusLabel $statusLabel -Message "Snapshot export failed." -Action {
    Export-HistorySnapshotReference -ListView $historyList -StatusLabel $statusLabel
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
  }
})
$btnHistorySnapshotCompare.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_COMPARE_FAILED" -StatusLabel $statusLabel -Message "Snapshot compare failed." -Action {
    Compare-HistorySnapshotReference -ListView $historyList -StatusLabel $statusLabel
  }
})
$btnHistorySnapshotTrust.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_TRUST_FAILED" -StatusLabel $statusLabel -Message "Snapshot trust action failed." -Action {
    CompareAndTrust-HistorySnapshotReference -ListView $historyList -StatusLabel $statusLabel
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
  }
})
$btnHistorySnapshotOpen.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_OPEN_FAILED" -StatusLabel $statusLabel -Message "Open snapshot binding failed." -Action {
    Open-HistorySnapshotBinding -ListView $historyList -StatusLabel $statusLabel
  }
})
$btnHistorySnapshotRemove.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_REMOVE_FAILED" -StatusLabel $statusLabel -Message "Remove snapshot binding failed." -Action {
    Remove-HistorySnapshotBinding -ListView $historyList -StatusLabel $statusLabel
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
  }
})
$btnHistorySnapshotBucket.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_BUCKET_FAILED" -StatusLabel $statusLabel -Message "Open snapshot bucket failed." -Action {
    Open-HistorySnapshotBucket -ListView $historyList -StatusLabel $statusLabel
  }
})
$btnHistorySnapshotImport.Add_Click({
  Invoke-UiSafe -Code "HISTORY_SNAPSHOT_IMPORT_FAILED" -StatusLabel $statusLabel -Message "Snapshot import failed." -Action {
    Import-HistorySnapshotReferenceFiles -ListView $historyList -StatusLabel $statusLabel
    Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
  }
})
$btnHistoryCopy.Add_Click({
  Invoke-UiSafe -Code "HISTORY_COPY_FAILED" -StatusLabel $statusLabel -Message "Copy details failed." -Action {
    Copy-HistoryDetailsText -DetailBox $historyDetail -StatusLabel $statusLabel
  }
})
$btnHistoryCopyDigests.Add_Click({
  Invoke-UiSafe -Code "HISTORY_COPY_DIGEST_FAILED" -StatusLabel $statusLabel -Message "Copy digests failed." -Action {
    Copy-HistoryDigestText -DetailBox $historyDetail -StatusLabel $statusLabel
  }
})
$historyList.Add_DoubleClick({
  Invoke-UiSafe -Code "HISTORY_OPEN_REPORT_FAILED" -StatusLabel $statusLabel -Message "Open report failed." -Action {
    Open-ReportViewerFromHistory -ListView $historyList -StatusLabel $statusLabel
  }
})
$historyList.Add_KeyDown({
  param($sender, $e)
  if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
    $e.Handled = $true
    Invoke-UiSafe -Code "HISTORY_OPEN_REPORT_FAILED" -StatusLabel $statusLabel -Message "Open report failed." -Action {
      Open-ReportViewerFromHistory -ListView $historyList -StatusLabel $statusLabel
    }
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
$historyDetail.Add_DragEnter({
  param($sender, $e)
  if ($e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
    $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy
  } else {
    $e.Effect = [System.Windows.Forms.DragDropEffects]::None
  }
})
$historyDetail.Add_DragDrop({
  param($sender, $e)
  try {
    if (-not $e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
      Set-StatusLine -StatusLabel $statusLabel -Message "Drop rejected: no files detected." -IsError $true
      return
    }
    if (-not $historyList -or $historyList.SelectedItems.Count -lt 1) {
      Set-StatusLine -StatusLabel $statusLabel -Message "Select a history row before importing snapshots." -IsError $true
      return
    }
    $selected = $historyList.SelectedItems[0]
    $row = Sync-HistoryRowSnapshot -Item $selected
    $targetKey = [string]$row.targetKey
    $paths = @($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
    $import = Import-SnapshotReferencesFromPaths -TargetKey $targetKey -InputPaths $paths
    Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
    $msg = Build-SnapshotImportStatusMessage -ImportResult $import
    if ([int]$import.imported -gt 0) {
      Set-StatusLine -StatusLabel $statusLabel -Message $msg -IsError $false
    } else {
      Set-StatusLine -StatusLabel $statusLabel -Message $msg -IsError $true
    }
  } catch {
    Write-LaunchpadUiError -Code "HISTORY_SNAPSHOT_DRAGDROP_FAILED"
    Set-StatusLine -StatusLabel $statusLabel -Message "Snapshot import failed." -IsError $true
  }
})
$historyList.Add_SelectedIndexChanged({
  Invoke-UiSafe -Code "HISTORY_SELECTION_FAILED" -StatusLabel $statusLabel -Message "History selection update failed." -Action {
    Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
    Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
  }
})
$chkAuto.Add_CheckedChanged({
  Invoke-UiSafe -Code "AUTO_REFRESH_TOGGLE_FAILED" -StatusLabel $statusLabel -Message "Auto refresh toggle failed." -Action {
    Update-HistoryDetailsBox -ListView $historyList -DetailBox $historyDetail
    $state = if ($chkAuto.Checked) { "ON" } else { "OFF" }
    Set-StatusLine -StatusLabel $statusLabel -Message ("Auto refresh " + $state + ".") -IsError $false
  }
})
$btnDoctorRun.Add_Click({
  Invoke-UiSafe -Code "DOCTOR_SHELL_RUN_FAILED" -StatusLabel $statusLabel -Message "Shell doctor action failed." -Action {
    $result = Invoke-ShellDoctorText
    $doctorText.Text = Build-ShellDoctorPanelText -Result $result -ModeToken "run"
    if ($result.ok) {
      Set-DoctorLampState -Label $doctorLampShell -Name "Shell" -State "PASS" -Detail "ok"
      Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
      Set-StatusLine -StatusLabel $statusLabel -Message "Shell doctor completed." -IsError $false
    } else {
      Set-DoctorLampState -Label $doctorLampShell -Name "Shell" -State "FAIL" -Detail ([string]$result.code)
      Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
      Set-StatusLine -StatusLabel $statusLabel -Message ("Shell doctor failed (" + [string]$result.code + ").") -IsError $true
    }
  }
})
$btnDoctorRepairViewer.Add_Click({
  Invoke-UiSafe -Code "DOCTOR_REPAIR_VIEWER_FAILED" -StatusLabel $statusLabel -Message "Viewer repair action failed." -Action {
    $result = Invoke-ShellDoctorText -RepairReportViewer
    $doctorText.Text = Build-ShellDoctorPanelText -Result $result -ModeToken "repair_viewer"
    if ($result.ok) {
      Set-DoctorLampState -Label $doctorLampShell -Name "Shell" -State "PASS" -Detail "viewer repair"
      Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
      Set-StatusLine -StatusLabel $statusLabel -Message "Viewer repair completed." -IsError $false
    } else {
      Set-DoctorLampState -Label $doctorLampShell -Name "Shell" -State "FAIL" -Detail ([string]$result.code)
      Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
      Set-StatusLine -StatusLabel $statusLabel -Message ("Viewer repair failed (" + [string]$result.code + ").") -IsError $true
    }
  }
})
$btnDoctorRepairShortcuts.Add_Click({
  Invoke-UiSafe -Code "DOCTOR_REPAIR_SHORTCUTS_FAILED" -StatusLabel $statusLabel -Message "Shortcut repair action failed." -Action {
    $result = Invoke-ShellDoctorText -RepairShortcuts
    $doctorText.Text = Build-ShellDoctorPanelText -Result $result -ModeToken "repair_shortcuts"
    if ($result.ok) {
      Set-DoctorLampState -Label $doctorLampShell -Name "Shell" -State "PASS" -Detail "shortcut repair"
      Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
      Set-StatusLine -StatusLabel $statusLabel -Message "Shortcut repair completed." -IsError $false
    } else {
      Set-DoctorLampState -Label $doctorLampShell -Name "Shell" -State "FAIL" -Detail ([string]$result.code)
      Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
      Set-StatusLine -StatusLabel $statusLabel -Message ("Shortcut repair failed (" + [string]$result.code + ").") -IsError $true
    }
  }
})
$btnAdapterDoctorRun.Add_Click({
  Invoke-UiSafe -Code "DOCTOR_ADAPTER_RUN_FAILED" -StatusLabel $statusLabel -Message "Adapter doctor action failed." -Action {
    $result = Invoke-AdapterDoctorText
    $doctorText.Text = Build-AdapterDoctorPanelText -Result $result
    $adapterLamp = Get-AdapterDoctorLampState -Result $result
    Set-DoctorLampState -Label $doctorLampAdapter -Name "Adapter" -State ([string]$adapterLamp.state) -Detail ([string]$adapterLamp.detail)
    Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
    if ($result.ok) {
      Set-StatusLine -StatusLabel $statusLabel -Message "Adapter doctor completed." -IsError $false
    } else {
      Set-StatusLine -StatusLabel $statusLabel -Message ("Adapter doctor failed (" + [string]$result.code + ").") -IsError $true
    }
  }
})
$btnAdapterDoctorStrictRun.Add_Click({
  Invoke-UiSafe -Code "DOCTOR_ADAPTER_STRICT_FAILED" -StatusLabel $statusLabel -Message "Adapter doctor strict action failed." -Action {
    $result = Invoke-AdapterDoctorText -Strict
    $doctorText.Text = Build-AdapterDoctorPanelText -Result $result -Strict
    $adapterStrictLamp = Get-AdapterDoctorLampState -Result $result -Strict
    Set-DoctorLampState -Label $doctorLampAdapterStrict -Name "Adapter Strict" -State ([string]$adapterStrictLamp.state) -Detail ([string]$adapterStrictLamp.detail)
    Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
    if ($result.ok) {
      Set-StatusLine -StatusLabel $statusLabel -Message "Adapter doctor strict check passed." -IsError $false
    } else {
      Set-StatusLine -StatusLabel $statusLabel -Message ("Adapter doctor strict check failed (" + [string]$result.code + ").") -IsError $true
    }
  }
})
$btnDoctorCopy.Add_Click({
  Invoke-UiSafe -Code "DOCTOR_COPY_FAILED" -StatusLabel $statusLabel -Message "Copy doctor output failed." -Action {
    Copy-DoctorOutputText -DoctorBox $doctorText -StatusLabel $statusLabel
  }
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
Update-HistoryActionButtons -ListView $historyList -RunButton $btnHistoryRun -EvidenceButton $btnHistoryEvidence -SnapshotExportButton $btnHistorySnapshotExport -SnapshotCompareButton $btnHistorySnapshotCompare -SnapshotTrustButton $btnHistorySnapshotTrust -SnapshotOpenBindingButton $btnHistorySnapshotOpen -SnapshotRemoveBindingButton $btnHistorySnapshotRemove -SnapshotBucketButton $btnHistorySnapshotBucket -SnapshotImportButton $btnHistorySnapshotImport
Update-DoctorOverallLamp -OverallLamp $doctorLampOverall -ShellLamp $doctorLampShell -AdapterLamp $doctorLampAdapter -AdapterStrictLamp $doctorLampAdapterStrict
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


