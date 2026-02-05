param(
  [string]$OutDir = "out\\release"
)

$ErrorActionPreference = "Stop"

function Write-Section($title) {
  Write-Host ""
  Write-Host "== $title ==" -ForegroundColor Cyan
}

function Write-Ok($message) {
  Write-Host "OK: $message" -ForegroundColor Green
}

function Write-Warn($message) {
  Write-Host "WARN: $message" -ForegroundColor Yellow
}

function Write-Fail($message, $next = $null) {
  Write-Host "FAIL: $message" -ForegroundColor Red
  if ($next) {
    Write-Host "Next: $next" -ForegroundColor Yellow
  }
  exit 1
}

function Get-RepoRoot {
  $start = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $current = $start
  while ($true) {
    $pkg = Join-Path $current "package.json"
    if (Test-Path $pkg) { return $current }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current -or [string]::IsNullOrWhiteSpace($parent)) { break }
    $current = $parent
  }
  Write-Fail "Could not locate repo root (package.json)." "Run this from inside the repo."
}

function Resolve-UnderRoot($root, $path, $mustExist = $true) {
  $combined = if ([System.IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $root $path }
  $resolved = [System.IO.Path]::GetFullPath($combined)
  if (-not ($resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase))) {
    Write-Fail "Path must live under repo root: $resolved" "Choose a path under $root\\out"
  }
  if ($mustExist -and -not (Test-Path $resolved)) {
    Write-Fail "Path not found: $resolved" "Create it or choose a path under $root"
  }
  return $resolved
}

Write-Section "Repo Root"
$root = Get-RepoRoot
Set-Location $root
Write-Ok "Repo root: $root"

Write-Section "Package Version"
$pkgPath = Join-Path $root "package.json"
if (-not (Test-Path $pkgPath)) {
  Write-Fail "package.json missing." "Run this from inside the repo."
}
$pkg = Get-Content -Raw -Path $pkgPath | ConvertFrom-Json
if (-not $pkg.version) {
  Write-Fail "package.json has no version field." "Set version in package.json"
}
$version = $pkg.version
$dateStamp = Get-Date -Format "yyyyMMdd"
Write-Ok "Version: $version"

Write-Section "Inputs"
$distPath = Join-Path $root "dist"
if (-not (Test-Path $distPath)) {
  Write-Fail "dist/ missing." "Run: npm run compile"
}
$scriptsPath = Join-Path $root "scripts"
$docsPath = Join-Path $root "docs"
if (-not (Test-Path $scriptsPath)) { Write-Fail "scripts/ missing." "Restore scripts/ directory." }
if (-not (Test-Path $docsPath)) { Write-Fail "docs/ missing." "Restore docs/ directory." }

$items = @($distPath, $scriptsPath, $docsPath)
$assetsPath = Join-Path $root "assets"
if (Test-Path $assetsPath) {
  $items += $assetsPath
  Write-Ok "assets/ included"
} else {
  Write-Warn "assets/ not found, skipping"
}
$policiesPath = Join-Path $root "policies"
if (Test-Path $policiesPath) {
  $items += $policiesPath
  Write-Ok "policies/ included"
} else {
  Write-Warn "policies/ not found, skipping"
}
$toolsWindowsPath = Join-Path $root "tools\\windows"
if (Test-Path $toolsWindowsPath) {
  $items += $toolsWindowsPath
  Write-Ok "tools/windows included"
} else {
  Write-Warn "tools/windows not found, skipping"
}
$demoPath = Join-Path $root "demo"
if (Test-Path $demoPath) {
  $items += $demoPath
  Write-Ok "demo/ included"
} else {
  Write-Warn "demo/ not found, skipping"
}
$srcPath = Join-Path $root "src"
if (Test-Path $srcPath) {
  $items += $srcPath
  Write-Ok "src/ included"
} else {
  Write-Warn "src/ not found, skipping"
}
$tsconfigPath = Join-Path $root "tsconfig.json"
if (Test-Path $tsconfigPath) {
  $items += $tsconfigPath
  Write-Ok "tsconfig.json included"
}
$examplesPath = Join-Path $root "examples"
if (Test-Path $examplesPath) {
  $items += $examplesPath
  Write-Ok "examples/ included"
} else {
  Write-Warn "examples/ not found, skipping"
}

