# tools/windows/shell/report_card_viewer.ps1
# Native report-card viewer (WinForms) for WeftEnd runs.

param(
  [string]$RunDir,
  [string]$TargetDir,
  [string]$RunId,
  [string]$LibraryKey
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-StringValue {
  param([object]$Value, [string]$Fallback = "-")
  if ($null -eq $Value) { return $Fallback }
  $text = [string]$Value
  if (-not $text -or $text.Trim() -eq "") { return $Fallback }
  return $text
}

function Resolve-RunDirectory {
  param(
    [string]$RunDirValue,
    [string]$TargetDirValue,
    [string]$RunIdValue
  )
  if ($RunDirValue -and (Test-Path -LiteralPath $RunDirValue)) {
    return [System.IO.Path]::GetFullPath($RunDirValue)
  }
  if ($TargetDirValue -and $RunIdValue) {
    $candidate = Join-Path $TargetDirValue $RunIdValue
    if (Test-Path -LiteralPath $candidate) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  return $null
}

function Parse-ReportTextMap {
  param([string[]]$Lines)
  $map = @{}
  if (-not $Lines) { return $map }
  foreach ($line in $Lines) {
    if (-not $line) { continue }
    $trimmed = [string]$line
    if ($trimmed -match "^([^:]+):\s*(.*)$") {
      $map[$matches[1].Trim().ToLowerInvariant()] = $matches[2].Trim()
      continue
    }
    if ($trimmed -match "^([^=]+)=(.*)$") {
      $map[$matches[1].Trim().ToLowerInvariant()] = $matches[2].Trim()
      continue
    }
  }
  return $map
}

function Load-ReportModel {
  param([string]$ResolvedRunDir)
  $txtPath = Join-Path $ResolvedRunDir "report_card.txt"
  $jsonPath = Join-Path $ResolvedRunDir "report_card_v0.json"
  $lines = @()
  if (Test-Path -LiteralPath $txtPath) {
    try {
      $lines = @(Get-Content -LiteralPath $txtPath -Encoding UTF8)
    } catch {
      $lines = @()
    }
  }

  if (Test-Path -LiteralPath $jsonPath) {
    try {
      $json = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
      return [ordered]@{
        runId = Get-StringValue -Value $json.runId
        libraryKey = Get-StringValue -Value $json.libraryKey
        result = Get-StringValue -Value $json.result
        reason = Get-StringValue -Value $json.reason
        status = Get-StringValue -Value $json.status
        baseline = Get-StringValue -Value $json.baseline
        latest = Get-StringValue -Value $json.latest
        buckets = Get-StringValue -Value $json.buckets
        artifactFingerprint = Get-StringValue -Value $json.artifactFingerprint
        artifactDigest = Get-StringValue -Value $json.artifactDigest
        meaning = Get-StringValue -Value $json.meaning
        next = Get-StringValue -Value $json.next
        targetKind = Get-StringValue -Value $json.targetKind
        artifactKind = Get-StringValue -Value $json.artifactKind
        requestedTarget = Get-StringValue -Value $json.requestedTarget
        scanTarget = Get-StringValue -Value $json.scanTarget
        lines = if ($json.lines) { @($json.lines | ForEach-Object { [string]$_ }) } else { $lines }
        reportTextPath = $txtPath
      }
    } catch {
      # Fall through to text parsing.
    }
  }

  $map = Parse-ReportTextMap -Lines $lines
  return [ordered]@{
    runId = Get-StringValue -Value $map["runid"]
    libraryKey = Get-StringValue -Value $map["librarykey"]
    result = Get-StringValue -Value $map["result"]
    reason = Get-StringValue -Value $map["reason"]
    status = Get-StringValue -Value $map["status"]
    baseline = Get-StringValue -Value $map["baseline"]
    latest = Get-StringValue -Value $map["latest"]
    buckets = Get-StringValue -Value $map["buckets"]
    artifactFingerprint = Get-StringValue -Value $map["fingerprint"]
    artifactDigest = Get-StringValue -Value $map["artifactdigest"]
    meaning = Get-StringValue -Value $map["meaning"]
    next = Get-StringValue -Value $map["next"]
    targetKind = Get-StringValue -Value $map["classification"]
    artifactKind = "-"
    requestedTarget = Get-StringValue -Value $map["targets"]
    scanTarget = "-"
    lines = $lines
    reportTextPath = $txtPath
  }
}

function Open-InExplorer {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return }
  $explorerPath = Join-Path $env:WINDIR "explorer.exe"
  if (Test-Path -LiteralPath $explorerPath) {
    Start-Process -FilePath $explorerPath -ArgumentList $PathValue | Out-Null
  } else {
    Start-Process -FilePath "explorer.exe" -ArgumentList $PathValue | Out-Null
  }
}

$resolvedRunDir = Resolve-RunDirectory -RunDirValue $RunDir -TargetDirValue $TargetDir -RunIdValue $RunId
if (-not $resolvedRunDir) {
  Write-Error "REPORT_RUN_MISSING"
  exit 40
}

if (-not $TargetDir -or $TargetDir.Trim() -eq "") {
  $TargetDir = Split-Path -Parent $resolvedRunDir
}
if (-not $LibraryKey -or $LibraryKey.Trim() -eq "") {
  $LibraryKey = [System.IO.Path]::GetFileName($TargetDir)
}

$model = Load-ReportModel -ResolvedRunDir $resolvedRunDir

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$colorBg = [System.Drawing.Color]::FromArgb(26, 27, 31)
$colorPanel = [System.Drawing.Color]::FromArgb(34, 36, 41)
$colorHeader = [System.Drawing.Color]::FromArgb(20, 21, 24)
$colorText = [System.Drawing.Color]::FromArgb(235, 237, 242)
$colorMuted = [System.Drawing.Color]::FromArgb(170, 174, 186)
$colorAccent = [System.Drawing.Color]::FromArgb(56, 94, 217)
$colorAccentHover = [System.Drawing.Color]::FromArgb(66, 108, 235)
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

$statusValue = Get-StringValue -Value $model.status
$statusBack = [System.Drawing.Color]::FromArgb(68, 88, 100)
if ($statusValue -eq "SAME") {
  $statusBack = [System.Drawing.Color]::FromArgb(47, 117, 83)
} elseif ($statusValue -eq "CHANGED") {
  $statusBack = [System.Drawing.Color]::FromArgb(167, 98, 34)
} elseif ($statusValue -eq "BLOCKED" -or $statusValue -eq "DENY") {
  $statusBack = [System.Drawing.Color]::FromArgb(149, 52, 52)
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "WeftEnd Report Viewer"
$form.Width = 860
$form.Height = 640
$form.MinimumSize = New-Object System.Drawing.Size(860, 640)
$form.StartPosition = "CenterScreen"
$form.BackColor = $colorBg
$form.ForeColor = $colorText
$form.Font = $fontMain
$form.FormBorderStyle = "Sizable"
$form.SizeGripStyle = [System.Windows.Forms.SizeGripStyle]::Hide

$root = New-Object System.Windows.Forms.TableLayoutPanel
$root.Dock = "Fill"
$root.ColumnCount = 1
$root.RowCount = 3
$root.BackColor = $colorBg
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 78)))
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 44)))
$form.Controls.Add($root)

