# tools/windows/gen_icon.ps1
# Generate a glyph-only icon from a source PNG (no text), output .ico and .png.

param(
  [string]$PngPath = "assets\\weftend_logo.png",
  [string]$OutPng = "assets\\weftend_logo_icon.png",
  [string]$OutIco = "assets\\weftend_logo.ico",
  [int]$Size = 512
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $PngPath)) { throw "Missing $PngPath" }

Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap $PngPath
$workSize = 512
$work = New-Object System.Drawing.Bitmap $workSize, $workSize
$gWork = [System.Drawing.Graphics]::FromImage($work)
$gWork.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gWork.Clear([System.Drawing.Color]::Transparent)
$gWork.DrawImage($bmp, 0, 0, $workSize, $workSize)
$gWork.Dispose()

$w = $work.Width
$h = $work.Height
$threshold = [int]($w * 0.01)
$rowActive = New-Object int[] $h

function Is-ForegroundPixel {
  param([System.Drawing.Color]$c)
  if ($c.A -le 10) { return $false }
  $r = [double]$c.R
  $g = [double]$c.G
  $b = [double]$c.B
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $v = $max / 255.0
  $s = if ($max -eq 0) { 0.0 } else { ($max - $min) / $max }
  # Treat low-saturation, very bright pixels as background (white tile)
  if ($v -gt 0.92 -and $s -lt 0.18) { return $false }
  return $true
}

for ($y=0; $y -lt $h; $y++) {
  $cnt = 0
  for ($x=0; $x -lt $w; $x++) {
    $c = $work.GetPixel($x, $y)
    if (Is-ForegroundPixel $c) { $cnt++ }
  }
  $rowActive[$y] = $cnt
}

$segments = @()
$start = $null
for ($y=0; $y -lt $h; $y++) {
  $active = ($rowActive[$y] -gt $threshold)
  if ($active -and $start -eq $null) { $start = $y }
  if (-not $active -and $start -ne $null) { $segments += ,@($start, ($y-1)); $start = $null }
}
if ($start -ne $null) { $segments += ,@($start, ($h-1)) }
if ($segments.Count -lt 1) { throw "No content detected in $PngPath" }

$iconY0 = $segments[0][0]
$iconY1 = $segments[0][1]
$x0 = $w - 1
$x1 = 0
for ($y=$iconY0; $y -le $iconY1; $y++) {
  for ($x=0; $x -lt $w; $x++) {
    $c = $work.GetPixel($x, $y)
    if (Is-ForegroundPixel $c) {
      if ($x -lt $x0) { $x0 = $x }
      if ($x -gt $x1) { $x1 = $x }
    }
  }
}

$pad = [int]($w * 0.02)
$x0 = [Math]::Max(0, $x0 - $pad)
$x1 = [Math]::Min($w - 1, $x1 + $pad)
$iconY0 = [Math]::Max(0, $iconY0 - $pad)
$iconY1 = [Math]::Min($h - 1, $iconY1 + $pad)

$cropW = $x1 - $x0 + 1
$cropH = $iconY1 - $iconY0 + 1
$crop = New-Object System.Drawing.Bitmap $cropW, $cropH
$g = [System.Drawing.Graphics]::FromImage($crop)
$dest = New-Object System.Drawing.Rectangle 0, 0, $cropW, $cropH
$srcRect = New-Object System.Drawing.Rectangle $x0, $iconY0, $cropW, $cropH
$g.DrawImage($work, $dest, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

# Remove background in the cropped icon
for ($y=0; $y -lt $cropH; $y++) {
  for ($x=0; $x -lt $cropW; $x++) {
    $c = $crop.GetPixel($x, $y)
    if (-not (Is-ForegroundPixel $c)) {
      $crop.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0,0,0,0))
    }
  }
}

$size = [Math]::Max($cropW, $cropH)
$canvas = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::Transparent)
$offx = [int](($size - $cropW) / 2)
$offy = [int](($size - $cropH) / 2)
$g.DrawImage($crop, $offx, $offy, $cropW, $cropH)
$g.Dispose()

$scaled = New-Object System.Drawing.Bitmap $Size, $Size
$g = [System.Drawing.Graphics]::FromImage($scaled)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($canvas, 0, 0, $Size, $Size)
$g.Dispose()

$scaled.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = [System.IO.File]::ReadAllBytes($OutPng)
$fs = New-Object System.IO.FileStream($OutIco, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
# ICONDIRENTRY (PNG-encoded)
$bw.Write([Byte]0) # width 256
$bw.Write([Byte]0) # height 256
$bw.Write([Byte]0) # color count
$bw.Write([Byte]0) # reserved
$bw.Write([UInt16]1) # planes
$bw.Write([UInt16]32) # bpp
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32](6 + 16)) # offset to image data
$bw.Write($pngBytes)
$bw.Flush()
$bw.Close()
$fs.Close()

$bmp.Dispose(); $work.Dispose(); $crop.Dispose(); $canvas.Dispose(); $scaled.Dispose()
