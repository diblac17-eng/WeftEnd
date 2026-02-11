# tools/windows/shell/weftend_menu.ps1
# Main Windows control center for casual operators.

param(
  [switch]$Tools
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

function Resolve-LibraryRoot {
  param([string]$Base)
  $trimmed = if ($Base) { $Base.Trim() } else { "" }
  if ($trimmed -eq "") { return $null }
  $leaf = [System.IO.Path]::GetFileName($trimmed.TrimEnd('\', '/'))
  if ($leaf.ToLowerInvariant() -eq "library") { return $trimmed }
  return (Join-Path $trimmed "Library")
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

function Fnv1a32Hex {
  param([string]$Input)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Input)
  [uint32]$hash = 2166136261
  foreach ($b in $bytes) {
    $hash = $hash -bxor [uint32]$b
    $hash = [uint32](($hash * 16777619) -band 0xFFFFFFFF)
  }
  return "{0:x8}" -f $hash
}

function Show-Info {
  param([string]$Text)
  [System.Windows.Forms.MessageBox]::Show(
    $Text,
    "WeftEnd",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}

function Open-Explorer {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return }
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (-not (Test-Path -LiteralPath $explorerPath)) { $explorerPath = "explorer.exe" }
  Start-Process -FilePath $explorerPath -ArgumentList $PathValue | Out-Null
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$configPath = "HKCU:\Software\WeftEnd\Shell"
$repoRoot = Read-RegistryValue -Path $configPath -Name "RepoRoot"
$outRoot = Read-RegistryValue -Path $configPath -Name "OutRoot"
$nodeCmd = Read-RegistryValue -Path $configPath -Name "NodeExe"

$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
$scriptDir = Split-Path -Parent $scriptPath
if (-not $repoRoot -or $repoRoot.Trim() -eq "") {
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\..\.."))
}
if (-not $outRoot -or $outRoot.Trim() -eq "") {
  if ($env:LOCALAPPDATA) { $outRoot = Join-Path $env:LOCALAPPDATA "WeftEnd\Library" }
}
$libraryRoot = Resolve-LibraryRoot -Base $outRoot
if (-not $libraryRoot -or $libraryRoot.Trim() -eq "") {
  $libraryRoot = Join-Path $env:LOCALAPPDATA "WeftEnd\Library"
}
New-Item -ItemType Directory -Force -Path $libraryRoot | Out-Null

$programFiles = [Environment]::GetFolderPath("ProgramFiles")
$programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$repoNodePath = Join-Path $repoRoot "runtime\node\node.exe"
$nodePath = Resolve-ExecutablePath -Preferred $nodeCmd -CommandName "node" -Fallbacks @(
  $repoNodePath,
  (Join-Path $programFiles "nodejs\node.exe"),
  (Join-Path $programFilesX86 "nodejs\node.exe"),
  (Join-Path $localAppData "Programs\nodejs\node.exe")
)
$mainJs = Join-Path $repoRoot "dist\src\cli\main.js"
$safeRunScript = Join-Path $scriptDir "weftend_safe_run.ps1"
$shellDoctorScript = Join-Path $scriptDir "weftend_shell_doctor.ps1"
$installScript = Join-Path $scriptDir "install_weftend_context_menu.ps1"
$uninstallScript = Join-Path $scriptDir "uninstall_weftend_context_menu.ps1"
$launchpadScript = Join-Path $scriptDir "launchpad_panel.ps1"

# Compatibility default: WeftEnd entry opens Launchpad unless explicitly forced to tools mode.
if (-not $Tools.IsPresent -and (Test-Path -LiteralPath $launchpadScript)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $launchpadScript
  ) | Out-Null
  exit 0
}

$iconPath = Join-Path $repoRoot "assets\weftend_logo.ico"
if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = $null }

function Invoke-ShellDoctor {
  if (-not (Test-Path -LiteralPath $shellDoctorScript)) {
    Show-Info "Shell doctor script missing."
    return
  }
  $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $shellDoctorScript 2>&1)
  $text = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  Show-Info $text
}

function Invoke-ContextInstall {
  if (-not (Test-Path -LiteralPath $installScript)) {
    Show-Info "Install script missing."
    return
  }
  $null = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $installScript 2>&1)
  if ($LASTEXITCODE -eq 0) {
    Show-Info "Context menu installed."
  } else {
    Show-Info ("Install failed with exit code " + $LASTEXITCODE.ToString())
  }
}

function Invoke-ContextUninstall {
  if (-not (Test-Path -LiteralPath $uninstallScript)) {
    Show-Info "Uninstall script missing."
    return
  }
  $null = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $uninstallScript 2>&1)
  if ($LASTEXITCODE -eq 0) {
    Show-Info "Context menu uninstalled."
  } else {
    Show-Info ("Uninstall failed with exit code " + $LASTEXITCODE.ToString())
  }
}

function Invoke-Launchpad {
  if (-not (Test-Path -LiteralPath $launchpadScript)) {
    Show-Info "Launchpad script missing."
    return
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $launchpadScript
  ) | Out-Null
}

$colorBg = [System.Drawing.Color]::FromArgb(18, 20, 24)
$colorHeader = [System.Drawing.Color]::FromArgb(24, 27, 33)
$colorCard = [System.Drawing.Color]::FromArgb(30, 34, 41)
$colorCardHover = [System.Drawing.Color]::FromArgb(38, 44, 54)
$colorBorder = [System.Drawing.Color]::FromArgb(56, 62, 74)
$colorText = [System.Drawing.Color]::FromArgb(236, 239, 245)
$colorMuted = [System.Drawing.Color]::FromArgb(167, 174, 188)
$fontTitle = New-Object System.Drawing.Font("Segoe UI Semibold", 16)
$fontBody = New-Object System.Drawing.Font("Segoe UI", 9)
$fontCardTitle = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
$fontCardBody = New-Object System.Drawing.Font("Segoe UI", 8.5)