$header = New-Object System.Windows.Forms.TableLayoutPanel
$header.Dock = "Fill"
$header.BackColor = $colorHeader
$header.ColumnCount = 2
$header.RowCount = 1
$header.Padding = New-Object System.Windows.Forms.Padding(12, 8, 12, 8)
$header.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$header.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 126)))
$root.Controls.Add($header, 0, 0) | Out-Null

$headerLeft = New-Object System.Windows.Forms.TableLayoutPanel
$headerLeft.Dock = "Fill"
$headerLeft.ColumnCount = 1
$headerLeft.RowCount = 2
$headerLeft.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
$headerLeft.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 22)))

$title = New-Object System.Windows.Forms.Label
$title.Text = "Report Card Viewer"
$title.Font = $fontTitle
$title.ForeColor = $colorText
$title.Dock = "Fill"
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = ("Target: " + (Get-StringValue -Value $model.libraryKey -Fallback $LibraryKey) + "   Run: " + (Get-StringValue -Value $model.runId))
$subtitle.Font = $fontSmall
$subtitle.ForeColor = $colorMuted
$subtitle.Dock = "Fill"
$subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$headerLeft.Controls.Add($title, 0, 0) | Out-Null
$headerLeft.Controls.Add($subtitle, 0, 1) | Out-Null
$header.Controls.Add($headerLeft, 0, 0) | Out-Null

$statusWrap = New-Object System.Windows.Forms.Panel
$statusWrap.Dock = "Fill"
$statusWrap.Padding = New-Object System.Windows.Forms.Padding(12, 14, 0, 14)

