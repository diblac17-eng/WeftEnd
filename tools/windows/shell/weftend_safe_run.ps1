# tools/windows/shell/weftend_safe_run.ps1
# Per-user wrapper for WeftEnd safe-run (no admin, no PATH assumptions).

param(
  [Parameter(Position = 0)]
  [string]$TargetPath,
  [Alias("Target")]
  [string]$TargetCompat,
  [string]$RepoRoot,
  [string]$OutRoot,
  [string]$NodeExe,
  [string]$NpmCmd,
  [string]$Policy,
  [string]$Open = "1",
  [string]$LaunchArgsB64,
  [switch]$OpenLibrary,
  [switch]$AllowLaunch,
  [switch]$LaunchpadMode
)

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

function Normalize-TargetPath {
  param([string]$Value)
  if (-not $Value) { return $null }
  $trimmed = $Value.Trim()
  if ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"') -and $trimmed.Length -ge 2) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }
  if ($trimmed -eq "") { return $null }
  return $trimmed
}

function Decode-LaunchArgs {
  param([string]$Value)
  if (-not $Value -or $Value.Trim() -eq "") { return "" }
  try {
    if ($Value.Length -gt 8192) { return "" }
    $bytes = [System.Convert]::FromBase64String($Value)
    if (-not $bytes) { return "" }
    $decoded = [System.Text.Encoding]::UTF8.GetString($bytes)
    if (-not $decoded) { return "" }
    if ($decoded.Length -gt 4096) { return "" }
    return $decoded
  } catch {
    return ""
  }
}

function Is-OpaqueNativeArtifact {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  $ext = [System.IO.Path]::GetExtension($PathValue)
  if (-not $ext) { return $false }
  $normalized = $ext.ToLowerInvariant()
  return $normalized -eq ".exe" -or $normalized -eq ".dll" -or $normalized -eq ".msi" -or $normalized -eq ".sys" -or $normalized -eq ".drv"
}

function Is-LaunchableExecutable {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  $ext = [System.IO.Path]::GetExtension($PathValue)
  if (-not $ext) { return $false }
  return $ext.ToLowerInvariant() -eq ".exe"
}

function Should-LaunchMinimized {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  $leaf = [System.IO.Path]::GetFileName($PathValue).ToLowerInvariant()
  return $leaf -eq "powershell.exe" -or $leaf -eq "pwsh.exe" -or $leaf -eq "cmd.exe"
}

function Is-ShortcutArtifact {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  $ext = [System.IO.Path]::GetExtension($PathValue)
  if (-not $ext) { return $false }
  return $ext.ToLowerInvariant() -eq ".lnk"
}

function Normalize-QuotedPath {
  param([string]$Value)
  if (-not $Value) { return $null }
  $trimmed = $Value.Trim()
  if ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"') -and $trimmed.Length -ge 2) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }
  if ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'") -and $trimmed.Length -ge 2) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }
  $expanded = [Environment]::ExpandEnvironmentVariables($trimmed)
  if (-not $expanded -or $expanded.Trim() -eq "") { return $null }
  return $expanded
}

function Resolve-ShortcutScanTarget {
  param([string]$ShortcutPath)
  if (-not (Is-ShortcutArtifact -PathValue $ShortcutPath)) {
    return @{ ok = $false; reason = "NOT_SHORTCUT" }
  }
  if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    return @{ ok = $false; reason = "SHORTCUT_MISSING" }
  }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    $target = Normalize-QuotedPath -Value ([string]$sc.TargetPath)
    $args = [string]$sc.Arguments
    if (-not $target -or -not (Test-Path -LiteralPath $target)) {
      return @{ ok = $false; reason = "SHORTCUT_TARGET_MISSING" }
    }

    $leaf = [System.IO.Path]::GetFileName($target).ToLowerInvariant()
    $isPowerShellHost = $leaf -eq "powershell.exe" -or $leaf -eq "pwsh.exe"
    if ($isPowerShellHost -and $args) {
      $m = [System.Text.RegularExpressions.Regex]::Match(
        $args,
        '-File\s+("[^"]+"|''[^'']+''|\S+)',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      )
      if ($m.Success) {
        $scriptCandidate = Normalize-QuotedPath -Value $m.Groups[1].Value
        if ($scriptCandidate -and (Test-Path -LiteralPath $scriptCandidate)) {
          return @{ ok = $true; targetPath = $scriptCandidate; source = "SHORTCUT_FILE_ARG" }
        }
      }
    }

    return @{ ok = $true; targetPath = $target; source = "SHORTCUT_TARGET_PATH" }
  } catch {
    return @{ ok = $false; reason = "SHORTCUT_RESOLVE_FAILED" }
  }
}

function Is-EmailArtifact {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  $ext = [System.IO.Path]::GetExtension($PathValue)
  if (-not $ext) { return $false }
  $normalized = $ext.ToLowerInvariant()
  return $normalized -eq ".eml" -or $normalized -eq ".mbox" -or $normalized -eq ".msg"
}

function Detect-TargetKind {
  param([string]$PathValue)
  if (-not $PathValue -or $PathValue.Trim() -eq "") { return "missing" }
  if (-not (Test-Path -LiteralPath $PathValue)) { return "missing" }
  if (Test-Path -LiteralPath $PathValue -PathType Container) { return "directory" }
  if (Is-EmailArtifact -PathValue $PathValue) { return "emailArtifact" }
  if (Is-OpaqueNativeArtifact -PathValue $PathValue) { return "nativeBinary" }
  if (Is-ShortcutArtifact -PathValue $PathValue) { return "shortcut" }
  return "otherFile"
}

function Sha256Hex {
  param([string]$Value)
  if ($null -eq $Value) { $Value = "" }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function ShortSha256Hex {
  param(
    [string]$Value,
    [int]$Length = 16
  )
  $full = Sha256Hex -Value $Value
  if ($Length -lt 1) { return $full }
  if ($Length -gt $full.Length) { return $full }
  return $full.Substring(0, $Length)
}

function Compute-FileSha256Digest {
  param([string]$PathValue)
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return $null }
  try {
    $hash = Get-FileHash -LiteralPath $PathValue -Algorithm SHA256 -ErrorAction Stop
    if (-not $hash -or -not $hash.Hash) { return $null }
    return "sha256:" + ([string]$hash.Hash).ToLowerInvariant()
  } catch {
    return $null
  }
}

function Resolve-ExpectedLaunchDigest {
  param($Summary)
  if (-not $Summary) { return "" }
  try {
    if ($Summary.hashSha256) {
      return [string]$Summary.hashSha256
    }
    if ($Summary.contentSummary -and $Summary.contentSummary.hashFamily -and $Summary.contentSummary.hashFamily.sha256) {
      return [string]$Summary.contentSummary.hashFamily.sha256
    }
  } catch {
    # best effort
  }
  if ($Summary.inputDigest) { return [string]$Summary.inputDigest }
  return ""
}

function Build-RunId {
  param(
    [string]$TargetKind,
    [string]$TargetNameOnly,
    [string]$RepoRootValue,
    [string]$PolicyPathValue
  )
  $repoRootCanonical = ""
  if ($null -ne $RepoRootValue) {
    $repoRootCanonical = [string]$RepoRootValue
  }
  $repoRootCanonical = $repoRootCanonical.Trim().ToLowerInvariant()
  $repoRootDigest = "sha256:" + (Sha256Hex -Value $repoRootCanonical)
  $policyName = if ($PolicyPathValue -and $PolicyPathValue.Trim() -ne "") { [System.IO.Path]::GetFileName($PolicyPathValue) } else { "AUTO" }
  $material = "$TargetKind|$TargetNameOnly|$repoRootDigest|$policyName|v0"
  return "run_" + (ShortSha256Hex -Value $material)
}

function Sanitize-TargetKey {
  param([string]$Name)
  $base = if ($Name -and $Name.Trim() -ne "") { $Name } else { "unknown" }
  $clean = $base.ToLowerInvariant()
  $clean = [System.Text.RegularExpressions.Regex]::Replace($clean, "[^a-z0-9._-]", "_")
  $clean = $clean.Replace(".", "_")
  $clean = $clean.Trim("_", ".", "-")
  if ($clean.Length -gt 48) { $clean = $clean.Substring(0, 48) }
  if (-not $clean -or $clean.Trim() -eq "") {
    $clean = "target_" + (ShortSha256Hex -Value $base)
  }
  return $clean
}

