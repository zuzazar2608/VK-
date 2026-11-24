Add-Type -AssemblyName System.Drawing
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($size in @(16, 32, 48, 128)) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(41, 50, 66))
  $fontSize = [single]($size * 0.52)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(242, 240, 235))
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString('VK', $font, $brush, $rect, $format)
  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(232, 135, 62))
  $g.FillRectangle($accent, 0, [single]($size * 0.84), $size, [single]($size * 0.16))
  $bmp.Save((Join-Path $dir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $accent.Dispose(); $format.Dispose(); $brush.Dispose(); $font.Dispose(); $g.Dispose(); $bmp.Dispose()
}
