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

function Read-JsonFile {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return $null }
  try {
    return (Get-Content -LiteralPath $PathValue -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Compute-FileSha256Digest {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return "-" }
  try {
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      $stream = [System.IO.File]::OpenRead($PathValue)
      try {
        $hashBytes = $hasher.ComputeHash($stream)
      } finally {
        $stream.Dispose()
      }
    } finally {
      $hasher.Dispose()
    }
    return ([System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant())
  } catch {
    return "-"
  }
}

function Format-ReasonPreview {
  param([object]$ReasonCodes, [int]$MaxItems = 4)
  if (-not $ReasonCodes -or -not ($ReasonCodes -is [System.Array])) { return "-" }
  $items = @($ReasonCodes | ForEach-Object { [string]$_ } | Where-Object { $_ -and $_.Trim() -ne "" })
  if ($items.Count -eq 0) { return "-" }
  $take = [Math]::Min($MaxItems, $items.Count)
  $head = @($items[0..($take - 1)])
  $suffix = if ($items.Count -gt $take) { " +" + ($items.Count - $take) } else { "" }
  return (($head -join ", ") + $suffix)
}

function Get-AdapterClassLabel {
  param([string]$AdapterIdValue, [string]$ArtifactKindValue)
  $id = if ($AdapterIdValue) { $AdapterIdValue.ToLowerInvariant() } else { "" }
  if ($id -match "^([a-z0-9_]+)_adapter_v[0-9]+$") { return $matches[1] }
  if ($id -eq "docker.local.inspect.v0") { return "container" }
  $artifact = if ($ArtifactKindValue) { $ArtifactKindValue.ToUpperInvariant() } else { "" }
  if ($artifact -eq "CONTAINER_IMAGE") { return "container" }
  return "-"
}

function Load-AdapterEvidence {
  param([string]$ResolvedRunDir)
  $safeReceiptPath = Join-Path $ResolvedRunDir "safe_run_receipt.json"
  $summaryPath = Join-Path $ResolvedRunDir "analysis\adapter_summary_v0.json"
  $findingsPath = Join-Path $ResolvedRunDir "analysis\adapter_findings_v0.json"
  $capabilityPath = Join-Path $ResolvedRunDir "analysis\capability_ledger_v0.json"

  $safeReceipt = Read-JsonFile -PathValue $safeReceiptPath
  $summary = Read-JsonFile -PathValue $summaryPath
  $findings = Read-JsonFile -PathValue $findingsPath
  $capability = Read-JsonFile -PathValue $capabilityPath

  $adapterId = Get-StringValue -Value $safeReceipt.adapter.adapterId
  $sourceFormat = Get-StringValue -Value $safeReceipt.adapter.sourceFormat
  $mode = Get-StringValue -Value $safeReceipt.adapter.mode
  $artifactKind = Get-StringValue -Value $safeReceipt.artifactKind
  $adapterClass = Get-AdapterClassLabel -AdapterIdValue $adapterId -ArtifactKindValue $artifactKind
  if ($adapterClass -eq "-" -and $summary -and $summary.sourceClass) {
    $adapterClass = [string]$summary.sourceClass
  }
  $adapterReasons = Format-ReasonPreview -ReasonCodes $safeReceipt.adapter.reasonCodes -MaxItems 4
  if ($adapterReasons -eq "-" -and $summary -and $summary.reasonCodes) {
    $adapterReasons = Format-ReasonPreview -ReasonCodes $summary.reasonCodes -MaxItems 4
  }

  $requestedCount = if ($capability -and $capability.requestedCaps -is [System.Array]) { [int]$capability.requestedCaps.Count } else { 0 }
  $grantedCount = if ($capability -and $capability.grantedCaps -is [System.Array]) { [int]$capability.grantedCaps.Count } else { 0 }
  $deniedCount = if ($capability -and $capability.deniedCaps -is [System.Array]) { [int]$capability.deniedCaps.Count } else { 0 }

  $hasEvidence = $false
  if ($adapterClass -ne "-" -or $requestedCount -gt 0 -or $grantedCount -gt 0 -or $deniedCount -gt 0) {
    $hasEvidence = $true
  }
  if (-not $hasEvidence) {
    return [ordered]@{
      available = $false
      class = "-"
      adapterId = "-"
      sourceFormat = "-"
      mode = "-"
      reasons = "-"
      requested = 0
      granted = 0
      denied = 0
      capabilityPath = $capabilityPath
      summaryPath = $summaryPath
      findingsPath = $findingsPath
    }
  }

  return [ordered]@{
    available = $true
    class = $adapterClass
    adapterId = $adapterId
    sourceFormat = $sourceFormat
    mode = $mode
    reasons = $adapterReasons
    requested = $requestedCount
    granted = $grantedCount
    denied = $deniedCount
    capabilityPath = $capabilityPath
    summaryPath = $summaryPath
    findingsPath = $findingsPath
  }
}

function Load-ReportModel {
  param([string]$ResolvedRunDir)
  $txtPath = Join-Path $ResolvedRunDir "report_card.txt"
  $jsonPath = Join-Path $ResolvedRunDir "report_card_v0.json"
  $safeReceiptDigest = Compute-FileSha256Digest -PathValue (Join-Path $ResolvedRunDir "safe_run_receipt.json")
  $operatorReceiptDigest = Compute-FileSha256Digest -PathValue (Join-Path $ResolvedRunDir "operator_receipt.json")
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
      $adapterEvidence = Load-AdapterEvidence -ResolvedRunDir $ResolvedRunDir
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
        adapterEvidence = $adapterEvidence
        lines = if ($json.lines) { @($json.lines | ForEach-Object { [string]$_ }) } else { $lines }
        reportTextPath = $txtPath
        safeReceiptDigest = $safeReceiptDigest
        operatorReceiptDigest = $operatorReceiptDigest
      }
    } catch {
      # Fall through to text parsing.
    }
  }

  $map = Parse-ReportTextMap -Lines $lines
  $adapterEvidence = Load-AdapterEvidence -ResolvedRunDir $ResolvedRunDir
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
    adapterEvidence = $adapterEvidence
    lines = $lines
    reportTextPath = $txtPath
    safeReceiptDigest = $safeReceiptDigest
    operatorReceiptDigest = $operatorReceiptDigest
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