function Sanitize-TargetKeyLegacy {
  param([string]$Name)
  $base = if ($Name -and $Name.Trim() -ne "") { $Name } else { "unknown" }
  $clean = $base.ToLowerInvariant()
  $clean = [System.Text.RegularExpressions.Regex]::Replace($clean, "[^a-z0-9._-]", "_")
  $clean = $clean.Trim("_", ".", "-")
  if ($clean.Length -gt 48) { $clean = $clean.Substring(0, 48) }
  if (-not $clean -or $clean.Trim() -eq "") {
    $clean = "target_" + (ShortSha256Hex -Value $base)
  }
  return $clean
}

function Ensure-UniqueRunDir {
  param([string]$BasePath)
  if (-not (Test-Path -LiteralPath $BasePath)) { return $BasePath }
  for ($i = 1; $i -le 999; $i++) {
    $suffix = "_" + $i.ToString("000")
    $candidate = "${BasePath}${suffix}"
    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return "${BasePath}_overflow"
}

function Redact-SensitiveText {
  param([string]$Text)
  if (-not $Text) { return "" }
  $redacted = $Text
  $backslash = [string][char]92
  $drivePattern = "[A-Za-z]:" + [System.Text.RegularExpressions.Regex]::Escape($backslash) + "[^ `t`r`n]+"
  $redacted = [System.Text.RegularExpressions.Regex]::Replace($redacted, $drivePattern, "<PATH>")
  $redacted = [System.Text.RegularExpressions.Regex]::Replace($redacted, "/(Users|home|var|etc|opt|private|Volumes)/[^ `t`r`n]+", "/<PATH>")
  $redacted = [System.Text.RegularExpressions.Regex]::Replace($redacted, "%[A-Za-z_][A-Za-z0-9_]*%", "<ENV>")
  $redacted = [System.Text.RegularExpressions.Regex]::Replace($redacted, '$env:[A-Za-z_][A-Za-z0-9_]*', "<ENV>")
  return $redacted
}

function Extract-ReasonCodeFromOutput {
  param([string]$OutputText)
  if (-not $OutputText -or $OutputText.Trim() -eq "") { return $null }
  $patterns = @(
    "reason=([A-Z0-9_]+)",
    "\[([A-Z0-9_]+)\]"
  )
  foreach ($pattern in $patterns) {
    $match = [System.Text.RegularExpressions.Regex]::Match($OutputText, $pattern)
    if ($match.Success -and $match.Groups.Count -gt 1) {
      return [string]$match.Groups[1].Value
    }
  }
  return $null
}

function Extract-MetricValue {
  param([string]$OutputText, [string]$Name)
  if (-not $OutputText -or $OutputText.Trim() -eq "") { return $null }
  $pattern = $Name + "=([^ `t`r`n]+)"
  $match = [System.Text.RegularExpressions.Regex]::Match($OutputText, $pattern)
  if ($match.Success -and $match.Groups.Count -gt 1) {
    return [string]$match.Groups[1].Value
  }
  return $null
}

function To-Int64OrZero {
  param([object]$Value)
  if ($null -eq $Value) { return 0 }
  if ($Value -is [string]) {
    $trimmed = $Value.Trim()
    if ($trimmed -eq "") { return 0 }
  }
  try {
    return [int64]$Value
  } catch {
    try {
      return [int64][double]$Value
    } catch {
      return 0
    }
  }
}

function Write-WrapperResult {
  param([string]$Result, [int]$ExitCode, [string]$Reason, [string]$Detail = "")
  $lines = @(
    "result=$Result",
    "exitCode=$ExitCode",
    "reason=$Reason"
  )
  if ($Detail -and $Detail.Trim() -ne "") {
    $lines += "detail=$Detail"
  }
  $path = Join-Path $outDir "wrapper_result.txt"
  $lines -join "`n" | Set-Content -Path $path -Encoding UTF8
}

function Write-WrapperStderr {
  param([string]$OutputText)
  $line = ""
  if ($OutputText -and $OutputText.Trim() -ne "") {
    $line = ($OutputText -split "`r?`n")[0]
  }
  $line = Redact-SensitiveText -Text $line
  if (-not $line -or $line.Trim() -eq "") {
    $line = "(no diagnostic line captured)"
  }
  $path = Join-Path $outDir "wrapper_stderr.txt"
  $line | Set-Content -Path $path -Encoding UTF8
}

function Write-ReportCard {
  param(
    [string]$RunId,
    [string]$LibraryKey,
    [string]$RunSeq,
    [string]$Result,
    [string]$Reason,
    [string]$PrivacyLint,
    [string]$BuildDigest,
    [object]$Summary,
    [object]$ViewState,
    [object]$BaselineSummary,
    [string]$RequestedTargetName = "",
    [string]$ScanTargetName = ""
  )
  $requestedLabel = "-"
  if ($RequestedTargetName -and $RequestedTargetName.Trim() -ne "") {
    $requestedLabel = $RequestedTargetName
  }
  $scanLabel = "-"
  if ($ScanTargetName -and $ScanTargetName.Trim() -ne "") {
    $scanLabel = $ScanTargetName
  }
  $status = "UNKNOWN"
  $baselineId = "-"
  $latestId = "-"
  $bucketText = "-"
  $historyLine = "[ ] [ ] [ ] [ ] [ ]"
  try {
    if (-not $Summary) { $Summary = @{} }
    $stateLines = @()
    if ($ViewState) {
      $baselineId = if ($ViewState.baselineRunId) { [string]$ViewState.baselineRunId } else { "-" }
      $latestId = if ($ViewState.latestRunId) { [string]$ViewState.latestRunId } else { "-" }
      if ($ViewState.blocked -and $ViewState.blocked.runId) {
        $status = "BLOCKED"
      } else {
        $idx = -1
        if ($ViewState.lastN) {
          for ($i = 0; $i -lt $ViewState.lastN.Count; $i++) {
            if ([string]$ViewState.lastN[$i] -eq $latestId) { $idx = $i; break }
          }
        }
        if ($idx -ge 0 -and $ViewState.keys -and $idx -lt $ViewState.keys.Count) {
          $status = [string]$ViewState.keys[$idx].verdictVsBaseline
        }
      }
      if ($ViewState.keys -and $ViewState.lastN) {
        $idx = -1
        for ($i = 0; $i -lt $ViewState.lastN.Count; $i++) {
          if ([string]$ViewState.lastN[$i] -eq $latestId) { $idx = $i; break }
        }
        if ($idx -ge 0 -and $idx -lt $ViewState.keys.Count) {
          $b = $ViewState.keys[$idx].buckets
          if ($b -and $b.Count -gt 0) { $bucketText = ($b -join " ") }
        }
      }
      $historyTokens = @()
      if ($ViewState.lastN -and $ViewState.keys) {
        $tokenCount = [Math]::Min($ViewState.lastN.Count, $ViewState.keys.Count)
        $tokenChronological = @()
        for ($i = 0; $i -lt $tokenCount; $i++) {
          $entry = $ViewState.keys[$i]
          if ($entry -and $entry.verdictVsBaseline -eq "CHANGED") {
            $letters = ""
            if ($entry.buckets -and $entry.buckets.Count -gt 0) { $letters = ($entry.buckets -join "") }
            if (-not $letters -or $letters.Trim() -eq "") { $letters = "X" }
            $tokenChronological += "[" + $letters + "]"
          } else {
            $tokenChronological += "[ ]"
          }
        }
        if ($tokenChronological.Count -gt 5) {
          $tokenChronological = $tokenChronological[($tokenChronological.Count - 5)..($tokenChronological.Count - 1)]
        }
        $historyTokens = @()
        $padCount = 5 - $tokenChronological.Count
        if ($padCount -lt 0) { $padCount = 0 }
        for ($i = 0; $i -lt $padCount; $i++) {
          $historyTokens += "[ ]"
        }
        if ($tokenChronological.Count -gt 0) {
          $historyTokens += $tokenChronological
        }
      } else {
        $historyTokens = @("[ ]", "[ ]", "[ ]", "[ ]", "[ ]")
      }
      $historyLine = $historyTokens -join " "
      $stateLines = @(
        "STATUS: $status (vs baseline)",
        "BASELINE: $baselineId",
        "LATEST: $latestId",
        "BUCKETS: $bucketText",
        "HISTORY: $historyLine",
        "LEGEND: [ ]=same [X]=changed letters=C X R P H B D"
      )
    }
    $targetKind = if ($Summary.targetKind) { $Summary.targetKind } else { "unknown" }
    $artifactKind = if ($Summary.artifactKind) { $Summary.artifactKind } else { "unknown" }
    $files = if ($null -ne $Summary.totalFiles) { $Summary.totalFiles } else { "?" }
    $bytes = if ($null -ne $Summary.totalBytesBounded) { $Summary.totalBytesBounded } else { "?" }
    $hasScripts = if ($null -ne $Summary.hasScripts) { $Summary.hasScripts } else { "?" }
    $hasNative = if ($null -ne $Summary.hasNativeBinaries) { $Summary.hasNativeBinaries } else { "?" }
    $extRefs = if ($null -ne $Summary.externalRefCount) { $Summary.externalRefCount } else { "?" }
    $analysis = if ($Summary.analysisVerdict) { $Summary.analysisVerdict } else { "UNKNOWN" }
    $execution = if ($Summary.executionVerdict) { $Summary.executionVerdict } else { "UNKNOWN" }
    $entry = if ($Summary.entryHints -and $Summary.entryHints.Count -gt 0) { ($Summary.entryHints -join ",") } else { "none" }
    $bounded = if ($Summary.boundednessMarkers -and $Summary.boundednessMarkers.Count -gt 0) { ($Summary.boundednessMarkers -join ",") } else { "-" }
    $webLane = "NOT_APPLICABLE"
    $webEntry = "NONE"
    if ($artifactKind -eq "webBundle" -or ($Summary.hasHtml -eq $true)) {
      $webLane = "ACTIVE"
      $webEntry = if ($entry -and $entry -ne "none") { $entry } else { "ENTRY_HTML" }
    }
    $deltaLine = ""
    $signalContentChanged = $false
    $signalSizeChanged = $false
    $signalStructureChanged = $false
    if ($status -eq "CHANGED" -and $BaselineSummary) {
      try {
        $currFiles = To-Int64OrZero -Value $Summary.totalFiles
        $baseFiles = To-Int64OrZero -Value $BaselineSummary.totalFiles
        $currBytes = To-Int64OrZero -Value $Summary.totalBytesBounded
        $baseBytes = To-Int64OrZero -Value $BaselineSummary.totalBytesBounded
        $currRefs = To-Int64OrZero -Value $Summary.externalRefCount
        $baseRefs = To-Int64OrZero -Value $BaselineSummary.externalRefCount
        $currDomains = To-Int64OrZero -Value $Summary.externalDomainCount
        $baseDomains = To-Int64OrZero -Value $BaselineSummary.externalDomainCount
        $currScripts = if ($Summary.hasScripts -eq $true) { 1 } else { 0 }
        $baseScripts = if ($BaselineSummary.hasScripts -eq $true) { 1 } else { 0 }
        $dFiles = $currFiles - $baseFiles
        $dBytes = $currBytes - $baseBytes
        $dRefs = $currRefs - $baseRefs
        $dDomains = $currDomains - $baseDomains
        $dScripts = $currScripts - $baseScripts
        $deltaLine = "delta=files:{0:+#;-#;0} bytes:{1:+#;-#;0} externalRefs:{2:+#;-#;0} domains:{3:+#;-#;0} scripts:{4:+#;-#;0}" -f $dFiles, $dBytes, $dRefs, $dDomains, $dScripts
        if ($dBytes -ne 0 -or $dScripts -ne 0 -or $dRefs -ne 0 -or $dDomains -ne 0) {
          $signalContentChanged = $true
        }
        if ($dBytes -ne 0) {
          $signalSizeChanged = $true
        }
        if ($dFiles -ne 0) {
          $signalStructureChanged = $true
        }
      } catch {
        $deltaLine = ""
      }
    }
    if ($status -eq "CHANGED") {
      if ($bucketText -match "(^| )C( |$)") {
        $signalContentChanged = $true
      }
      if ($bucketText -match "(^| )D( |$)") {
        $signalContentChanged = $true
      }
      if ($bucketText -match "(^| )B( |$)") {
        $signalStructureChanged = $true
      }
    }

    $next = "COMPARE"
    if ($targetKind -eq "nativeBinary" -or $targetKind -eq "shortcut") {
      $next = "ANALYZE_ONLY_COMPARE"
    } elseif ($artifactKind -eq "webBundle") {
      $next = "SAFE_RUN_OR_COMPARE"
    } elseif ($Summary.rawArtifactKind -eq "RELEASE_DIR") {
      $next = "HOST_RUN_IF_CONFIGURED"
    }

    $meaning = "See report card and receipts."
    $inputType = $targetKind
    $adapter = "filesystem_v0"
    if ($targetKind -eq "emailArtifact") { $inputType = "email"; $adapter = "email_v0" }
    elseif ($targetKind -eq "directory") { $inputType = "directory" }
    elseif ($targetKind -eq "nativeBinary") { $inputType = "nativeBinary" }
    elseif ($Summary.rawArtifactKind -eq "ZIP") { $inputType = "archive"; $adapter = "zip_v0" }
    if ($stateLines.Count -gt 0 -and $ViewState) {
      if ($ViewState.blocked -and $ViewState.blocked.runId) {
        $meaning = "Blocked. Review change before proceeding."
      } else {
        $latestId = if ($ViewState.latestRunId) { [string]$ViewState.latestRunId } else { "" }
        $idx = -1
        if ($ViewState.lastN) {
          for ($i = 0; $i -lt $ViewState.lastN.Count; $i++) {
            if ([string]$ViewState.lastN[$i] -eq $latestId) { $idx = $i; break }
          }
        }
        if ($idx -ge 0 -and $ViewState.keys -and $idx -lt $ViewState.keys.Count) {
          if ([string]$ViewState.keys[$idx].verdictVsBaseline -eq "CHANGED") {
            $meaning = "Changed vs baseline. Compare before proceeding."
          } elseif ([string]$ViewState.keys[$idx].verdictVsBaseline -eq "SAME") {
            $meaning = "Same as baseline."
          }
        }
      }
    }
    if ($meaning -eq "See report card and receipts.") {
      if ($analysis -eq "WITHHELD") {
        $meaning = "Analysis-only. Execution withheld."
      } elseif ($analysis -eq "DENY" -or $Result -eq "DENY") {
        $meaning = "Denied by policy or trust gate."
      }
    }
    $lines = @(
      "input=inputType:$inputType adapter:$adapter",
      "classification=target:$targetKind artifact:$artifactKind entryHints=$entry",
      "targets=requested:$requestedLabel scan:$scanLabel",
      "webLane=$webLane webEntry=$webEntry",
      "observed=files:$files bytes:$bytes scripts:$hasScripts native:$hasNative externalRefs:$extRefs bounded=$bounded",
      "posture=analysis:$analysis exec:$execution reason:$Reason",
      "meaning=$meaning",
      "next=$next",
      "runId=$RunId",
      "libraryKey=$LibraryKey",
      "runSeq=$RunSeq",
      "result=$Result",
      "privacyLint=$PrivacyLint",
      "buildDigest=$BuildDigest",
      "receipt=safe_run_receipt.json",
      "operator=operator_receipt.json"
    )
    $signalLines = @()
    if ($status -eq "CHANGED") {
      if ($signalContentChanged) { $signalLines += "SIGNAL: CONTENT_CHANGED" }
      if ($signalSizeChanged) { $signalLines += "SIGNAL: SIZE_CHANGED" }
      if ($signalStructureChanged) { $signalLines += "SIGNAL: STRUCTURE_CHANGED" }
    }
    if ($signalLines.Count -gt 0) {
      $insertAt = 2
      if ($lines.Count -lt 2) { $insertAt = $lines.Count }
      $prefix = @()
      $suffix = @()
      if ($insertAt -gt 0) {
        $prefix = $lines[0..($insertAt - 1)]
      }
      if ($insertAt -lt $lines.Count) {
        $suffix = $lines[$insertAt..($lines.Count - 1)]
      }
      $lines = $prefix + $signalLines + $suffix
    }
    if ($deltaLine -and $deltaLine.Trim() -ne "") {
      if ($lines.Count -ge 2) {
        $lines = @($lines[0], $lines[1], $deltaLine) + $lines[2..($lines.Count - 1)]
      } else {
        $lines = $lines + @($deltaLine)
      }
    }
    if ($stateLines.Count -gt 0) {
      $lines = $stateLines + $lines
    }
    $path = Join-Path $outDir "report_card.txt"
    $lines -join "`n" | Set-Content -Path $path -Encoding UTF8
    $reportJsonPath = Join-Path $outDir "report_card_v0.json"
    $reportJson = [ordered]@{
      schema = "weftend.reportCard/0"
      v = 0
      runId = $RunId
      libraryKey = $LibraryKey
      runSeq = $RunSeq
      result = $Result
      reason = $Reason
      privacyLint = $PrivacyLint
      buildDigest = $BuildDigest
      status = $status
      baseline = $baselineId
      latest = $latestId
      buckets = $bucketText
      history = $historyLine
      targetKind = $targetKind
      artifactKind = $artifactKind
      requestedTarget = $requestedLabel
      scanTarget = $scanLabel
      meaning = $meaning
      next = $next
      receipt = "safe_run_receipt.json"
      operator = "operator_receipt.json"
      lines = $lines
    }
    ($reportJson | ConvertTo-Json -Depth 6) | Set-Content -Path $reportJsonPath -Encoding UTF8
  } catch {
    try {
      $errMsg = Redact-SensitiveText -Text ([string]$_)
      $errPath = Join-Path $outDir "wrapper_report_card_error.txt"
      $errMsg | Set-Content -Path $errPath -Encoding UTF8
    } catch {
      # ignore diagnostic failures
    }
    $statusFallback = "UNKNOWN"
    $baselineFallback = "-"
    $latestFallback = "-"
    $bucketFallback = "-"
    $historyFallback = "[ ] [ ] [ ] [ ] [ ]"
    try {
      if ($ViewState) {
        if ($ViewState.baselineRunId) { $baselineFallback = [string]$ViewState.baselineRunId }
        if ($ViewState.latestRunId) { $latestFallback = [string]$ViewState.latestRunId }
        if ($ViewState.blocked -and $ViewState.blocked.runId) {
          $statusFallback = "BLOCKED"
        } else {
          $idxFallback = -1
          if ($ViewState.lastN) {
            for ($i = 0; $i -lt $ViewState.lastN.Count; $i++) {
              if ([string]$ViewState.lastN[$i] -eq $latestFallback) { $idxFallback = $i; break }
            }
          }
          if ($idxFallback -ge 0 -and $ViewState.keys -and $idxFallback -lt $ViewState.keys.Count) {
            $entryFallback = $ViewState.keys[$idxFallback]
            if ($entryFallback -and $entryFallback.verdictVsBaseline) {
              $statusFallback = [string]$entryFallback.verdictVsBaseline
            }
            if ($entryFallback -and $entryFallback.buckets -and $entryFallback.buckets.Count -gt 0) {
              $bucketFallback = (($entryFallback.buckets | ForEach-Object { [string]$_ }) -join " ")
            }
          }
        }
      }
    } catch {
      # keep fallback defaults
    }
    $fallback = @(
      "STATUS: $statusFallback (vs baseline)",
      "BASELINE: $baselineFallback",
      "LATEST: $latestFallback",
      "BUCKETS: $bucketFallback",
      "HISTORY: $historyFallback",
      "LEGEND: [ ]=same [X]=changed letters=C X R P H B D",
      "targets=requested:$requestedLabel scan:$scanLabel",
      "runId=$RunId",
      "result=$Result",
      "reason=$Reason",
      "privacyLint=$PrivacyLint",
      "buildDigest=$BuildDigest"
    )
    $path = Join-Path $outDir "report_card.txt"
    $fallback -join "`n" | Set-Content -Path $path -Encoding UTF8
    $reportJsonPath = Join-Path $outDir "report_card_v0.json"
    $reportJson = [ordered]@{
      schema = "weftend.reportCard/0"
      v = 0
      runId = $RunId
      libraryKey = $LibraryKey
      runSeq = $RunSeq
      result = $Result
      reason = $Reason
      privacyLint = $PrivacyLint
      buildDigest = $BuildDigest
      status = $statusFallback
      baseline = $baselineFallback
      latest = $latestFallback
      buckets = $bucketFallback
      history = $historyFallback
      requestedTarget = $requestedLabel
      scanTarget = $scanLabel
      lines = $fallback
    }
    ($reportJson | ConvertTo-Json -Depth 6) | Set-Content -Path $reportJsonPath -Encoding UTF8
  }
}

function Read-ReceiptSummaryFromPath {
  param([string]$SafeReceipt)
  if (Test-Path $safeReceipt) {
    try {
      $json = Get-Content -Path $safeReceipt -Raw | ConvertFrom-Json
      $top = [string]$json.topReasonCode
      if (-not $top -or $top.Trim() -eq "") {
        $codes = $json.execution.reasonCodes
        if ($codes -and $codes.Count -gt 0) {
          $top = [string]$codes[0]
        }
      }
      $analysis = [string]$json.analysisVerdict
      $execution = [string]$json.executionVerdict
      $content = $json.contentSummary
      $summary = @{
        topReason = $top
        analysisVerdict = $analysis
        executionVerdict = $execution
        rawArtifactKind = [string]$json.artifactKind
        inputDigest = [string]$json.inputDigest
      }
      if ($content) {
        $summary.targetKind = [string]$content.targetKind
        $summary.artifactKind = [string]$content.artifactKind
        $summary.totalFiles = $content.totalFiles
        $summary.totalBytesBounded = $content.totalBytesBounded
        $summary.hasScripts = $content.hasScripts
        $summary.hasHtml = $content.hasHtml
        $summary.hasNativeBinaries = $content.hasNativeBinaries
        $summary.externalRefCount = $content.externalRefs.count
        $summary.externalDomainCount = if ($content.externalRefs.topDomains) { $content.externalRefs.topDomains.Count } else { 0 }
        $summary.entryHints = $content.entryHints
        $summary.boundednessMarkers = $content.boundednessMarkers
        if ($content.hashFamily) {
          if ($content.hashFamily.sha256) {
            $summary.hashSha256 = [string]$content.hashFamily.sha256
          }
        }
      }
      return $summary
    } catch {
      return @{ topReason = $null; analysisVerdict = $null }
    }
  }
  return @{ topReason = $null; analysisVerdict = $null }
}

function Read-ReceiptSummary {
  $safeReceipt = Join-Path $outDir "safe_run_receipt.json"
  return Read-ReceiptSummaryFromPath -SafeReceipt $safeReceipt
}

function Read-ViewState {
  param([string]$ViewDir)
  if (-not $ViewDir) { return $null }
  $path = Join-Path $ViewDir "view_state.json"
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    return Get-Content -Path $path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ViewStatus {
  param([object]$ViewState)
  $status = "UNKNOWN"
  $buckets = @()
  if (-not $ViewState) {
    return @{ status = $status; buckets = $buckets }
  }
  if ($ViewState.blocked -and $ViewState.blocked.runId) {
    $status = "BLOCKED"
    return @{ status = $status; buckets = $buckets }
  }
  $latestId = if ($ViewState.latestRunId) { [string]$ViewState.latestRunId } else { "" }
  $idx = -1
  if ($ViewState.lastN) {
    for ($i = 0; $i -lt $ViewState.lastN.Count; $i++) {
      if ([string]$ViewState.lastN[$i] -eq $latestId) { $idx = $i; break }
    }
  }
  if ($idx -ge 0 -and $ViewState.keys -and $idx -lt $ViewState.keys.Count) {
    $status = [string]$ViewState.keys[$idx].verdictVsBaseline
    $b = $ViewState.keys[$idx].buckets
    if ($b -and $b.Count -gt 0) { $buckets = $b }
  }
  return @{ status = $status; buckets = $buckets }
}

function ReceiptsExist {
  $safeReceipt = Join-Path $outDir "safe_run_receipt.json"
  $operatorReceipt = Join-Path $outDir "operator_receipt.json"
  return (Test-Path $safeReceipt) -or (Test-Path $operatorReceipt)
}

function Show-ReportCardPopup {
  param(
    [string]$RunId,
    [string]$Result,
    [string]$Reason,
    [string]$PrivacyLint,
    [string]$BuildDigest
  )
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $bg = [System.Drawing.Color]::FromArgb(28, 28, 32)
    $accent = $bg
    $text = [System.Drawing.Color]::FromArgb(235, 235, 240)
    $muted = [System.Drawing.Color]::FromArgb(200, 200, 210)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "WeftEnd"
    $form.StartPosition = "CenterScreen"
    $form.BackColor = $bg
    $form.ForeColor = $text
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size 420, 260
    $form.Font = New-Object System.Drawing.Font "Segoe UI", 9

    $header = New-Object System.Windows.Forms.Panel
    $header.BackColor = $accent
    $header.Dock = [System.Windows.Forms.DockStyle]::Top
    $header.Height = 44
    $form.Controls.Add($header)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "WeftEnd Safe-Run"
    $title.ForeColor = $text
    $title.Font = New-Object System.Drawing.Font "Segoe UI Semibold", 10
    $title.AutoSize = $false
    $title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $title.Dock = [System.Windows.Forms.DockStyle]::Fill
    $title.Padding = New-Object System.Windows.Forms.Padding 12, 0, 0, 0
    $header.Controls.Add($title)

    $body = New-Object System.Windows.Forms.Label
    $body.AutoSize = $false
    $body.ForeColor = $text
    $body.Location = New-Object System.Drawing.Point 12, 58
    $body.Size = New-Object System.Drawing.Size 396, 130
    $body.Text = @(
      "runId=$RunId",
      "result=$Result",
      "reason=$Reason",
      "privacyLint=$PrivacyLint",
      "buildDigest=$BuildDigest"
    ) -join [Environment]::NewLine
    $form.Controls.Add($body)

    $hint = New-Object System.Windows.Forms.Label
    $hint.AutoSize = $false
    $hint.ForeColor = $muted
    $hint.Location = New-Object System.Drawing.Point 12, 190
    $hint.Size = New-Object System.Drawing.Size 396, 24
    $hint.Text = "Review report_card.txt first. Use Library for history."
    $form.Controls.Add($hint)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "OK"
    $ok.BackColor = $bg
    $ok.ForeColor = $text
    $ok.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $ok.Width = 90
    $ok.Height = 28
    $ok.Location = New-Object System.Drawing.Point 228, 218
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $ok
    $form.Controls.Add($ok)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "Close"
    $cancel.BackColor = $bg
    $cancel.ForeColor = $text
    $cancel.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $cancel.Width = 90
    $cancel.Height = 28
    $cancel.Location = New-Object System.Drawing.Point 324, 218
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancel
    $form.Controls.Add($cancel)

    return $form.ShowDialog()
  } catch {
    return $null
  }
}

function Start-ReportCardViewer {
  param(
    [string]$RunDir,
    [string]$TargetDir,
    [string]$TargetKey
  )
  $script:reportViewerAutoDisabled = $false
  if (-not $RunDir -or -not (Test-Path -LiteralPath $RunDir)) { return $false }
  $viewerScript = Join-Path $scriptDir "report_card_viewer.ps1"
  if (-not (Test-Path -LiteralPath $viewerScript)) { return $false }
  $psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  $hostCandidates = @()
  if (Test-Path -LiteralPath $psExe) {
    $hostCandidates += $psExe
  }
  $hostCandidates += @("powershell.exe", "pwsh.exe")
  $hostCandidates = @($hostCandidates | Select-Object -Unique)
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $viewerScript,
    "-RunDir",
    $RunDir
  )
  if ($TargetDir -and $TargetDir.Trim() -ne "") {
    $args += @("-TargetDir", $TargetDir)
  }
  if ($TargetKey -and $TargetKey.Trim() -ne "") {
    $args += @("-LibraryKey", $TargetKey)
  }
  $attempted = $false
  foreach ($hostExe in $hostCandidates) {
    try {
      $proc = Start-Process -FilePath $hostExe -ArgumentList $args -WindowStyle Hidden -PassThru -ErrorAction Stop
      $attempted = $true
      Start-Sleep -Milliseconds 350
      try { $proc.Refresh() } catch {}
      if ($proc -and $proc.HasExited) {
        $exitCode = [int]$proc.ExitCode
        if ($exitCode -ne 0) {
          continue
        }
      }
      return $true
    } catch {
      continue
    }
  }
  if ($attempted) {
    try {
      if ($configPath -and $configPath.Trim() -ne "") {
        Set-ItemProperty -Path $configPath -Name "ReportViewerAutoOpen" -Value "0"
        $script:reportViewerAutoDisabled = $true
      }
    } catch {
      # best effort only
    }
  }
  return $false
}

