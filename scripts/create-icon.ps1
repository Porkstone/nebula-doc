Add-Type -AssemblyName System.Drawing
$rootPath = Split-Path -Parent $PSScriptRoot
$buildPath = Join-Path $rootPath 'build'
New-Item -ItemType Directory -Force -Path $buildPath | Out-Null
$bitmap = New-Object System.Drawing.Bitmap(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(146, 118, 175))
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 252, 255), 12)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$left = New-Object System.Drawing.Drawing2D.GraphicsPath
$left.AddBezier(55, 68, 84, 60, 107, 68, 128, 84)
$left.AddLine(128, 84, 128, 202)
$left.AddBezier(128, 202, 107, 186, 84, 178, 55, 186)
$left.CloseFigure()
$right = New-Object System.Drawing.Drawing2D.GraphicsPath
$right.AddBezier(128, 84, 149, 68, 172, 60, 201, 68)
$right.AddLine(201, 68, 201, 186)
$right.AddBezier(201, 186, 172, 178, 149, 186, 128, 202)
$graphics.DrawPath($pen, $left)
$graphics.DrawPath($pen, $right)
$memory = New-Object System.IO.MemoryStream
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $memory.ToArray()
$iconFile = [System.IO.File]::Create((Join-Path $buildPath 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter($iconFile)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$pngBytes.Length); $writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose(); $memory.Dispose(); $pen.Dispose(); $left.Dispose(); $right.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
Write-Output 'Created build/icon.ico from the Nebula book icon.'
