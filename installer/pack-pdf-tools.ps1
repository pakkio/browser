<#
Packs Poppler (pdfinfo/pdftoppm, the primary PDF path) + GraphicsMagick + Ghostscript (pdf2pic fallback)
into out\pdf-tools-win64.zip and writes its SHA-256 into tools-manifest.json. Upload the zip as the
release asset named in the manifest URL (a GitHub release of this repo) before shipping an installer.
#>
param(
    [string]$Poppler        = 'D:\Tools\Poppler\poppler-25.07.0\Library\bin',
    [string]$GraphicsMagick = 'D:\Tools\GraphicsMagick',
    [string]$Ghostscript    = 'D:\Tools\Ghostscript'
)
$ErrorActionPreference = 'Stop'
$out = "$PSScriptRoot\out"
$work = Join-Path ([IO.Path]::GetTempPath()) "pdf-tools-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory $out, "$work\poppler", "$work\graphicsmagick", "$work\ghostscript", "$work\licenses" -Force | Out-Null
try {
    Copy-Item "$Poppler\*" "$work\poppler" -Recurse
    Copy-Item "$GraphicsMagick\*" "$work\graphicsmagick" -Recurse
    # gs needs Resource (and lib, when present) next to bin; samples and docs stay out
    foreach ($d in 'bin', 'Resource', 'lib') {
        if (Test-Path "$Ghostscript\$d") { Copy-Item "$Ghostscript\$d" "$work\ghostscript\$d" -Recurse }
    }
    foreach ($f in 'COPYING', 'COPYING.gpl2', 'COPYING.adobe') {
        Copy-Item "$Poppler\..\..\share\poppler\$f" "$work\licenses\poppler-$f.txt"
    }
    Copy-Item "$Ghostscript\doc\COPYING" "$work\licenses\ghostscript-COPYING.txt"
    Copy-Item "$GraphicsMagick\Copyright.txt" "$work\licenses\graphicsmagick-Copyright.txt"

    $zip = "$out\pdf-tools-win64.zip"
    Remove-Item $zip -ErrorAction SilentlyContinue
    Compress-Archive "$work\*" $zip -CompressionLevel Optimal
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash

    $path = "$PSScriptRoot\tools-manifest.json"
    $manifest = Get-Content $path -Raw | ConvertFrom-Json
    ($manifest.tools | Where-Object name -eq 'pdf-tools').sha256 = $hash
    $manifest | ConvertTo-Json -Depth 5 | Set-Content $path -Encoding utf8
    "{0}  ({1:N1} MB)`nsha256 {2} written to tools-manifest.json" -f $zip, ((Get-Item $zip).Length / 1MB), $hash
} finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