function Show-AcceptBaselinePrompt {
  param([string]$TargetKey)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $bg = [System.Drawing.Color]::FromArgb(28, 28, 32)
    $accent = $bg
    $text = [System.Drawing.Color]::FromArgb(235, 235, 240)
    $muted = [System.Drawing.Color]::FromArgb(200, 200, 210)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "WeftEnd"
    $form.StartPosition = "CenterScreen"
    $form.BackColor = $bg
    $form.ForeColor = $text
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size 420, 220
    $form.Font = New-Object System.Drawing.Font "Segoe UI", 9

    $header = New-Object System.Windows.Forms.Panel
    $header.BackColor = $accent
    $header.Dock = [System.Windows.Forms.DockStyle]::Top
    $header.Height = 44
    $form.Controls.Add($header)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "Baseline Review"
    $title.ForeColor = $text
    $title.Font = New-Object System.Drawing.Font "Segoe UI Semibold", 10
    $title.AutoSize = $false
    $title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $title.Dock = [System.Windows.Forms.DockStyle]::Fill
    $title.Padding = New-Object System.Windows.Forms.Padding 12, 0, 0, 0
    $header.Controls.Add($title)

    $body = New-Object System.Windows.Forms.Label
    $body.AutoSize = $false
    $body.ForeColor = $text
    $body.Location = New-Object System.Drawing.Point 12, 58
    $body.Size = New-Object System.Drawing.Size 396, 90
    $body.Text = @(
      "WeftEnd detected changes vs baseline.",
      "Accept this run as the new baseline?",
      "",
      "Target: $TargetKey"
    ) -join [Environment]::NewLine
    $form.Controls.Add($body)

    $yes = New-Object System.Windows.Forms.Button
    $yes.Text = "Accept"
    $yes.BackColor = $bg
    $yes.ForeColor = $text
    $yes.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $yes.Width = 90
    $yes.Height = 28
    $yes.Location = New-Object System.Drawing.Point 228, 176
    $yes.DialogResult = [System.Windows.Forms.DialogResult]::Yes
    $form.AcceptButton = $yes
    $form.Controls.Add($yes)

    $no = New-Object System.Windows.Forms.Button
    $no.Text = "Decline"
    $no.BackColor = $bg
    $no.ForeColor = $text
    $no.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $no.Width = 90
    $no.Height = 28
    $no.Location = New-Object System.Drawing.Point 324, 176
    $no.DialogResult = [System.Windows.Forms.DialogResult]::No
    $form.CancelButton = $no
    $form.Controls.Add($no)

    return $form.ShowDialog()
  } catch {
    return $null
  }
}

