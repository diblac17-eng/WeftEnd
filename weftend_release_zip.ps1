param(
  [string]$OutDir = "out\\release"
)

Set-StrictMode -Version Latest
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

function Resolve-LocalNodeRoot {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path -and (Test-Path -LiteralPath $cmd.Path)) {
    return Split-Path -Parent $cmd.Path
  }
  $programFiles = [Environment]::GetFolderPath("ProgramFiles")
  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  $candidates = @(
    (Join-Path $programFiles "nodejs"),
    (Join-Path $programFilesX86 "nodejs"),
    (Join-Path $localAppData "Programs\nodejs")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "node.exe"))) {
      return $candidate
    }
  }
  return $null
}

function New-ZipAndHash {
  param(
    [string]$StagePath,
    [string]$OutDirPath,
    [string]$ZipName
  )
  $zipPath = Join-Path $OutDirPath $ZipName
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -Force -LiteralPath $zipPath
  }
  Compress-Archive -Path (Join-Path $StagePath "*") -DestinationPath $zipPath -Force
  if (-not (Test-Path -LiteralPath $zipPath)) {
    Write-Fail "Zip not created: $zipName" "Check write permissions under $OutDirPath"
  }
  $hash = Get-FileHash -Algorithm SHA256 -Path $zipPath
  $shaPath = "${zipPath}.sha256"
  "$($hash.Hash.ToLower()) *$ZipName" | Set-Content -Path $shaPath -Encoding ascii
  return @{
    Zip = $zipPath
    Sha = $shaPath
  }
}

function Copy-SidecarFileAtomic {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )
  $stagePath = "${DestinationPath}.stage"
  if (Test-Path -LiteralPath $stagePath) {
    Remove-Item -Force -LiteralPath $stagePath
  }
  Copy-Item -LiteralPath $SourcePath -Destination $stagePath -Force
  Move-Item -LiteralPath $stagePath -Destination $DestinationPath -Force
}

function Remove-ReleaseNoise {
  param(
    [string]$StageRoot
  )
  $removedCount = 0
  $distRoot = Join-Path $StageRoot "dist"
  if (Test-Path -LiteralPath $distRoot) {
    $testFiles = Get-ChildItem -Path $distRoot -Recurse -File -Include "*.test.js", "*.spec.js", "*_test.js" -ErrorAction SilentlyContinue
    foreach ($testFile in $testFiles) {
      Remove-Item -Force -LiteralPath $testFile.FullName
      $removedCount += 1
    }
  }

  $demoNativeStub = Join-Path $StageRoot "demo\\native_app_stub\\app.exe"
  if (Test-Path -LiteralPath $demoNativeStub) {
    Remove-Item -Force -LiteralPath $demoNativeStub
    $removedCount += 1
  }

  return $removedCount
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
$portableZipName = "weftend_${version}_${dateStamp}_portable.zip"

Write-Section "Create Stage"
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
  Write-Fail "git is required to build a clean release bundle." "Install git and retry."
}

$trackedRaw = & git -C $root ls-files
if ($LASTEXITCODE -ne 0) {
  Write-Fail "git ls-files failed." "Ensure this repo has a valid git index."
}

$stagePath = Join-Path $outAbs "__stage_release"
if (Test-Path $stagePath) {
  Remove-Item -Recurse -Force $stagePath
}
New-Item -ItemType Directory -Path $stagePath | Out-Null

Copy-Item -Path $distPath -Destination (Join-Path $stagePath "dist") -Recurse -Force
Write-Ok "dist/ staged"

$includePrefixes = @(
  "scripts/",
  "docs/",
  "assets/",
  "policies/",
  "tools/windows/",
  "demo/",
  "examples/"
)
$includeSingles = @(
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "NOTICE.md",
  "SECURITY.md",
  "VERSION.txt",
  "tsconfig.json",
  "WEFTEND_PORTABLE.cmd",
  "WEFTEND_PORTABLE_MENU.cmd"
)

