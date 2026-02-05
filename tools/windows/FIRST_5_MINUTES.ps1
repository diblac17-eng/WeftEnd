# tools/windows/FIRST_5_MINUTES.ps1
# First 5 minutes operator smoke (no paths in report output).

$ErrorActionPreference = "Stop"

function Write-ReportLine {
  param([string]$Path, [string]$Line)
  Add-Content -Path $Path -Value $Line
}

function Ensure-Dir {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path) { return $cmd.Path }
  return $null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\\..")
$cliPath = Join-Path $repoRoot "dist\\src\\cli\\main.js"
$demoRoot = Join-Path $repoRoot "demo"
$outRoot = Join-Path $repoRoot "out\\first_5_minutes"
$report = Join-Path $outRoot "FIRST_5_MINUTES_REPORT.txt"

if (-not (Test-Path $cliPath)) {
  Write-Error "Missing dist CLI: dist\\src\\cli\\main.js"
  exit 1
}

$node = Find-Node
if (-not $node) {
  Write-Error "node not found on PATH"
  exit 1
}

Ensure-Dir $outRoot
Remove-Item -Force $report -ErrorAction SilentlyContinue
Write-ReportLine $report "weftend_first_5_minutes=v0"

# Prepare targets (copy demo stubs to out/ so we do not mutate repo fixtures)
$targetsRoot = Join-Path $outRoot "targets"
Ensure-Dir $targetsRoot

$nativeSrc = Join-Path $demoRoot "native_app_stub"
$webSrc = Join-Path $demoRoot "web_export_stub"
$nativeTarget = Join-Path $targetsRoot "native_app_stub"
$webTarget = Join-Path $targetsRoot "web_export_stub"

Remove-Item -Recurse -Force $nativeTarget -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $webTarget -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force $nativeSrc $nativeTarget
Copy-Item -Recurse -Force $webSrc $webTarget

# Run safe-run on native stub
$runNative = Join-Path $outRoot "run_native_1"
Remove-Item -Recurse -Force $runNative -ErrorAction SilentlyContinue
& $node $cliPath safe-run $nativeTarget --out $runNative | Out-Null
$nativeOk = Test-Path (Join-Path $runNative "safe_run_receipt.json")
Write-ReportLine $report ("native_stub=" + ($(if ($nativeOk) { "PASS" } else { "FAIL" })))

# Run safe-run on web stub (baseline)
$runWeb1 = Join-Path $outRoot "run_web_1"
Remove-Item -Recurse -Force $runWeb1 -ErrorAction SilentlyContinue
& $node $cliPath safe-run $webTarget --out $runWeb1 | Out-Null
$web1Ok = Test-Path (Join-Path $runWeb1 "safe_run_receipt.json")
Write-ReportLine $report ("web_stub_run1=" + ($(if ($web1Ok) { "PASS" } else { "FAIL" })))

# Modify a file (append a marker)
$markerPath = Join-Path $webTarget "app.js"
Add-Content -Path $markerPath -Value "// change" -Encoding UTF8

# Run safe-run on web stub (after change)
$runWeb2 = Join-Path $outRoot "run_web_2"
Remove-Item -Recurse -Force $runWeb2 -ErrorAction SilentlyContinue
& $node $cliPath safe-run $webTarget --out $runWeb2 | Out-Null
$web2Ok = Test-Path (Join-Path $runWeb2 "safe_run_receipt.json")
Write-ReportLine $report ("web_stub_run2=" + ($(if ($web2Ok) { "PASS" } else { "FAIL" })))

# Compare
$diffOut = Join-Path $outRoot "diff_web"
Remove-Item -Recurse -Force $diffOut -ErrorAction SilentlyContinue
& $node $cliPath compare $runWeb1 $runWeb2 --out $diffOut | Out-Null
$compareOk = Test-Path (Join-Path $diffOut "compare_report.txt")
Write-ReportLine $report ("compare=" + ($(if ($compareOk) { "PASS" } else { "FAIL" })))

$overall = if ($nativeOk -and $web1Ok -and $web2Ok -and $compareOk) { "PASS" } else { "FAIL" }
Write-ReportLine $report ("overall=" + $overall)

Write-Host "FIRST_5_MINUTES_REPORT.txt written."
exit 0