$statusChip = New-Object System.Windows.Forms.Label
$statusChip.Text = $statusValue
$statusChip.Font = $fontTitle
$statusChip.ForeColor = $colorText
$statusChip.BackColor = $statusBack
$statusChip.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$statusChip.Dock = "Fill"
$statusWrap.Controls.Add($statusChip) | Out-Null
$header.Controls.Add($statusWrap, 1, 0) | Out-Null

$body = New-Object System.Windows.Forms.TableLayoutPanel
$body.Dock = "Fill"
$body.BackColor = $colorBg
$body.ColumnCount = 3
$body.RowCount = 1
$body.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 34)))
$body.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 1)))
$body.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 66)))
$root.Controls.Add($body, 0, 1) | Out-Null

$summaryPanel = New-Object System.Windows.Forms.Panel
$summaryPanel.Dock = "Fill"
$summaryPanel.BackColor = $colorPanel
$summaryPanel.Padding = New-Object System.Windows.Forms.Padding(12, 10, 12, 10)
$body.Controls.Add($summaryPanel, 0, 0) | Out-Null

$bodyDivider = New-Object System.Windows.Forms.Panel
$bodyDivider.Dock = "Fill"
$bodyDivider.Margin = New-Object System.Windows.Forms.Padding(0)
$bodyDivider.BackColor = [System.Drawing.Color]::FromArgb(48, 51, 58)
$body.Controls.Add($bodyDivider, 1, 0) | Out-Null

$summaryScroll = New-Object System.Windows.Forms.Panel
$summaryScroll.Dock = "Fill"
$summaryScroll.AutoScroll = $true
$summaryScroll.BackColor = $colorPanel
$summaryPanel.Controls.Add($summaryScroll)

$summaryTable = New-Object System.Windows.Forms.TableLayoutPanel
$summaryTable.Dock = "Top"
$summaryTable.AutoSize = $true
$summaryTable.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
$summaryTable.ColumnCount = 1
$summaryTable.RowCount = 13
$summaryTable.Margin = New-Object System.Windows.Forms.Padding(0)
for ($i = 0; $i -lt 13; $i++) {
  $summaryTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 34)))
}
$summaryScroll.Controls.Add($summaryTable) | Out-Null

function Add-SummaryLine {
  param([string]$TextValue)
  $line = New-Object System.Windows.Forms.Label
  $line.Text = $TextValue
  $line.ForeColor = $colorText
  $line.Font = $fontMain
  $line.Dock = "Fill"
  $line.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $line.Margin = New-Object System.Windows.Forms.Padding(0)
  $line.Padding = New-Object System.Windows.Forms.Padding(2, 0, 0, 0)
  [void]$summaryTable.Controls.Add($line)
}

Add-SummaryLine -TextValue ("Result: " + (Get-StringValue -Value $model.result))
Add-SummaryLine -TextValue ("Fingerprint: " + (Get-StringValue -Value $model.artifactFingerprint))
Add-SummaryLine -TextValue ("Artifact Digest: " + (Get-StringValue -Value $model.artifactDigest))
Add-SummaryLine -TextValue ("Reason: " + (Get-StringValue -Value $model.reason))
Add-SummaryLine -TextValue ("Baseline: " + (Get-StringValue -Value $model.baseline))
Add-SummaryLine -TextValue ("Latest: " + (Get-StringValue -Value $model.latest))
Add-SummaryLine -TextValue ("Buckets: " + (Get-StringValue -Value $model.buckets))
Add-SummaryLine -TextValue ("Next: " + (Get-StringValue -Value $model.next))
Add-SummaryLine -TextValue ("Requested: " + (Get-StringValue -Value $model.requestedTarget))
Add-SummaryLine -TextValue ("Scanned: " + (Get-StringValue -Value $model.scanTarget))
Add-SummaryLine -TextValue ("Target Kind: " + (Get-StringValue -Value $model.targetKind))
Add-SummaryLine -TextValue ("Artifact Kind: " + (Get-StringValue -Value $model.artifactKind))
Add-SummaryLine -TextValue ("Meaning: " + (Get-StringValue -Value $model.meaning))

$detailsPanel = New-Object System.Windows.Forms.Panel
$detailsPanel.Dock = "Fill"
$detailsPanel.BackColor = $colorPanel
$detailsPanel.Padding = New-Object System.Windows.Forms.Padding(10)
$body.Controls.Add($detailsPanel, 2, 0) | Out-Null