function Should-IncludeTracked($relPath) {
  foreach ($single in $includeSingles) {
    if ($relPath -ieq $single) { return $true }
  }
  foreach ($prefix in $includePrefixes) {
    if ($relPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Copy-TrackedToStage($relativePath) {
  $src = Join-Path $root ($relativePath -replace "/", "\\")
  if (-not (Test-Path $src)) { return }
  $dst = Join-Path $stagePath ($relativePath -replace "/", "\\")
  $dstDir = Split-Path -Parent $dst
  if ($dstDir -and -not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }
  Copy-Item -Path $src -Destination $dst -Force
}

foreach ($line in $trackedRaw) {
  $rel = "$line".Trim()
  if (-not $rel) { continue }
  if (Should-IncludeTracked $rel) {
    Copy-TrackedToStage $rel
  }
}

# Ensure allowlisted root single files are staged even when newly added and not yet tracked.
foreach ($single in $includeSingles) {
  $singleSrc = Join-Path $root ($single -replace "/", "\\")
  if (-not (Test-Path -LiteralPath $singleSrc)) { continue }
  $singleDst = Join-Path $stagePath ($single -replace "/", "\\")
  $singleDir = Split-Path -Parent $singleDst
  if ($singleDir -and -not (Test-Path -LiteralPath $singleDir)) {
    New-Item -ItemType Directory -Path $singleDir -Force | Out-Null
  }
  Copy-Item -Force -LiteralPath $singleSrc -Destination $singleDst
}

Write-Ok "Stage built"

# Ensure docs assets are staged even if untracked (docs/ assets are public).
$docsAssetsSrc = Join-Path $root "docs\\assets"
if (Test-Path -LiteralPath $docsAssetsSrc) {
  $docsAssetsDst = Join-Path $stagePath "docs\\assets"
  if (-not (Test-Path -LiteralPath $docsAssetsDst)) {
    New-Item -ItemType Directory -Path $docsAssetsDst -Force | Out-Null
  }
  Copy-Item -Path (Join-Path $docsAssetsSrc "*") -Destination $docsAssetsDst -Recurse -Force
  Write-Ok "docs/assets staged"
}

$noiseRemoved = Remove-ReleaseNoise -StageRoot $stagePath
if ($noiseRemoved -gt 0) {
  Write-Ok "Release hygiene prune removed $noiseRemoved staged file(s)"
}

Write-Section "Create Standard Zip"
$standardBundle = New-ZipAndHash -StagePath $stagePath -OutDirPath $outAbs -ZipName $zipName
Write-Ok "Release zip: $($standardBundle.Zip)"
Write-Ok "SHA256: $($standardBundle.Sha)"

Write-Section "Create Portable Zip"
$nodeRoot = Resolve-LocalNodeRoot
if (-not $nodeRoot) {
  Remove-Item -Recurse -Force $stagePath
  Write-Fail "Node runtime not found for portable bundle." "Install Node.js locally and retry release packaging."
}
$portableStagePath = Join-Path $outAbs "__stage_release_portable"
if (Test-Path -LiteralPath $portableStagePath) {
  Remove-Item -Recurse -Force -LiteralPath $portableStagePath
}
New-Item -ItemType Directory -Path $portableStagePath | Out-Null
Copy-Item -Recurse -Force -Path (Join-Path $stagePath "*") -Destination $portableStagePath
$runtimeNodeDir = Join-Path $portableStagePath "runtime\node"
New-Item -ItemType Directory -Force -Path $runtimeNodeDir | Out-Null
$nodeFiles = @(
  "node.exe",
  "node.dll",
  "npm.cmd",
  "npx.cmd"
)
foreach ($nodeFile in $nodeFiles) {
  $src = Join-Path $nodeRoot $nodeFile
  if (Test-Path -LiteralPath $src) {
    Copy-Item -Force -LiteralPath $src -Destination (Join-Path $runtimeNodeDir $nodeFile)
  }
}
Get-ChildItem -Path $nodeRoot -Filter "*.dll" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $runtimeNodeDir $_.Name)
}
Get-ChildItem -Path $nodeRoot -Filter "icudt*.dat" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $runtimeNodeDir $_.Name)
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeNodeDir "node.exe"))) {
  Remove-Item -Recurse -Force $stagePath
  Remove-Item -Recurse -Force $portableStagePath
  Write-Fail "Portable runtime missing node.exe after staging." "Verify local Node install and retry."
}
$portableBundle = New-ZipAndHash -StagePath $portableStagePath -OutDirPath $outAbs -ZipName $portableZipName
Write-Ok "Portable zip: $($portableBundle.Zip)"
Write-Ok "SHA256: $($portableBundle.Sha)"