$harnessPath = Join-Path $root "test\\harness"
if (Test-Path $harnessPath) {
  $items += $harnessPath
  Write-Ok "test/harness included"
} else {
  Write-Warn "test/harness not found, skipping"
}

$items += (Join-Path $root "package.json")
$packageLock = Join-Path $root "package-lock.json"
if (Test-Path $packageLock) {
  $items += $packageLock
  Write-Ok "package-lock.json included"
}
$readmePath = Join-Path $root "README.md"
if (Test-Path $readmePath) {
  $items += $readmePath
  Write-Ok "README.md included"
}
$licensePath = Join-Path $root "LICENSE"
if (Test-Path $licensePath) {
  $items += $licensePath
  Write-Ok "LICENSE included"
}
$noticePath = Join-Path $root "NOTICE.md"
if (Test-Path $noticePath) {
  $items += $noticePath
  Write-Ok "NOTICE.md included"
}
$securityPath = Join-Path $root "SECURITY.md"
if (Test-Path $securityPath) {
  $items += $securityPath
  Write-Ok "SECURITY.md included"
}
$versionPath = Join-Path $root "VERSION.txt"
if (Test-Path $versionPath) {
  $items += $versionPath
  Write-Ok "VERSION.txt included"
}

Write-Section "Output"
$outAbs = Resolve-UnderRoot $root $OutDir $false
if (-not (Test-Path $outAbs)) {
  New-Item -ItemType Directory -Path $outAbs | Out-Null
}
$zipName = "weftend_${version}_${dateStamp}.zip"
$zipPath = Join-Path $outAbs $zipName
if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Write-Section "Create Zip"
Compress-Archive -Path $items -DestinationPath $zipPath -Force
if (-not (Test-Path $zipPath)) {
  Write-Fail "Zip not created." "Check write permissions under $outAbs"
}
Write-Ok "Release zip: $zipPath"

Write-Section "Checksums"
$hash = Get-FileHash -Algorithm SHA256 -Path $zipPath
$shaPath = "${zipPath}.sha256"
"$($hash.Hash.ToLower()) *$zipName" | Set-Content -Path $shaPath -Encoding ascii
Write-Ok "SHA256: $shaPath"

Write-Section "Prune Old Zips"
Get-ChildItem -Path $outAbs -Filter "weftend_*.zip" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $zipName } | ForEach-Object {
  Remove-Item -Force $_.FullName
}
Get-ChildItem -Path $outAbs -Filter "weftend_*.zip.sha256" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "${zipName}.sha256" } | ForEach-Object {
  Remove-Item -Force $_.FullName
}

Write-Section "Release Notes"
$releaseNotes = Join-Path $root "docs\\RELEASE_NOTES.txt"
if (Test-Path $releaseNotes) {
  Copy-Item -Path $releaseNotes -Destination (Join-Path $outAbs "RELEASE_NOTES.txt") -Force
  Write-Ok "RELEASE_NOTES.txt copied"
} else {
  Write-Warn "docs/RELEASE_NOTES.txt not found, skipping"
}

$quickstart = Join-Path $root "docs\\QUICKSTART.txt"
if (Test-Path $quickstart) {
  Copy-Item -Path $quickstart -Destination (Join-Path $outAbs "QUICKSTART.txt") -Force
  Write-Ok "QUICKSTART.txt copied"
} else {
  Write-Warn "docs/QUICKSTART.txt not found, skipping"
}

$releaseChecklist = Join-Path $root "docs\\RELEASE_CHECKLIST_ALPHA.md"
if (Test-Path $releaseChecklist) {
  Copy-Item -Path $releaseChecklist -Destination (Join-Path $outAbs "RELEASE_CHECKLIST_ALPHA.md") -Force
  Write-Ok "RELEASE_CHECKLIST_ALPHA.md copied"
} else {
  Write-Warn "docs/RELEASE_CHECKLIST_ALPHA.md not found, skipping"
}
