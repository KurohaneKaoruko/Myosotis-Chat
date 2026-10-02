# Generates a 1024x1024 app icon: forget-me-not (Myosotis) flower
Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
    $p.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
    $p.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $p.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $p.CloseFigure()
    return $p
}

# Background: deep indigo -> violet gradient (night-sky feel)
$bg = New-RoundRect 12 12 ($size - 24) ($size - 24) 232
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    [System.Drawing.Color]::FromArgb(255, 51, 49, 138),
    [System.Drawing.Color]::FromArgb(255, 124, 77, 199))
$g.FillPath($grad, $bg)

# Five petals: soft forget-me-not blue circles around the center
$petal = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 154, 183, 255))
$cx = 512.0; $cy = 520.0; $dist = 168.0; $pr = 118.0
for ($i = 0; $i -lt 5; $i++) {
    $angle = -90 + ($i * 72)
    $rad = $angle * [Math]::PI / 180
    $px = $cx + $dist * [Math]::Cos($rad)
    $py = $cy + $dist * [Math]::Sin($rad)
    $g.FillEllipse($petal, ($px - $pr), ($py - $pr), (2 * $pr), (2 * $pr))
}

# Golden heart of the flower
$heart = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 205, 89))
$hr = 70.0
$g.FillEllipse($heart, ($cx - $hr), ($cy - $hr), (2 * $hr), (2 * $hr))

# Tiny sparkle top-right, like a stored memory
$spark = New-Object System.Drawing.Drawing2D.GraphicsPath
$spark.AddPolygon(@(
    (New-Object System.Drawing.PointF(790, 170)),
    (New-Object System.Drawing.PointF(810, 220)),
    (New-Object System.Drawing.PointF(860, 240)),
    (New-Object System.Drawing.PointF(810, 260)),
    (New-Object System.Drawing.PointF(790, 310)),
    (New-Object System.Drawing.PointF(770, 260)),
    (New-Object System.Drawing.PointF(720, 240)),
    (New-Object System.Drawing.PointF(770, 220))))
$g.FillPath([System.Drawing.Brushes]::White, $spark)

$g.Dispose()
$out = Join-Path $PSScriptRoot "..\app-icon.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Icon saved: $out"