function Show-TicketPackPrompt {
  param([string]$TargetKey, [string]$RunId)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $bg = [System.Drawing.Color]::FromArgb(28, 28, 32)
    $accent = $bg
    $text = [System.Drawing.Color]::FromArgb(235, 235, 240)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "WeftEnd"
    $form.StartPosition = "CenterScreen"
    $form.BackColor = $bg
    $form.ForeColor = $text
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size 430, 220
    $form.Font = New-Object System.Drawing.Font "Segoe UI", 9

    $header = New-Object System.Windows.Forms.Panel
    $header.BackColor = $accent
    $header.Dock = [System.Windows.Forms.DockStyle]::Top
    $header.Height = 44
    $form.Controls.Add($header)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "Change Detected"
    $title.ForeColor = $text
    $title.Font = New-Object System.Drawing.Font "Segoe UI Semibold", 10
    $title.AutoSize = $false
    $title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $title.Dock = [System.Windows.Forms.DockStyle]::Fill
    $title.Padding = New-Object System.Windows.Forms.Padding 12, 0, 0, 0
    $header.Controls.Add($title)

    $body = New-Object System.Windows.Forms.Label
    $body.AutoSize = $false
    $body.ForeColor = $text
    $body.Location = New-Object System.Drawing.Point 12, 58
    $body.Size = New-Object System.Drawing.Size 406, 98
    $body.Text = @(
      "WeftEnd detected changes vs baseline.",
      "Create a deterministic ticket pack for escalation now?",
      "",
      "Target: $TargetKey",
      "Run: $RunId"
    ) -join [Environment]::NewLine
    $form.Controls.Add($body)

    $yes = New-Object System.Windows.Forms.Button
    $yes.Text = "Create"
    $yes.BackColor = $bg
    $yes.ForeColor = $text
    $yes.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $yes.Width = 90
    $yes.Height = 28
    $yes.Location = New-Object System.Drawing.Point 234, 176
    $yes.DialogResult = [System.Windows.Forms.DialogResult]::Yes
    $form.AcceptButton = $yes
    $form.Controls.Add($yes)

    $no = New-Object System.Windows.Forms.Button
    $no.Text = "Skip"
    $no.BackColor = $bg
    $no.ForeColor = $text
    $no.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $no.Width = 90
    $no.Height = 28
    $no.Location = New-Object System.Drawing.Point 330, 176
    $no.DialogResult = [System.Windows.Forms.DialogResult]::No
    $form.CancelButton = $no
    $form.Controls.Add($no)

    return $form.ShowDialog()
  } catch {
    return $null
  }
}