function Open-FileIfExists {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return }
  try {
    Start-Process -FilePath $PathValue | Out-Null
  } catch {
    # best effort
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
$summaryTable.RowCount = 0
$summaryTable.Margin = New-Object System.Windows.Forms.Padding(0)
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
Add-SummaryLine -TextValue ("Safe Receipt Digest: " + (Get-StringValue -Value $model.safeReceiptDigest))
Add-SummaryLine -TextValue ("Operator Receipt Digest: " + (Get-StringValue -Value $model.operatorReceiptDigest))
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
if ($model.adapterEvidence -and $model.adapterEvidence.available) {
  $modeText = if ($model.adapterEvidence.mode -and $model.adapterEvidence.mode -ne "-") {
    [string]$model.adapterEvidence.mode
  } else {
    "built_in"
  }
  Add-SummaryLine -TextValue ("Adapter Class: " + (Get-StringValue -Value $model.adapterEvidence.class))
  Add-SummaryLine -TextValue ("Adapter: " + (Get-StringValue -Value $model.adapterEvidence.adapterId) + " (" + $modeText + ")")
  Add-SummaryLine -TextValue ("Source Format: " + (Get-StringValue -Value $model.adapterEvidence.sourceFormat))
  Add-SummaryLine -TextValue (
    "Capabilities: requested=" + [string]$model.adapterEvidence.requested +
    " granted=" + [string]$model.adapterEvidence.granted +
    " denied=" + [string]$model.adapterEvidence.denied
  )
  Add-SummaryLine -TextValue ("Adapter Reasons: " + (Get-StringValue -Value $model.adapterEvidence.reasons))
}

$detailsPanel = New-Object System.Windows.Forms.Panel
$detailsPanel.Dock = "Fill"
$detailsPanel.BackColor = $colorPanel
$detailsPanel.Padding = New-Object System.Windows.Forms.Padding(10)
$body.Controls.Add($detailsPanel, 2, 0) | Out-Null

$detailsLayout = New-Object System.Windows.Forms.TableLayoutPanel
$detailsLayout.Dock = "Fill"
$detailsLayout.ColumnCount = 1
$detailsLayout.RowCount = 3
$detailsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 28)))
$detailsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 0)))
$detailsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$detailsPanel.Controls.Add($detailsLayout)