$form = New-Object System.Windows.Forms.Form
$form.Text = "WeftEnd Operator"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.Width = 760
$form.Height = 520
$form.BackColor = $colorBg
$form.ForeColor = $colorText

if ($iconPath -and (Test-Path -LiteralPath $iconPath)) {
  try {
    $form.Icon = New-Object System.Drawing.Icon($iconPath)
  } catch {
    # ignore icon load issues
  }
}

$header = New-Object System.Windows.Forms.Panel
$header.Dock = [System.Windows.Forms.DockStyle]::Top
$header.Height = 96
$header.BackColor = $colorHeader
$form.Controls.Add($header)

$title = New-Object System.Windows.Forms.Label
$title.Text = "WeftEnd Operator Console"
$title.Font = $fontTitle
$title.ForeColor = $colorText
$title.AutoSize = $false
$title.Width = 720
$title.Height = 34
$title.Location = New-Object System.Drawing.Point(18, 16)
$header.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Deterministic evidence and change control. Operators decide."
$subtitle.Font = $fontBody
$subtitle.ForeColor = $colorMuted
$subtitle.AutoSize = $false
$subtitle.Width = 720
$subtitle.Height = 20
$subtitle.Location = New-Object System.Drawing.Point(18, 52)
$header.Controls.Add($subtitle)

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Dock = [System.Windows.Forms.DockStyle]::Fill
$panel.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight
$panel.WrapContents = $true
$panel.AutoScroll = $true
$panel.Padding = New-Object System.Windows.Forms.Padding(14, 14, 14, 10)
$panel.BackColor = $colorBg
$form.Controls.Add($panel)

$footer = New-Object System.Windows.Forms.Label
$footer.Dock = [System.Windows.Forms.DockStyle]::Bottom
$footer.Height = 24
$footer.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$footer.Padding = New-Object System.Windows.Forms.Padding(12, 0, 0, 0)
$footer.ForeColor = $colorMuted
$footer.BackColor = $colorHeader
$footer.Font = $fontCardBody
$footer.Text = "Tip: Launchpad is the day-to-day entry point; library holds receipts and compare state."
$form.Controls.Add($footer)

function New-MenuCard {
  param(
    [string]$Title,
    [string]$Description,
    [scriptblock]$OnClick
  )
  $card = New-Object System.Windows.Forms.Panel
  $card.Width = 350
  $card.Height = 86
  $card.Margin = New-Object System.Windows.Forms.Padding(8)
  $card.BackColor = $colorCard
  $card.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $card.Cursor = [System.Windows.Forms.Cursors]::Hand

  $titleLabel = New-Object System.Windows.Forms.Label
  $titleLabel.Text = $Title
  $titleLabel.Font = $fontCardTitle
  $titleLabel.ForeColor = $colorText
  $titleLabel.AutoSize = $false
  $titleLabel.Width = 324
  $titleLabel.Height = 26
  $titleLabel.Location = New-Object System.Drawing.Point(12, 10)
  $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $titleLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $descLabel = New-Object System.Windows.Forms.Label
  $descLabel.Text = $Description
  $descLabel.Font = $fontCardBody
  $descLabel.ForeColor = $colorMuted
  $descLabel.AutoSize = $false
  $descLabel.Width = 324
  $descLabel.Height = 36
  $descLabel.Location = New-Object System.Drawing.Point(12, 38)
  $descLabel.TextAlign = [System.Drawing.ContentAlignment]::TopLeft
  $descLabel.Cursor = [System.Windows.Forms.Cursors]::Hand

  $card.Add_Click($OnClick)
  $titleLabel.Add_Click($OnClick)
  $descLabel.Add_Click($OnClick)
  $card.Add_MouseEnter({ $this.BackColor = $colorCardHover })
  $card.Add_MouseLeave({ $this.BackColor = $colorCard })
  $titleLabel.Add_MouseEnter({ if ($this.Parent) { $this.Parent.BackColor = $colorCardHover } })
  $titleLabel.Add_MouseLeave({ if ($this.Parent) { $this.Parent.BackColor = $colorCard } })
  $descLabel.Add_MouseEnter({ if ($this.Parent) { $this.Parent.BackColor = $colorCardHover } })
  $descLabel.Add_MouseLeave({ if ($this.Parent) { $this.Parent.BackColor = $colorCard } })

  $card.Controls.Add($titleLabel) | Out-Null
  $card.Controls.Add($descLabel) | Out-Null
  return $card
}

$panel.Controls.Add((New-MenuCard -Title "Open Launchpad" -Description "Run gated shortcuts with SAME/CHANGED control." -OnClick { Invoke-Launchpad })) | Out-Null
$panel.Controls.Add((New-MenuCard -Title "Open Library" -Description "Browse run history, report cards, and compare outputs." -OnClick { Open-Explorer -PathValue $libraryRoot })) | Out-Null
$panel.Controls.Add((New-MenuCard -Title "Run Shell Doctor" -Description "Verify context-menu wiring and registry health." -OnClick { Invoke-ShellDoctor })) | Out-Null
$panel.Controls.Add((New-MenuCard -Title "Install Context Menu" -Description "Enable right-click Run with WeftEnd entries." -OnClick { Invoke-ContextInstall })) | Out-Null
$panel.Controls.Add((New-MenuCard -Title "Uninstall Context Menu" -Description "Remove per-user right-click WeftEnd entries." -OnClick { Invoke-ContextUninstall })) | Out-Null

[void]$form.ShowDialog()