function Create-TicketPackForRun {
  param(
    [string]$RunRoot,
    [string]$TargetKeyValue,
    [string]$RunIdValue
  )
  $result = @{
    ok = $false
    code = "TICKET_PACK_RUNTIME_MISSING"
    outDir = $null
  }
  if (-not $RunRoot -or -not (Test-Path -LiteralPath $RunRoot)) {
    $result.code = "TICKET_PACK_INPUT_MISSING"
    return $result
  }
  if (-not ((Test-Path -LiteralPath $mainJs) -and $nodePathResolved) -and -not $npmPathResolved) {
    return $result
  }
  try {
    $ticketRoot = Join-Path $libraryRoot "Tickets"
    New-Item -ItemType Directory -Force -Path $ticketRoot | Out-Null
    $ticketBase = Join-Path $ticketRoot ("ticket_" + (ShortSha256Hex -Value ($TargetKeyValue + "|" + $RunIdValue)))
    $ticketOut = Ensure-UniqueRunDir -BasePath $ticketBase
    New-Item -ItemType Directory -Force -Path $ticketOut | Out-Null

    $ticketOutput = ""
    $ticketCode = 1
    if ((Test-Path -LiteralPath $mainJs) -and $nodePathResolved) {
      $lines = @(& $nodePathResolved $mainJs "ticket-pack" $RunRoot "--out" $ticketOut 2>&1)
      if ($lines.Count -gt 0) {
        $ticketOutput = ($lines | ForEach-Object { [string]$_ }) -join "`n"
      }
      $ticketCode = [int]$LASTEXITCODE
    } elseif ($npmPathResolved) {
      $lines = @(& $npmPathResolved run weftend -- "ticket-pack" $RunRoot "--out" $ticketOut 2>&1)
      if ($lines.Count -gt 0) {
        $ticketOutput = ($lines | ForEach-Object { [string]$_ }) -join "`n"
      }
      $ticketCode = [int]$LASTEXITCODE
    }

    if ($ticketCode -eq 0) {
      $result.ok = $true
      $result.code = "OK"
      $result.outDir = $ticketOut
      return $result
    }
    $reasonCode = Extract-ReasonCodeFromOutput -OutputText $ticketOutput
    if ($reasonCode -and $reasonCode.Trim() -ne "") {
      $result.code = $reasonCode
    } else {
      $result.code = "TICKET_PACK_FAILED"
    }
    return $result
  } catch {
    $result.code = "TICKET_PACK_EXCEPTION"
    return $result
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = "HKCU:\Software\WeftEnd\Shell"
$normalizedTargetPath = Normalize-TargetPath -Value $TargetPath
if (-not $normalizedTargetPath) {
  $normalizedTargetPath = Normalize-TargetPath -Value $TargetCompat
}
if ($normalizedTargetPath) {
  $TargetPath = $normalizedTargetPath
}

$safeRunTargetPath = $TargetPath
$shortcutResolve = $null
if (Is-ShortcutArtifact -PathValue $TargetPath) {
  $shortcutResolve = Resolve-ShortcutScanTarget -ShortcutPath $TargetPath
  if ($shortcutResolve.ok -and $shortcutResolve.targetPath) {
    $safeRunTargetPath = [string]$shortcutResolve.targetPath
  }
}

if (-not $RepoRoot -or $RepoRoot.Trim() -eq "") {
  $RepoRoot = Read-RegistryValue -Path $configPath -Name "RepoRoot"
}
if (-not $RepoRoot -or $RepoRoot.Trim() -eq "") {
  $RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
}
if (-not $OutRoot -or $OutRoot.Trim() -eq "") {
  $OutRoot = Read-RegistryValue -Path $configPath -Name "OutRoot"
}
if (-not $OutRoot -or $OutRoot.Trim() -eq "") {
  if ($env:LOCALAPPDATA) {
    $OutRoot = Join-Path $env:LOCALAPPDATA "WeftEnd"
  }
}
if (-not $NodeExe -or $NodeExe.Trim() -eq "") {
  $NodeExe = Read-RegistryValue -Path $configPath -Name "NodeExe"
}
if (-not $NpmCmd -or $NpmCmd.Trim() -eq "") {
  $NpmCmd = Read-RegistryValue -Path $configPath -Name "NpmCmd"
}
$openFolderOnComplete = Read-RegistryValue -Path $configPath -Name "OpenFolderOnComplete"
$openFolderDefault = if ("$openFolderOnComplete" -eq "0") { 0 } else { 1 }
$useReportViewerRaw = Read-RegistryValue -Path $configPath -Name "UseReportViewer"
$useReportViewer = if ("$useReportViewerRaw" -eq "0") { $false } else { $true }
$reportViewerAutoOpenRaw = Read-RegistryValue -Path $configPath -Name "ReportViewerAutoOpen"
$reportViewerAutoOpen = if ("$reportViewerAutoOpenRaw" -eq "0") { $false } else { $true }

if (-not $OutRoot -or $OutRoot.Trim() -eq "") {
  Write-Error "HOST_OUT_MISSING: no output root configured."
  exit 40
}

$targetKind = Detect-TargetKind -PathValue $safeRunTargetPath
$targetNameOnly = if ($TargetPath -and $TargetPath.Trim() -ne "") { [System.IO.Path]::GetFileName($TargetPath) } else { "missing" }
$runId = Build-RunId -TargetKind $targetKind -TargetNameOnly $targetNameOnly -RepoRootValue $RepoRoot -PolicyPathValue $Policy
$outRootCanonical = if ($null -ne $OutRoot) { [string]$OutRoot } else { "" }
$outRootLeaf = [System.IO.Path]::GetFileName($outRootCanonical.TrimEnd('\', '/'))
$libraryRoot = $OutRoot
if (-not $outRootLeaf -or $outRootLeaf.ToLowerInvariant() -ne "library") {
  $libraryRoot = Join-Path $OutRoot "Library"
}
$targetKey = Sanitize-TargetKey -Name $targetNameOnly
$legacyKey = Sanitize-TargetKeyLegacy -Name $targetNameOnly
if ($legacyKey -and (Test-Path -LiteralPath (Join-Path $libraryRoot $legacyKey))) {
  $targetKey = $legacyKey
}
$targetDir = Join-Path $libraryRoot $targetKey
$null = New-Item -ItemType Directory -Force -Path $targetDir
$baseDir = Join-Path $targetDir $runId
$outDir = Ensure-UniqueRunDir -BasePath $baseDir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$skipWeftend = $false
$result = "FAIL"
$reason = "WEFTEND_FAILED_BEFORE_RECEIPT"
$finalExitCode = 1

if ($targetKind -eq "missing") {
  $skipWeftend = $true
  $result = "FAIL"
  $reason = "TARGET_MISSING"
  $finalExitCode = 40
}

if (-not $skipWeftend -and -not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  $skipWeftend = $true
  $result = "FAIL"
  $reason = "REPO_NOT_FOUND"
  $finalExitCode = 1
}

$mainJs = Join-Path $RepoRoot "dist\src\cli\main.js"
$hasDist = Test-Path $mainJs
$repoNodeExe = Join-Path $RepoRoot "runtime\node\node.exe"
$repoNpmCmd = Join-Path $RepoRoot "runtime\node\npm.cmd"
$programFiles = [Environment]::GetFolderPath("ProgramFiles")
$programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$nodePathResolved = Resolve-ExecutablePath -Preferred $NodeExe -CommandName "node" -Fallbacks @(
  $repoNodeExe,
  (Join-Path $programFiles "nodejs\node.exe"),
  (Join-Path $programFilesX86 "nodejs\node.exe"),
  (Join-Path $localAppData "Programs\nodejs\node.exe")
)
$npmPathResolved = Resolve-ExecutablePath -Preferred $NpmCmd -CommandName "npm" -Fallbacks @(
  $repoNpmCmd,
  (Join-Path $programFiles "nodejs\npm.cmd"),
  (Join-Path $programFilesX86 "nodejs\npm.cmd"),
  (Join-Path $localAppData "Programs\nodejs\npm.cmd")
)

$policyArgs = @()
if ($Policy -and $Policy.Trim() -ne "") {
  $policyArgs = @("--policy", $Policy)
}
$forceWithhold = $targetKind -eq "nativeBinary" -or $targetKind -eq "shortcut"
$isEmailInput = $targetKind -eq "emailArtifact"
$withholdArgs = @()
if ($forceWithhold) {
  $withholdArgs = @("--withhold-exec")
}

$exitCode = 1
$commandOutput = ""
if (-not $skipWeftend) {
  $pushedRepoRoot = $false
  try {
    Push-Location $RepoRoot
    $pushedRepoRoot = $true
    $cliArgs = @()
    if ($isEmailInput) {
      $cliArgs = @("email", "safe-run", $safeRunTargetPath, "--out", $outDir) + $policyArgs
    } else {
      $cliArgs = @("safe-run", $safeRunTargetPath, "--out", $outDir) + $policyArgs + $withholdArgs
    }
    if ($hasDist -and $nodePathResolved) {
      $outputLines = @(& $nodePathResolved $mainJs @cliArgs 2>&1)
      if ($outputLines.Count -gt 0) {
        $commandOutput = ($outputLines | ForEach-Object { [string]$_ }) -join "`n"
      }
      $exitCode = $LASTEXITCODE
    } elseif ($npmPathResolved) {
      $outputLines = @(& $npmPathResolved run weftend -- @cliArgs 2>&1)
      if ($outputLines.Count -gt 0) {
        $commandOutput = ($outputLines | ForEach-Object { [string]$_ }) -join "`n"
      }
      $exitCode = $LASTEXITCODE
    } else {
      $exitCode = 1
      $commandOutput = "TOOL_NOT_FOUND"
    }
  } catch {
    $exceptionText = [string]$_
    if (-not $commandOutput -or $commandOutput.Trim() -eq "") {
      $commandOutput = $exceptionText
    }
    $exitCode = 1
  } finally {
    if ($pushedRepoRoot) {
      Pop-Location
    }
  }
}

$summary = Read-ReceiptSummary
$privacy = Extract-MetricValue -OutputText $commandOutput -Name "privacyLint"
if (-not $privacy -or $privacy.Trim() -eq "") { $privacy = "UNKNOWN" }
$build = Extract-MetricValue -OutputText $commandOutput -Name "buildDigest"
if (-not $build -or $build.Trim() -eq "") { $build = "UNKNOWN" }
 $baselineAccepted = $false

if (-not $skipWeftend) {
  $result = "FAIL"
  $reason = "WEFTEND_FAILED_BEFORE_RECEIPT"
  $finalExitCode = $exitCode

  if ($forceWithhold) {
    if (ReceiptsExist) {
      $result = "WITHHELD"
      $reason = if ($targetKind -eq "shortcut") { "ARTIFACT_SHORTCUT_UNSUPPORTED" } else { "EXECUTION_WITHHELD_UNSUPPORTED_ARTIFACT" }
      $finalExitCode = 0
    } else {
      Write-WrapperStderr -OutputText $commandOutput
      $result = "FAIL"
      $reason = "WEFTEND_NO_RECEIPT"
      $finalExitCode = 40
    }
  } elseif ($exitCode -eq 0) {
    $result = "PASS"
    if ($summary.analysisVerdict -eq "WITHHELD") { $result = "WITHHELD" }
    if ($summary.analysisVerdict -eq "DENY") { $result = "DENY" }
    $reason = if ($summary.topReason) { [string]$summary.topReason } else { "OK" }
    $finalExitCode = 0
  } else {
    $outputCode = Extract-ReasonCodeFromOutput -OutputText $commandOutput
    if ($outputCode) {
      $reason = "WEFTEND_FAILED_BEFORE_RECEIPT_" + $outputCode
    }
    if (-not (ReceiptsExist)) {
      Write-WrapperStderr -OutputText $commandOutput
    }
    $finalExitCode = $exitCode
  }
}

Write-WrapperResult -Result $result -ExitCode $finalExitCode -Reason $reason -Detail ("targetKind=" + $targetKind + " requestedTarget=" + $TargetPath + " scanTarget=" + $safeRunTargetPath)
$viewState = $null
$viewStatus = "UNKNOWN"
try {
  $runSeq = "001"
  if ($outDir -and $baseDir -and $outDir.StartsWith($baseDir, [System.StringComparison]::OrdinalIgnoreCase)) {
    $suffix = $outDir.Substring($baseDir.Length)
    if ($suffix.StartsWith("_")) {
      $runSeq = $suffix.TrimStart("_")
    }
  }
  $viewState = Read-ViewState -ViewDir (Join-Path $targetDir "view")
  $baselineSummary = $null
  if ($viewState -and $viewState.baselineRunId) {
    $baselineReceiptPath = Join-Path (Join-Path $targetDir ([string]$viewState.baselineRunId)) "safe_run_receipt.json"
    $baselineSummary = Read-ReceiptSummaryFromPath -SafeReceipt $baselineReceiptPath
  }
  $viewInfo = Get-ViewStatus -ViewState $viewState
  $viewStatus = if ($viewInfo) { [string]$viewInfo.status } else { "UNKNOWN" }
  $requestedTargetName = if ($TargetPath -and $TargetPath.Trim() -ne "") { [System.IO.Path]::GetFileName($TargetPath) } else { "" }
  $scanTargetName = if ($safeRunTargetPath -and $safeRunTargetPath.Trim() -ne "") { [System.IO.Path]::GetFileName($safeRunTargetPath) } else { "" }
  Write-ReportCard -RunId $runId -LibraryKey $targetKey -RunSeq $runSeq -Result $result -Reason $reason -PrivacyLint $privacy -BuildDigest $build -Summary $summary -ViewState $viewState -BaselineSummary $baselineSummary -RequestedTargetName $requestedTargetName -ScanTargetName $scanTargetName
} catch {
  $errMsg = Redact-SensitiveText -Text ([string]$_)
  $errPath = Join-Path $outDir "wrapper_report_card_error.txt"
  $errMsg | Set-Content -Path $errPath -Encoding UTF8
  $summary = Read-ReceiptSummary
  $targetKind = if ($summary.targetKind) { $summary.targetKind } else { "unknown" }
  $artifactKind = if ($summary.artifactKind) { $summary.artifactKind } else { "unknown" }
  $files = if ($null -ne $summary.totalFiles) { $summary.totalFiles } else { "?" }
  $bytes = if ($null -ne $summary.totalBytesBounded) { $summary.totalBytesBounded } else { "?" }
  $hasScripts = if ($null -ne $summary.hasScripts) { $summary.hasScripts } else { "?" }
  $hasNative = if ($null -ne $summary.hasNativeBinaries) { $summary.hasNativeBinaries } else { "?" }
  $extRefs = if ($null -ne $summary.externalRefCount) { $summary.externalRefCount } else { "?" }
  $analysis = if ($summary.analysisVerdict) { $summary.analysisVerdict } else { "UNKNOWN" }
  $execution = if ($summary.executionVerdict) { $summary.executionVerdict } else { "UNKNOWN" }
  $entry = if ($summary.entryHints -and $summary.entryHints.Count -gt 0) { ($summary.entryHints -join ",") } else { "none" }
  $fallback = @(
    "classification=target:$targetKind artifact:$artifactKind entryHints=$entry",
    "observed=files:$files bytes:$bytes scripts:$hasScripts native:$hasNative externalRefs:$extRefs bounded=-",
    "posture=analysis:$analysis exec:$execution reason:$reason",
    "runId=$runId",
    "result=$result",
    "privacyLint=$privacy",
    "buildDigest=$build",
    "receipt=safe_run_receipt.json",
    "operator=operator_receipt.json"
  )
  $path = Join-Path $outDir "report_card.txt"
  $fallback -join "`n" | Set-Content -Path $path -Encoding UTF8
}

$openFlag = -not ($Open -eq "0" -or $Open -eq "false" -or $Open -eq "False")
$viewStatusNow = if ($viewStatus) { [string]$viewStatus } else { "UNKNOWN" }
$isChangedOrBlocked = $viewStatusNow -eq "CHANGED" -or $viewStatusNow -eq "BLOCKED" -or $result -eq "FAIL" -or $result -eq "DENY"
$shouldHandleUi = $openFlag
if ($LaunchpadMode.IsPresent -and $isChangedOrBlocked) {
  $shouldHandleUi = $true
}
if ($shouldHandleUi) {
  $ticketPromptShown = $false
  $ticketAction = "SKIPPED"
  $ticketPackCreatedOutDir = $null
  $shouldPromptBaseline = $false
  if ($viewState -and ($openFlag -or $LaunchpadMode.IsPresent) -and $result -ne "FAIL") {
    $latestVerdict = ""
    $latestId = if ($viewState.latestRunId) { [string]$viewState.latestRunId } else { "" }
    $idx = -1
    if ($viewState.lastN) {
      for ($i = 0; $i -lt $viewState.lastN.Count; $i++) {
        if ([string]$viewState.lastN[$i] -eq $latestId) { $idx = $i; break }
      }
    }
    if ($idx -ge 0 -and $viewState.keys -and $idx -lt $viewState.keys.Count) {
      $latestVerdict = [string]$viewState.keys[$idx].verdictVsBaseline
    }
    if (
      $latestVerdict -eq "CHANGED" -or
      $viewStatusNow -eq "CHANGED" -or
      $viewStatusNow -eq "BLOCKED"
    ) {
      $shouldPromptBaseline = $true
    }
  }
  if ($shouldPromptBaseline) {
    $accept = Show-AcceptBaselinePrompt -TargetKey $targetKey
    try {
      Add-Content -Path (Join-Path $outDir "report_card.txt") -Value "baselinePrompt=SHOWN" -Encoding UTF8
    } catch {
      # best effort only
    }
    if ($accept -ne $null -and "$accept" -eq "Yes") {
      try {
        if ($hasDist -and $nodePathResolved) {
          & $nodePathResolved $mainJs "library" "accept-baseline" $targetKey | Out-Null
        } elseif ($npmPathResolved) {
          & $npmPathResolved run weftend -- "library" "accept-baseline" $targetKey | Out-Null
        }
        try {
          Add-Content -Path (Join-Path $outDir "report_card.txt") -Value "baselineAction=ACCEPTED" -Encoding UTF8
        } catch {
          # best effort only
        }
        $baselineAccepted = $true
      } catch {
        # best effort only
      }
    } elseif ($accept -ne $null) {
      try {
        Add-Content -Path (Join-Path $outDir "report_card.txt") -Value "baselineAction=DECLINED" -Encoding UTF8
      } catch {
        # best effort only
      }
    }
  }
  if ($viewStatusNow -eq "CHANGED" -and $result -ne "FAIL") {
    $safeReceiptPath = Join-Path $outDir "safe_run_receipt.json"
    if (Test-Path -LiteralPath $safeReceiptPath) {
      $ticketPromptShown = $true
      $ticketChoice = Show-TicketPackPrompt -TargetKey $targetKey -RunId $runId
      if ($ticketChoice -ne $null -and "$ticketChoice" -eq "Yes") {
        $ticketResult = Create-TicketPackForRun -RunRoot $outDir -TargetKeyValue $targetKey -RunIdValue $runId
        if ($ticketResult.ok) {
          $ticketAction = "CREATED"
          $ticketPackCreatedOutDir = [string]$ticketResult.outDir
        } else {
          $ticketAction = "FAILED_" + [string]$ticketResult.code
        }
      } elseif ($ticketChoice -ne $null) {
        $ticketAction = "DECLINED"
      } else {
        $ticketAction = "SKIPPED"
      }
    }
  }
  if ($ticketPromptShown) {
    try {
      Add-Content -Path (Join-Path $outDir "report_card.txt") -Value "ticketPackPrompt=SHOWN" -Encoding UTF8
      Add-Content -Path (Join-Path $outDir "report_card.txt") -Value ("ticketPackAction=" + $ticketAction) -Encoding UTF8
    } catch {
      # best effort only
    }
    try {
      Add-Content -Path (Join-Path $outDir "wrapper_result.txt") -Value ("ticketPack=" + $ticketAction) -Encoding UTF8
    } catch {
      # best effort only
    }
  }
  $reportViewerOpened = $false
  $shouldOpenReportViewer = $false
  if ($openFlag -and $reportViewerAutoOpen) {
    if ($LaunchpadMode.IsPresent) {
      $shouldOpenReportViewer = $isChangedOrBlocked
    } else {
      $shouldOpenReportViewer = $true
    }
  }
  if ($shouldOpenReportViewer -and $useReportViewer) {
    $reportViewerOpened = Start-ReportCardViewer -RunDir $outDir -TargetDir $targetDir -TargetKey $targetKey
    if (-not $reportViewerOpened -and $script:reportViewerAutoDisabled) {
      try {
        Add-Content -Path (Join-Path $outDir "wrapper_result.txt") -Value "reportViewer=AUTO_DISABLED_STARTUP_FAIL" -Encoding UTF8
      } catch {
        # best effort only
      }
      try {
        Add-Content -Path (Join-Path $outDir "report_card.txt") -Value "reportViewerAutoOpen=DISABLED_STARTUP_FAIL" -Encoding UTF8
      } catch {
        # best effort only
      }
    }
  }
  if ($shouldOpenReportViewer -and -not $reportViewerOpened) {
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (Test-Path -LiteralPath $explorerPath) {
      Start-Process -FilePath $explorerPath -ArgumentList $outDir | Out-Null
    } else {
      Start-Process -FilePath "explorer.exe" -ArgumentList $outDir | Out-Null
    }
  }

  if ($OpenLibrary.IsPresent) {
    $null = New-Item -ItemType Directory -Force -Path $libraryRoot
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (Test-Path -LiteralPath $explorerPath) {
      Start-Process -FilePath $explorerPath -ArgumentList $libraryRoot | Out-Null
    } else {
      Start-Process -FilePath "explorer.exe" -ArgumentList $libraryRoot | Out-Null
    }
  } elseif ($LaunchpadMode.IsPresent -and $isChangedOrBlocked -and -not $reportViewerOpened) {
    $targetToOpen = if ($ticketPackCreatedOutDir) { $ticketPackCreatedOutDir } else { $outDir }
    $explorerPath = Join-Path $env:WINDIR "explorer.exe"
    if (Test-Path -LiteralPath $explorerPath) {
      Start-Process -FilePath $explorerPath -ArgumentList $targetToOpen | Out-Null
    } else {
      Start-Process -FilePath "explorer.exe" -ArgumentList $targetToOpen | Out-Null
    }
  }
}

if ($AllowLaunch.IsPresent) {
  $launchResult = "SKIPPED"
  $blockedRun = $false
  if ($viewState -and $viewState.blocked -and $viewState.blocked.runId) { $blockedRun = $true }
  $effectiveBlockedRun = $blockedRun -and -not $baselineAccepted
  $canLaunch = Is-LaunchableExecutable -PathValue $TargetPath
  if ($result -ne "FAIL" -and -not $effectiveBlockedRun -and $canLaunch) {
    $statusNow = if ($viewStatus) { $viewStatus } else { "UNKNOWN" }
    $isBlockedStatus = $statusNow -eq "CHANGED" -or $statusNow -eq "BLOCKED"
    $allowLaunchByStatus = $statusNow -eq "SAME" -or $baselineAccepted
    if ($LaunchpadMode.IsPresent) {
      $allowLaunchByStatus = (-not $isBlockedStatus) -or $baselineAccepted
    }
    if ($allowLaunchByStatus) {
      $expectedDigest = Resolve-ExpectedLaunchDigest -Summary $summary
      $launchAllowed = $true
      if ($expectedDigest -and $expectedDigest.StartsWith("sha256:", [System.StringComparison]::OrdinalIgnoreCase)) {
        $currentDigest = Compute-FileSha256Digest -PathValue $TargetPath
        if (-not $currentDigest -or ($currentDigest.ToLowerInvariant() -ne $expectedDigest.ToLowerInvariant())) {
          # Launch must fail closed if target bytes changed between scan and execution.
          $launchAllowed = $false
          $launchResult = "BLOCKED_DIGEST_MISMATCH"
        }
      }
      if ($launchAllowed) {
        try {
          $workDir = Split-Path -Parent $TargetPath
          $launchArgs = Decode-LaunchArgs -Value $LaunchArgsB64
          $launchMinimized = Should-LaunchMinimized -PathValue $TargetPath
          if ($workDir -and (Test-Path -LiteralPath $workDir)) {
            if ($launchArgs -and $launchArgs.Trim() -ne "") {
              if ($launchMinimized) {
                Start-Process -FilePath $TargetPath -ArgumentList $launchArgs -WorkingDirectory $workDir -WindowStyle Minimized | Out-Null
              } else {
                Start-Process -FilePath $TargetPath -ArgumentList $launchArgs -WorkingDirectory $workDir | Out-Null
              }
            } else {
              if ($launchMinimized) {
                Start-Process -FilePath $TargetPath -WorkingDirectory $workDir -WindowStyle Minimized | Out-Null
              } else {
                Start-Process -FilePath $TargetPath -WorkingDirectory $workDir | Out-Null
              }
            }
          } else {
            if ($launchArgs -and $launchArgs.Trim() -ne "") {
              if ($launchMinimized) {
                Start-Process -FilePath $TargetPath -ArgumentList $launchArgs -WindowStyle Minimized | Out-Null
              } else {
                Start-Process -FilePath $TargetPath -ArgumentList $launchArgs | Out-Null
              }
            } else {
              if ($launchMinimized) {
                Start-Process -FilePath $TargetPath -WindowStyle Minimized | Out-Null
              } else {
                Start-Process -FilePath $TargetPath | Out-Null
              }
            }
          }
          $launchResult = "STARTED"
        } catch {
          $launchResult = "FAILED"
        }
      }
    }
  }
  try {
    Add-Content -Path (Join-Path $outDir "wrapper_result.txt") -Value ("launch=" + $launchResult) -Encoding UTF8
  } catch {
    # best effort only
  }
}

exit $finalExitCode