$titleBar = New-Object System.Windows.Forms.TableLayoutPanel
$titleBar.Dock = "Fill"
$titleBar.ColumnCount = 2
$titleBar.RowCount = 1
$titleBar.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$titleBar.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 150)))

$reportTitle = New-Object System.Windows.Forms.Label
$reportTitle.Text = "Detailed Report"
$reportTitle.Dock = "Fill"
$reportTitle.ForeColor = $colorText
$reportTitle.Font = $fontTitle
$reportTitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$titleBar.Controls.Add($reportTitle, 0, 0) | Out-Null

$btnToggleEvidence = New-Object System.Windows.Forms.Button
$btnToggleEvidence.Text = "Show Adapter Evidence"
$btnToggleEvidence.Width = 138
$btnToggleEvidence.Height = 24
$btnToggleEvidence.Dock = "Right"
Style-Button -Button $btnToggleEvidence -Primary:$false
$btnToggleEvidence.Visible = $false
$titleBar.Controls.Add($btnToggleEvidence, 1, 0) | Out-Null

$detailsLayout.Controls.Add($titleBar, 0, 0) | Out-Null

$adapterPanel = New-Object System.Windows.Forms.Panel
$adapterPanel.Dock = "Fill"
$adapterPanel.BackColor = [System.Drawing.Color]::FromArgb(28, 30, 36)
$adapterPanel.Padding = New-Object System.Windows.Forms.Padding(8, 6, 8, 6)
$adapterPanel.Visible = $false
$detailsLayout.Controls.Add($adapterPanel, 0, 1) | Out-Null

$adapterTable = New-Object System.Windows.Forms.TableLayoutPanel
$adapterTable.Dock = "Fill"
$adapterTable.ColumnCount = 1
$adapterTable.RowCount = 6
$adapterTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 18)))
$adapterTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 18)))
$adapterTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 18)))
$adapterTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 18)))
$adapterTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 18)))
$adapterTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
$adapterPanel.Controls.Add($adapterTable) | Out-Null

function Add-AdapterLine {
  param([string]$TextValue)
  $line = New-Object System.Windows.Forms.Label
  $line.Text = $TextValue
  $line.Dock = "Fill"
  $line.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $line.ForeColor = $colorText
  $line.Font = $fontSmall
  [void]$adapterTable.Controls.Add($line)
}

$hasAdapterEvidence = $model.adapterEvidence -and $model.adapterEvidence.available
if ($hasAdapterEvidence) {
  $modeText = if ($model.adapterEvidence.mode -and $model.adapterEvidence.mode -ne "-") {
    [string]$model.adapterEvidence.mode
  } else {
    "built_in"
  }
  Add-AdapterLine -TextValue ("Class: " + (Get-StringValue -Value $model.adapterEvidence.class))
  Add-AdapterLine -TextValue ("Adapter: " + (Get-StringValue -Value $model.adapterEvidence.adapterId))
  Add-AdapterLine -TextValue ("Mode: " + $modeText + "   Source: " + (Get-StringValue -Value $model.adapterEvidence.sourceFormat))
  Add-AdapterLine -TextValue (
    "Capabilities: requested=" + [string]$model.adapterEvidence.requested +
    " granted=" + [string]$model.adapterEvidence.granted +
    " denied=" + [string]$model.adapterEvidence.denied
  )
  Add-AdapterLine -TextValue ("Reasons: " + (Get-StringValue -Value $model.adapterEvidence.reasons))

  $adapterActions = New-Object System.Windows.Forms.FlowLayoutPanel
  $adapterActions.Dock = "Fill"
  $adapterActions.FlowDirection = "LeftToRight"
  $adapterActions.WrapContents = $false
  $adapterActions.BackColor = $adapterPanel.BackColor

  $btnOpenCapability = New-Object System.Windows.Forms.Button
  $btnOpenCapability.Text = "Capability"
  $btnOpenCapability.Width = 82
  $btnOpenCapability.Height = 24
  Style-Button -Button $btnOpenCapability -Primary:$false
  $btnOpenCapability.Enabled = (Test-Path -LiteralPath $model.adapterEvidence.capabilityPath)
  $btnOpenCapability.Add_Click({ Open-FileIfExists -PathValue $model.adapterEvidence.capabilityPath })
  $adapterActions.Controls.Add($btnOpenCapability) | Out-Null

  $btnOpenSummary = New-Object System.Windows.Forms.Button
  $btnOpenSummary.Text = "Summary"
  $btnOpenSummary.Width = 82
  $btnOpenSummary.Height = 24
  Style-Button -Button $btnOpenSummary -Primary:$false
  $btnOpenSummary.Enabled = (Test-Path -LiteralPath $model.adapterEvidence.summaryPath)
  $btnOpenSummary.Add_Click({ Open-FileIfExists -PathValue $model.adapterEvidence.summaryPath })
  $adapterActions.Controls.Add($btnOpenSummary) | Out-Null

  $btnOpenFindings = New-Object System.Windows.Forms.Button
  $btnOpenFindings.Text = "Findings"
  $btnOpenFindings.Width = 82
  $btnOpenFindings.Height = 24
  Style-Button -Button $btnOpenFindings -Primary:$false
  $btnOpenFindings.Enabled = (Test-Path -LiteralPath $model.adapterEvidence.findingsPath)
  $btnOpenFindings.Add_Click({ Open-FileIfExists -PathValue $model.adapterEvidence.findingsPath })
  $adapterActions.Controls.Add($btnOpenFindings) | Out-Null

  [void]$adapterTable.Controls.Add($adapterActions)
}

