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

function Read-ViewStateSummary {
  param([string]$TargetDir)
  $viewPath = Join-Path $TargetDir "view\view_state.json"
  if (-not (Test-Path -LiteralPath $viewPath)) {
    return @{
      status = "UNKNOWN"
      baseline = "-"
      latest = "-"
      buckets = "-"
    }
  }
  try {
    $obj = Get-Content -LiteralPath $viewPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $status = "UNKNOWN"
    if ($obj.blocked) {
      $status = "BLOCKED"
    } elseif ($obj.lastCompare -and $obj.lastCompare.verdict) {
      $status = [string]$obj.lastCompare.verdict
    }
    $baseline = if ($obj.baselineRunId) { [string]$obj.baselineRunId } else { "-" }
    $latest = if ($obj.latestRunId) { [string]$obj.latestRunId } else { "-" }
    $buckets = "-"
    if ($obj.lastCompare -and $obj.lastCompare.buckets -is [System.Array] -and $obj.lastCompare.buckets.Count -gt 0) {
      $buckets = (($obj.lastCompare.buckets | ForEach-Object { [string]$_ }) -join ",")
    }
    return @{
      status = $status
      baseline = $baseline
      latest = $latest
      buckets = $buckets
    }
  } catch {
    return @{
      status = "UNKNOWN"
      baseline = "-"
      latest = "-"
      buckets = "-"
    }
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
    [void]$item.SubItems.Add($s.baseline)
    [void]$item.SubItems.Add($s.latest)
    [void]$item.SubItems.Add($s.buckets)
    [void]$ListView.Items.Add($item)
  }

  $ListView.EndUpdate()
  return $dirs.Count
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
$historyLayout.RowCount = 2
$historyLayout.Padding = New-Object System.Windows.Forms.Padding(6, 8, 6, 8)
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 42)))
$historyLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
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

$historyList = New-Object System.Windows.Forms.ListView
$historyList.Dock = "Fill"
$historyList.View = [System.Windows.Forms.View]::Details
$historyList.FullRowSelect = $true
$historyList.GridLines = $true
$historyList.HideSelection = $false
$historyList.BackColor = $colorPanel
$historyList.ForeColor = $colorText
[void]$historyList.Columns.Add("Target", 116)
[void]$historyList.Columns.Add("Status", 80)
[void]$historyList.Columns.Add("Baseline", 78)
[void]$historyList.Columns.Add("Latest", 78)
[void]$historyList.Columns.Add("Buckets", 88)

$historyLayout.Controls.Add($historyActions, 0, 0)
$historyLayout.Controls.Add($historyList, 0, 1)

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

$doctorText = New-Object System.Windows.Forms.TextBox
$doctorText.Dock = "Fill"
$doctorText.Multiline = $true
$doctorText.ScrollBars = "Vertical"
$doctorText.ReadOnly = $true
$doctorText.BackColor = $colorPanel
$doctorText.ForeColor = $colorText
$doctorText.Font = $fontSmall
$doctorText.Text = "Shell doctor output appears here."

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
  Set-StatusLine -StatusLabel $statusLabel -Message ("History refreshed. tracked=" + $tracked) -IsError $false
})
$btnDoctorRun.Add_Click({
  if (-not $shellDoctorScript -or -not (Test-Path -LiteralPath $shellDoctorScript)) {
    $doctorText.Text = "Shell doctor script missing."
    return
  }
  try {
    $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $shellDoctorScript 2>&1)
    $doctorText.Text = (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    Set-StatusLine -StatusLabel $statusLabel -Message "Shell doctor completed." -IsError $false
  } catch {
    $doctorText.Text = "Shell doctor failed."
    Set-StatusLine -StatusLabel $statusLabel -Message "Shell doctor failed." -IsError $true
  }
})

$initialCount = Load-Shortcuts -Panel $listPanel
$initialTracked = Load-HistoryRows -ListView $historyList
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
