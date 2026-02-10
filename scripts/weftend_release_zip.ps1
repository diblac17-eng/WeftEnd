param(
  [string]$OutDir = "out\\release"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$zipScript = Join-Path $repoRoot "weftend_release_zip.ps1"

if (-not (Test-Path $zipScript)) {
  Write-Error "Missing release zip script: $zipScript"
  exit 1
}

& powershell -ExecutionPolicy Bypass -File $zipScript -OutDir $OutDir
exit $LASTEXITCODE