$detailsLayout = New-Object System.Windows.Forms.TableLayoutPanel
$detailsLayout.Dock = "Fill"
$detailsLayout.ColumnCount = 1
$detailsLayout.RowCount = 2
$detailsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 24)))
$detailsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$detailsPanel.Controls.Add($detailsLayout)

$reportTitle = New-Object System.Windows.Forms.Label
$reportTitle.Text = "Detailed Report"
$reportTitle.Dock = "Fill"
$reportTitle.ForeColor = $colorText
$reportTitle.Font = $fontTitle
$reportTitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$detailsLayout.Controls.Add($reportTitle, 0, 0) | Out-Null

$reportText = New-Object System.Windows.Forms.TextBox
$reportText.Multiline = $true
$reportText.ReadOnly = $true
$reportText.ScrollBars = "Vertical"
$reportText.Dock = "Fill"
$reportText.BackColor = [System.Drawing.Color]::FromArgb(28, 30, 36)
$reportText.ForeColor = $colorText
$reportText.Font = New-Object System.Drawing.Font "Consolas", 9
$reportLines = if ($model.lines -and $model.lines.Count -gt 0) { @($model.lines | ForEach-Object { [string]$_ }) } else { @("report_card.txt missing or empty.") }
$reportText.Text = ($reportLines -join [Environment]::NewLine)
$reportText.SelectionStart = 0
$reportText.SelectionLength = 0
$reportText.ScrollToCaret()
$detailsLayout.Controls.Add($reportText, 0, 1) | Out-Null

$footer = New-Object System.Windows.Forms.FlowLayoutPanel
$footer.Dock = "Fill"
$footer.FlowDirection = "RightToLeft"
$footer.WrapContents = $false
$footer.Padding = New-Object System.Windows.Forms.Padding(8, 6, 8, 6)
$footer.BackColor = $colorHeader
$root.Controls.Add($footer, 0, 2) | Out-Null

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Close"
$btnClose.Width = 88
$btnClose.Height = 30
Style-Button -Button $btnClose -Primary:$true
$btnClose.Add_Click({ $form.Close() })
$footer.Controls.Add($btnClose) | Out-Null

$btnCopy = New-Object System.Windows.Forms.Button
$btnCopy.Text = "Copy Summary"
$btnCopy.Width = 110
$btnCopy.Height = 30
Style-Button -Button $btnCopy -Primary:$false
$btnCopy.Add_Click({
  $summary = @(
    "status=" + (Get-StringValue -Value $model.status),
    "result=" + (Get-StringValue -Value $model.result),
    "artifactFingerprint=" + (Get-StringValue -Value $model.artifactFingerprint),
    "artifactDigest=" + (Get-StringValue -Value $model.artifactDigest),
    "reason=" + (Get-StringValue -Value $model.reason),
    "runId=" + (Get-StringValue -Value $model.runId),
    "baseline=" + (Get-StringValue -Value $model.baseline),
    "latest=" + (Get-StringValue -Value $model.latest),
    "buckets=" + (Get-StringValue -Value $model.buckets)
  ) -join [Environment]::NewLine
  [System.Windows.Forms.Clipboard]::SetText($summary)
})
$footer.Controls.Add($btnCopy) | Out-Null

$btnOpenTarget = New-Object System.Windows.Forms.Button
$btnOpenTarget.Text = "Open Target History"
$btnOpenTarget.Width = 132
$btnOpenTarget.Height = 30
Style-Button -Button $btnOpenTarget -Primary:$false
$btnOpenTarget.Enabled = $TargetDir -and (Test-Path -LiteralPath $TargetDir)
$btnOpenTarget.Add_Click({ Open-InExplorer -PathValue $TargetDir })
$footer.Controls.Add($btnOpenTarget) | Out-Null

$btnOpenRun = New-Object System.Windows.Forms.Button
$btnOpenRun.Text = "Open Run Folder"
$btnOpenRun.Width = 118
$btnOpenRun.Height = 30
Style-Button -Button $btnOpenRun -Primary:$false
$btnOpenRun.Add_Click({ Open-InExplorer -PathValue $resolvedRunDir })
$footer.Controls.Add($btnOpenRun) | Out-Null

$form.Add_Shown({
  try {
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.Activate()
    $form.BringToFront()
    $reportText.SelectionStart = 0
    $reportText.SelectionLength = 0
    $reportText.ScrollToCaret()
  } catch {
    # best effort
  }
})

[void]$form.ShowDialog()
exit 0
