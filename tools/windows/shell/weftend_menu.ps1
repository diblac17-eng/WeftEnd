# tools/windows/shell/weftend_menu.ps1
# Main Windows control center for casual operators.

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

function Choose-File {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  $dialog.Title = "Select file for WeftEnd Safe-Run"
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    return $dialog.FileName
  }
  return $null
}

function Choose-Folder {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Select folder"
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    return $dialog.SelectedPath
  }
  return $null
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
$nodePath = Resolve-ExecutablePath -Preferred $nodeCmd -CommandName "node" -Fallbacks @(
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

$iconPath = Join-Path $repoRoot "assets\weftend_logo.ico"
if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = $null }

function Invoke-SafeRunPicked {
  $choice = [System.Windows.Forms.MessageBox]::Show(
    "Choose Yes for file, No for folder, Cancel to abort.",
    "Safe-Run Target",
    [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($choice -eq [System.Windows.Forms.DialogResult]::Cancel) { return }
  $target = if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) { Choose-File } else { Choose-Folder }
  if (-not $target) { return }
  if (-not (Test-Path -LiteralPath $safeRunScript)) {
    Show-Info "Safe-run wrapper is missing."
    return
  }
  $psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $psExe)) { $psExe = "powershell.exe" }
  Start-Process -FilePath $psExe -ArgumentList @(
    "-NoProfile",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $safeRunScript,
    "-TargetPath",
    $target
  ) -WindowStyle Hidden | Out-Null
}

function Invoke-CompareRuns {
  if (-not (Test-Path -LiteralPath $mainJs) -or -not $nodePath) {
    Show-Info "CLI not ready. Run npm run compile --silent first."
    return
  }
  $left = Choose-Folder
  if (-not $left) { return }
  $right = Choose-Folder
  if (-not $right) { return }
  $compareRoot = Join-Path $libraryRoot "Compare"
  New-Item -ItemType Directory -Force -Path $compareRoot | Out-Null
  $outDir = Join-Path $compareRoot ("cmp_" + (Fnv1a32Hex ($left + "|" + $right)))
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $output = @(& $nodePath $mainJs "compare" $left $right "--out" $outDir 2>&1)
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Show-Info ("Compare failed with exit code " + $code.ToString())
    return
  }
  $report = Join-Path $outDir "compare_report.txt"
  if (Test-Path -LiteralPath $report) {
    $notepad = Join-Path $env:WINDIR "System32\notepad.exe"
    if (-not (Test-Path -LiteralPath $notepad)) { $notepad = "notepad.exe" }
    Start-Process -FilePath $notepad -ArgumentList $report | Out-Null
  } else {
    Show-Info "Compare completed."
  }
}

function Invoke-TicketPack {
  if (-not (Test-Path -LiteralPath $mainJs) -or -not $nodePath) {
    Show-Info "CLI not ready. Run npm run compile --silent first."
    return
  }
  $runRoot = Choose-Folder
  if (-not $runRoot) { return }
  $ticketRoot = Join-Path $libraryRoot "Tickets"
  New-Item -ItemType Directory -Force -Path $ticketRoot | Out-Null
  $outDir = Join-Path $ticketRoot ("ticket_" + (Fnv1a32Hex $runRoot))
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $null = @(& $nodePath $mainJs "ticket-pack" $runRoot "--out" $outDir "--zip" 2>&1)
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Show-Info ("Ticket pack failed with exit code " + $code.ToString())
    return
  }
  Open-Explorer -PathValue $outDir
}

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

$form = New-Object System.Windows.Forms.Form
$form.Text = "WeftEnd Menu"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.Width = 620
$form.Height = 500
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 248, 252)

if ($iconPath -and (Test-Path -LiteralPath $iconPath)) {
  try {
    $form.Icon = New-Object System.Drawing.Icon($iconPath)
  } catch {
    # ignore icon load issues
  }
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "WeftEnd Operator Menu"
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 14)
$title.AutoSize = $false
$title.Width = 580
$title.Height = 34
$title.Location = New-Object System.Drawing.Point(18, 14)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Analysis-first controls. Baseline acceptance remains manual."
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$subtitle.AutoSize = $false
$subtitle.Width = 580
$subtitle.Height = 22
$subtitle.Location = New-Object System.Drawing.Point(18, 48)
$form.Controls.Add($subtitle)

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Location = New-Object System.Drawing.Point(18, 82)
$panel.Width = 580
$panel.Height = 360
$panel.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight
$panel.WrapContents = $true
$panel.AutoScroll = $true
$panel.Padding = New-Object System.Windows.Forms.Padding(4)
$form.Controls.Add($panel)

function New-MenuButton {
  param(
    [string]$Text,
    [scriptblock]$OnClick
  )
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $Text
  $btn.Width = 270
  $btn.Height = 54
  $btn.Margin = New-Object System.Windows.Forms.Padding(6)
  $btn.Font = New-Object System.Drawing.Font("Segoe UI", 10)
  $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Standard
  $btn.Add_Click($OnClick)
  return $btn
}

$panel.Controls.Add((New-MenuButton -Text "Safe-Run (Pick File/Folder)" -OnClick { Invoke-SafeRunPicked })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Open Library" -OnClick { Open-Explorer -PathValue $libraryRoot })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Compare Two Runs" -OnClick { Invoke-CompareRuns })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Create Ticket Pack" -OnClick { Invoke-TicketPack })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Run Shell Doctor" -OnClick { Invoke-ShellDoctor })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Install Context Menu" -OnClick { Invoke-ContextInstall })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Uninstall Context Menu" -OnClick { Invoke-ContextUninstall })) | Out-Null
$panel.Controls.Add((New-MenuButton -Text "Open Launchpad" -OnClick { Invoke-Launchpad })) | Out-Null

[void]$form.ShowDialog()
