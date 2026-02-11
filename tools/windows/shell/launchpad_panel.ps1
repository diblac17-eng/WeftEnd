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

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

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
    return $false
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
      return $false
    }
    return $true
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
    return $false
  }
}

function Load-Shortcuts {
  param([System.Windows.Forms.FlowLayoutPanel]$Panel)
  $Panel.Controls.Clear()

  $files = @(Get-ChildItem -LiteralPath $launchpadRoot -Filter "*.lnk" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "* (WeftEnd).lnk" } | Sort-Object Name)
  if (-not $files -or $files.Count -eq 0) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "No Launchpad shortcuts yet. Drop items into Targets and click Sync."
    $label.AutoSize = $true
    $label.Margin = New-Object System.Windows.Forms.Padding 8
    $Panel.Controls.Add($label) | Out-Null
    return
  }

  foreach ($file in $files) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $name = $name.Replace(" (WeftEnd)", "")
    $row = New-Object System.Windows.Forms.Panel
    $row.Width = 360
    $row.Height = 54
    $row.Margin = New-Object System.Windows.Forms.Padding 6
    $row.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $row.Tag = $file.FullName

    $iconBox = New-Object System.Windows.Forms.PictureBox
    $iconBox.Width = 32
    $iconBox.Height = 32
    $iconBox.Location = New-Object System.Drawing.Point 8,11
    $iconBox.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $iconBox.Tag = $file.FullName

    $label = New-Object System.Windows.Forms.Label
    $label.AutoSize = $false
    $label.Width = 290
    $label.Height = 54
    $label.Location = New-Object System.Drawing.Point 64,0
    $label.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
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
      if (
        $lnk -and
        (Test-Path -LiteralPath $lnk) -and
        $lnk.ToLowerInvariant().StartsWith($launchpadRoot.ToLowerInvariant()) -and
        $lnk.ToLowerInvariant().EndsWith(" (weftend).lnk")
      ) {
        Start-Process -FilePath $lnk | Out-Null
      }
    }
    $row.Add_Click($handler)
    $iconBox.Add_Click($handler)
    $label.Add_Click($handler)

    $row.Controls.Add($iconBox) | Out-Null
    $row.Controls.Add($label) | Out-Null
    $Panel.Controls.Add($row) | Out-Null
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "WeftEnd Launchpad"
$form.Width = 420
$form.Height = 600
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.FormBorderStyle = "FixedDialog"
if ($TopMost.IsPresent) { $form.TopMost = $true }

$header = New-Object System.Windows.Forms.FlowLayoutPanel
$header.FlowDirection = "LeftToRight"
$header.Dock = "Top"
$header.Height = 52
$header.Padding = New-Object System.Windows.Forms.Padding 6

$btnTargets = New-Object System.Windows.Forms.Button
$btnTargets.Text = "Open Targets"
$btnTargets.Width = 110
$btnTargets.Height = 30
$btnTargets.Add_Click({
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $targetsDir | Out-Null
})

$btnSync = New-Object System.Windows.Forms.Button
$btnSync.Text = "Sync"
$btnSync.Width = 60
$btnSync.Height = 30
$btnSync.Add_Click({
  Invoke-LaunchpadSync | Out-Null
  Load-Shortcuts -Panel $listPanel
})

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = "Refresh"
$btnRefresh.Width = 70
$btnRefresh.Height = 30
$btnRefresh.Add_Click({
  Invoke-LaunchpadSync -Silent | Out-Null
  Load-Shortcuts -Panel $listPanel
})

$chkAuto = New-Object System.Windows.Forms.CheckBox
$chkAuto.Text = "Auto refresh"
$chkAuto.Checked = $true
$chkAuto.AutoSize = $true
$chkAuto.Margin = New-Object System.Windows.Forms.Padding 6,10,0,0

$chkTop = New-Object System.Windows.Forms.CheckBox
$chkTop.Text = "Topmost"
$chkTop.Checked = $TopMost.IsPresent
$chkTop.AutoSize = $true
$chkTop.Margin = New-Object System.Windows.Forms.Padding 6,10,0,0
$chkTop.Add_CheckedChanged({
  $form.TopMost = $chkTop.Checked
})

$header.Controls.Add($btnTargets) | Out-Null
$header.Controls.Add($btnSync) | Out-Null
$header.Controls.Add($btnRefresh) | Out-Null
$header.Controls.Add($chkAuto) | Out-Null
$header.Controls.Add($chkTop) | Out-Null

$listPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$listPanel.Dock = "Fill"
$listPanel.FlowDirection = "TopDown"
$listPanel.WrapContents = $false
$listPanel.AutoScroll = $true

Load-Shortcuts -Panel $listPanel

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
  if ($chkAuto.Checked) {
    Invoke-LaunchpadSync -Silent | Out-Null
    Load-Shortcuts -Panel $listPanel
  }
})
$timer.Start()

$form.Controls.Add($listPanel)
$form.Controls.Add($header)

[void]$form.ShowDialog()