Remove-Item -Recurse -Force $stagePath
Remove-Item -Recurse -Force $portableStagePath

Write-Section "Prune Old Zips"
$keepZips = @($zipName, $portableZipName)
$keepHashes = @("${zipName}.sha256", "${portableZipName}.sha256")
Get-ChildItem -Path $outAbs -Filter "weftend_*.zip" -File -ErrorAction SilentlyContinue | Where-Object { $keepZips -notcontains $_.Name } | ForEach-Object {
  Remove-Item -Force $_.FullName
}
Get-ChildItem -Path $outAbs -Filter "weftend_*.zip.sha256" -File -ErrorAction SilentlyContinue | Where-Object { $keepHashes -notcontains $_.Name } | ForEach-Object {
  Remove-Item -Force $_.FullName
}

Write-Section "Release Notes"
$releaseNotes = Join-Path $root "docs\\RELEASE_NOTES.txt"
if (Test-Path $releaseNotes) {
  Copy-SidecarFileAtomic -SourcePath $releaseNotes -DestinationPath (Join-Path $outAbs "RELEASE_NOTES.txt")
  Write-Ok "RELEASE_NOTES.txt copied"
} else {
  Write-Warn "docs/RELEASE_NOTES.txt not found, skipping"
}

$releaseAnnouncement = Join-Path $root "docs\\RELEASE_ANNOUNCEMENT.txt"
if (Test-Path $releaseAnnouncement) {
  Copy-SidecarFileAtomic -SourcePath $releaseAnnouncement -DestinationPath (Join-Path $outAbs "RELEASE_ANNOUNCEMENT.txt")
  Write-Ok "RELEASE_ANNOUNCEMENT.txt copied"
} else {
  Write-Warn "docs/RELEASE_ANNOUNCEMENT.txt not found, skipping"
}

$quickstart = Join-Path $root "docs\\QUICKSTART.txt"
if (Test-Path $quickstart) {
  Copy-SidecarFileAtomic -SourcePath $quickstart -DestinationPath (Join-Path $outAbs "QUICKSTART.txt")
  Write-Ok "QUICKSTART.txt copied"
} else {
  Write-Warn "docs/QUICKSTART.txt not found, skipping"
}

$releaseChecklist = Join-Path $root "docs\\RELEASE_CHECKLIST_ALPHA.md"
if (Test-Path $releaseChecklist) {
  Copy-SidecarFileAtomic -SourcePath $releaseChecklist -DestinationPath (Join-Path $outAbs "RELEASE_CHECKLIST_ALPHA.md")
  Write-Ok "RELEASE_CHECKLIST_ALPHA.md copied"
} else {
  Write-Warn "docs/RELEASE_CHECKLIST_ALPHA.md not found, skipping"
}

$releaseHistory = Join-Path $root "docs\\RELEASE_HISTORY.md"
if (Test-Path $releaseHistory) {
  Copy-SidecarFileAtomic -SourcePath $releaseHistory -DestinationPath (Join-Path $outAbs "RELEASE_HISTORY.md")
  Write-Ok "RELEASE_HISTORY.md copied"
} else {
  Write-Warn "docs/RELEASE_HISTORY.md not found, skipping"
}

$changelog = Join-Path $root "CHANGELOG.md"
if (Test-Path $changelog) {
  Copy-SidecarFileAtomic -SourcePath $changelog -DestinationPath (Join-Path $outAbs "CHANGELOG.md")
  Write-Ok "CHANGELOG.md copied"
} else {
  Write-Warn "CHANGELOG.md not found, skipping"
}