$adapterExpanded = $false
if ($hasAdapterEvidence) {
  $btnToggleEvidence.Visible = $true
  $btnToggleEvidence.Add_Click({
    $adapterExpanded = -not $adapterExpanded
    if ($adapterExpanded) {
      $adapterPanel.Visible = $true
      $detailsLayout.RowStyles[1].Height = 128
      $btnToggleEvidence.Text = "Hide Adapter Evidence"
    } else {
      $adapterPanel.Visible = $false
      $detailsLayout.RowStyles[1].Height = 0
      $btnToggleEvidence.Text = "Show Adapter Evidence"
    }
  })
}

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
$detailsLayout.Controls.Add($reportText, 0, 2) | Out-Null

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
    "safeReceiptDigest=" + (Get-StringValue -Value $model.safeReceiptDigest),
    "operatorReceiptDigest=" + (Get-StringValue -Value $model.operatorReceiptDigest),
    "reason=" + (Get-StringValue -Value $model.reason),
    "runId=" + (Get-StringValue -Value $model.runId),
    "baseline=" + (Get-StringValue -Value $model.baseline),
    "latest=" + (Get-StringValue -Value $model.latest),
    "buckets=" + (Get-StringValue -Value $model.buckets)
  ) -join [Environment]::NewLine
  if ($model.adapterEvidence -and $model.adapterEvidence.available) {
    $summary = $summary + [Environment]::NewLine + (
      @(
        "adapterClass=" + (Get-StringValue -Value $model.adapterEvidence.class),
        "adapterId=" + (Get-StringValue -Value $model.adapterEvidence.adapterId),
        "adapterMode=" + (Get-StringValue -Value $model.adapterEvidence.mode),
        "capabilities=requested:" + [string]$model.adapterEvidence.requested + ",granted:" + [string]$model.adapterEvidence.granted + ",denied:" + [string]$model.adapterEvidence.denied
      ) -join [Environment]::NewLine
    )
  }
  [System.Windows.Forms.Clipboard]::SetText($summary)
})
$footer.Controls.Add($btnCopy) | Out-Null

$btnCopyDigests = New-Object System.Windows.Forms.Button
$btnCopyDigests.Text = "Copy Digests"
$btnCopyDigests.Width = 104
$btnCopyDigests.Height = 30
Style-Button -Button $btnCopyDigests -Primary:$false
$btnCopyDigests.Add_Click({
  $summary = @(
    "runId=" + (Get-StringValue -Value $model.runId),
    "artifactFingerprint=" + (Get-StringValue -Value $model.artifactFingerprint),
    "artifactDigest=" + (Get-StringValue -Value $model.artifactDigest),
    "safeReceiptDigest=" + (Get-StringValue -Value $model.safeReceiptDigest),
    "operatorReceiptDigest=" + (Get-StringValue -Value $model.operatorReceiptDigest)
  ) -join [Environment]::NewLine
  [System.Windows.Forms.Clipboard]::SetText($summary)
})
$footer.Controls.Add($btnCopyDigests) | Out-Null

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
