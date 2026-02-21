# tools/windows/open_release_folder.ps1
# Opens the local release folder. Optionally builds the release zip if missing.

param(
  [switch]$BuildIfMissing
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$outDir = Join-Path $repoRoot "out\release"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powershellExe)) {
  $powershellExe = "powershell.exe"
}

if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

$zipExists = Get-ChildItem -Path $outDir -Filter "weftend_*.zip" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $zipExists -and $BuildIfMissing.IsPresent) {
  $zipScript = Join-Path $repoRoot "weftend_release_zip.ps1"
  if (Test-Path -LiteralPath $zipScript) {
    & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $zipScript -OutDir $outDir | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Release zip build failed (exit $LASTEXITCODE)."
    }
  }
}

$explorerPath = Join-Path $env:WINDIR "explorer.exe"
if (-not (Test-Path $explorerPath)) {
  $explorerPath = "explorer.exe"
}
Start-Process -FilePath $explorerPath -ArgumentList "`"$outDir`""
