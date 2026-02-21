param(
  [string]$OutDir = "out\release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$zipScript = Join-Path $repoRoot "weftend_release_zip.ps1"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powershellExe)) {
  $powershellExe = "powershell.exe"
}

if (-not (Test-Path -LiteralPath $zipScript)) {
  Write-Error "Missing release zip script: $zipScript"
  exit 1
}

& $powershellExe -ExecutionPolicy Bypass -File $zipScript -OutDir $OutDir
exit $LASTEXITCODE
