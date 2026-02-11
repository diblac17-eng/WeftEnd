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

$form = New-Object System.Windows.Forms.Form
$form.Text = "WeftEnd Launchpad"
$form.Width = 440
$form.Height = 650
$form.StartPosition = "CenterScreen"
$form.BackColor = $colorBg
$form.ForeColor = $colorText
$form.Font = $fontMain
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.FormBorderStyle = "FixedDialog"
if ($TopMost.IsPresent) { $form.TopMost = $true }

$header = New-Object System.Windows.Forms.FlowLayoutPanel
$header.FlowDirection = "LeftToRight"
$header.Dock = "Top"
$header.Height = 106
$header.Padding = New-Object System.Windows.Forms.Padding 6
$header.BackColor = $colorHeader

$title = New-Object System.Windows.Forms.Label
$title.Text = "WeftEnd Launchpad"
$title.AutoSize = $false
$title.Width = 406
$title.Height = 24
$title.Margin = New-Object System.Windows.Forms.Padding 6,4,6,2
$title.Font = $fontTitle
$title.ForeColor = $colorText
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Click a tile to run gated scan + launch workflow"
$subtitle.AutoSize = $false
$subtitle.Width = 406
$subtitle.Height = 18
$subtitle.Margin = New-Object System.Windows.Forms.Padding 6,0,6,4
$subtitle.Font = $fontSmall
$subtitle.ForeColor = $colorMuted
$subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$btnTargets = New-Object System.Windows.Forms.Button
$btnTargets.Text = "Open Targets"
$btnTargets.Width = 110
$btnTargets.Height = 30
Style-Button -Button $btnTargets -Primary:$false
$btnTargets.Add_Click({
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $targetsDir | Out-Null
})

$btnSync = New-Object System.Windows.Forms.Button
$btnSync.Text = "Sync"
$btnSync.Width = 60
$btnSync.Height = 30
Style-Button -Button $btnSync -Primary:$true
$btnSync.Add_Click({
  $sync = Invoke-LaunchpadSync
  $count = Load-Shortcuts -Panel $listPanel
  if ($sync.ok) {
    $msg = "Synced. targets=" + $sync.scanned + " added=" + $sync.added + " removed=" + $sync.removed + " failed=" + $sync.failed + " visible=" + $count
    Set-StatusLine -StatusLabel $statusLabel -Message $msg -IsError $false
  } else {
    Set-StatusLine -StatusLabel $statusLabel -Message ("Sync error: " + $sync.code) -IsError $true
  }
})

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = "Refresh"
$btnRefresh.Width = 70
$btnRefresh.Height = 30
Style-Button -Button $btnRefresh -Primary:$false
$btnRefresh.Add_Click({
  $sync = Invoke-LaunchpadSync -Silent
  $count = Load-Shortcuts -Panel $listPanel
  if ($sync.ok) {
    Set-StatusLine -StatusLabel $statusLabel -Message ("Refreshed. visible=" + $count) -IsError $false
  } else {
    Set-StatusLine -StatusLabel $statusLabel -Message ("Refresh warning: " + $sync.code) -IsError $true
  }
})

$chkAuto = New-Object System.Windows.Forms.CheckBox
$chkAuto.Text = "Auto refresh"
$chkAuto.Checked = $true
$chkAuto.AutoSize = $true
$chkAuto.Margin = New-Object System.Windows.Forms.Padding 6,10,0,0
$chkAuto.ForeColor = $colorText

$chkTop = New-Object System.Windows.Forms.CheckBox
$chkTop.Text = "Topmost"
$chkTop.Checked = $TopMost.IsPresent
$chkTop.AutoSize = $true
$chkTop.Margin = New-Object System.Windows.Forms.Padding 6,10,0,0
$chkTop.ForeColor = $colorText
$chkTop.Add_CheckedChanged({
  $form.TopMost = $chkTop.Checked
})

$header.Controls.Add($title) | Out-Null
$header.Controls.Add($subtitle) | Out-Null
$header.Controls.Add($btnTargets) | Out-Null
$header.Controls.Add($btnSync) | Out-Null
$header.Controls.Add($btnRefresh) | Out-Null
$header.Controls.Add($chkAuto) | Out-Null
$header.Controls.Add($chkTop) | Out-Null

$headerDivider = New-Object System.Windows.Forms.Panel
$headerDivider.Dock = "Top"
$headerDivider.Height = 1
$headerDivider.BackColor = $colorBorder

$listPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$listPanel.Dock = "Fill"
$listPanel.FlowDirection = "TopDown"
$listPanel.WrapContents = $false
$listPanel.AutoScroll = $true
$listPanel.BackColor = $colorBg

$statusBar = New-Object System.Windows.Forms.Panel
$statusBar.Dock = "Bottom"
$statusBar.Height = 28
$statusBar.BackColor = $colorHeader

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.AutoSize = $false
$statusLabel.Width = 420
$statusLabel.Height = 24
$statusLabel.Location = New-Object System.Drawing.Point 8,2
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$statusLabel.ForeColor = $colorMuted
$statusLabel.Font = $fontSmall
$statusLabel.Text = "Ready."
$statusBar.Controls.Add($statusLabel) | Out-Null

$initialCount = Load-Shortcuts -Panel $listPanel
Set-StatusLine -StatusLabel $statusLabel -Message ("Ready. visible=" + $initialCount) -IsError $false

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
  if ($chkAuto.Checked) {
    $sync = Invoke-LaunchpadSync -Silent
    $count = Load-Shortcuts -Panel $listPanel
    if ($sync.ok) {
      Set-StatusLine -StatusLabel $statusLabel -Message ("Auto refresh. visible=" + $count) -IsError $false
    } else {
      Set-StatusLine -StatusLabel $statusLabel -Message ("Auto refresh warning: " + $sync.code) -IsError $true
    }
  }
})
$timer.Start()

$form.Controls.Add($listPanel)
$form.Controls.Add($statusBar)
$form.Controls.Add($headerDivider)
$form.Controls.Add($header)

[void]$form.ShowDialog()
