param(
  [string]$OutDir = "out\\first_5_minutes"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NodePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path) { return [string]$cmd.Path }
  return $null
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return (Get-Content -Raw -Path $Path | ConvertFrom-Json) } catch { return $null }
}

function Write-ReportLine {
  param([System.Collections.Generic.List[string]]$Lines, [string]$Line)
  $Lines.Add($Line) | Out-Null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..\\..")
$node = Resolve-NodePath
if (-not $node) { Write-Error "NODE_MISSING"; exit 1 }

$mainJs = Join-Path $root "dist\\src\\cli\\main.js"
if (-not (Test-Path -LiteralPath $mainJs)) { Write-Error "DIST_MISSING"; exit 1 }

$outAbs = Join-Path $root $OutDir
New-Item -ItemType Directory -Force -Path $outAbs | Out-Null

$reportLines = New-Object System.Collections.Generic.List[string]
Write-ReportLine $reportLines "FIRST_5_MINUTES_REPORT"

$overallOk = $true

# 1) Native stub
$nativeTarget = Join-Path $root "demo\\native_app_stub\\app.exe"
$nativeOut = Join-Path $outAbs "native_run"
& $node $mainJs safe-run $nativeTarget --out $nativeOut --withhold-exec | Out-Null
$nativeExit = $LASTEXITCODE
$nativeReceipt = Read-JsonFile (Join-Path $nativeOut "safe_run_receipt.json")
$nativeOk = ($nativeExit -eq 0) -and $nativeReceipt -and ($nativeReceipt.execution.result -eq "WITHHELD")
if (-not $nativeOk) { $overallOk = $false }
$nativeStatus = if ($nativeOk) { "PASS" } else { "FAIL" }
Write-ReportLine $reportLines ("native_stub=" + $nativeStatus)

# 2) Web stub
$webSource = Join-Path $root "demo\\web_export_stub"
$webWork = Join-Path $outAbs "web_work"
if (Test-Path -LiteralPath $webWork) { Remove-Item -Recurse -Force $webWork }
Copy-Item -Recurse -Force -Path $webSource -Destination $webWork
$webOut1 = Join-Path $outAbs "web_run_1"
& $node $mainJs safe-run $webWork --out $webOut1 | Out-Null
$webExit1 = $LASTEXITCODE
$webReceipt1 = Read-JsonFile (Join-Path $webOut1 "safe_run_receipt.json")
$webOk1 = ($webExit1 -eq 0) -and $webReceipt1
if (-not $webOk1) { $overallOk = $false }
$webStatus1 = if ($webOk1) { "PASS" } else { "FAIL" }
Write-ReportLine $reportLines ("web_stub_first=" + $webStatus1)

# Modify one file (deterministic)
$editPath = Join-Path $webWork "app.js"
if (Test-Path -LiteralPath $editPath) {
  Add-Content -Path $editPath -Value "// change" -Encoding UTF8
}

$webOut2 = Join-Path $outAbs "web_run_2"
& $node $mainJs safe-run $webWork --out $webOut2 | Out-Null
$webExit2 = $LASTEXITCODE
$webReceipt2 = Read-JsonFile (Join-Path $webOut2 "safe_run_receipt.json")
$webOk2 = ($webExit2 -eq 0) -and $webReceipt2
if (-not $webOk2) { $overallOk = $false }
$webStatus2 = if ($webOk2) { "PASS" } else { "FAIL" }
Write-ReportLine $reportLines ("web_stub_second=" + $webStatus2)

# 3) Compare
$compareOut = Join-Path $outAbs "compare"
& $node $mainJs compare $webOut1 $webOut2 --out $compareOut | Out-Null
$compareExit = $LASTEXITCODE
$compareReceipt = Read-JsonFile (Join-Path $compareOut "compare_receipt.json")
$compareOk = ($compareExit -eq 0) -and $compareReceipt -and ($compareReceipt.verdict -eq "CHANGED")
if (-not $compareOk) { $overallOk = $false }
$compareStatus = if ($compareOk) { "PASS" } else { "FAIL" }
Write-ReportLine $reportLines ("compare=" + $compareStatus)

$overallStatus = if ($overallOk) { "PASS" } else { "FAIL" }
Write-ReportLine $reportLines ("overall=" + $overallStatus)

$reportPath = Join-Path $outAbs "FIRST_5_MINUTES_REPORT.txt"
$reportLines | Set-Content -Path $reportPath -Encoding ASCII
foreach ($line in $reportLines) { Write-Output $line }

if (-not $overallOk) { exit 1 }
exit 0
