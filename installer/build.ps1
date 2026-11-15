<#
Builds installer\out\FileBrowser-<version>.msi.
Stages app + production node_modules + node.exe + external tools, then runs WiX.
Tool locations default to this machine's; override with parameters.
#>
param(
    [string]$Ffmpeg   = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin",
    [string]$Poppler  = 'D:\Tools\Poppler\poppler-25.07.0\Library\bin',
    [string]$Pandoc   = 'D:\Tools\Pandoc\pandoc-3.13',
    [string]$Unrar    = 'D:\Tools\UnRAR',
    [string]$Zip      = 'D:\Tools\GnuWin32Zip\bin',
    [string]$GraphicsMagick = 'D:\Tools\GraphicsMagick',
    [string]$Ghostscript    = 'D:\Tools\Ghostscript\bin'
)
$ErrorActionPreference = 'Stop'
$root  = Resolve-Path "$PSScriptRoot\.."
$stage = "$PSScriptRoot\stage"
$out   = "$PSScriptRoot\out"
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version

foreach ($p in $Ffmpeg, $Poppler, $Pandoc, $Unrar, $Zip, $GraphicsMagick, $Ghostscript) {
    if (-not (Test-Path $p)) { throw "Missing tool folder: $p (pass it as a parameter)" }
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage, "$stage\app", "$stage\runtime", $out -Force | Out-Null

# app (no tests/specs/dev data), then production dependencies only
Copy-Item "$root\server.js", "$root\auth.js", "$root\cache.js", "$root\package.json", "$root\package-lock.json" "$stage\app" -ErrorAction SilentlyContinue
Copy-Item "$root\lib", "$root\routes", "$root\middleware", "$root\utils", "$root\public" "$stage\app" -Recurse
Push-Location "$stage\app"; npm install --omit=dev --no-audit --no-fund; Pop-Location
if ($LASTEXITCODE) { throw 'npm install failed' }

Copy-Item (Get-Command node).Source "$stage\runtime\node.exe"

# external tools: one subfolder each, matching the PATH set in filebrowser.cmd
function Stage-Tool($name, $src, $files) {
    $dst = "$stage\tools\$name"; New-Item -ItemType Directory $dst -Force | Out-Null
    if ($files) { foreach ($f in $files) { Copy-Item "$src\$f" $dst } } else { Copy-Item "$src\*" $dst -Recurse }
}
Stage-Tool ffmpeg $Ffmpeg @('ffmpeg.exe', 'ffprobe.exe')
Stage-Tool poppler $Poppler $null
Stage-Tool pandoc $Pandoc @('pandoc.exe')
Stage-Tool unrar $Unrar @('UnRAR.exe')
Stage-Tool zip $Zip @('zip.exe', 'bzip2.dll', 'zip32z64.dll')
Stage-Tool graphicsmagick $GraphicsMagick $null
Stage-Tool ghostscript $Ghostscript $null
Copy-Item "$PSScriptRoot\filebrowser.cmd", "$PSScriptRoot\filebrowser-tray.ps1", "$PSScriptRoot\filebrowser-tray.vbs", "$PSScriptRoot\filebrowser.ico" $stage

# license texts + notice
function Stage-License($name, $src) {
    $dst = "$stage\licenses\$name"; New-Item -ItemType Directory $dst -Force | Out-Null
    foreach ($f in $src) { Copy-Item $f $dst }
}
$ffmpegRoot = Split-Path $Ffmpeg
Stage-License ffmpeg @("$ffmpegRoot\LICENSE", "$ffmpegRoot\README.txt")
Stage-License poppler @("$Poppler\..\..\share\poppler\COPYING", "$Poppler\..\..\share\poppler\COPYING.gpl2", "$Poppler\..\..\share\poppler\COPYING.adobe")
Stage-License pandoc @("$Pandoc\COPYRIGHT.txt")
Stage-License ghostscript @("$Ghostscript\..\doc\COPYING")
Stage-License graphicsmagick @("$GraphicsMagick\Copyright.txt")
Stage-License unrar @("$Unrar\license.txt")
& "$stage\tools\zip\zip.exe" -L | Set-Content "$stage\licenses\Info-ZIP.txt"
node "$PSScriptRoot\list-npm-licenses.js" "$stage\app\node_modules" "$stage\licenses\npm-packages.txt"
Copy-Item "$root\THIRD-PARTY-NOTICES.txt" $stage

if (-not (Get-Command wix -ErrorAction SilentlyContinue)) { dotnet tool install --global wix --version 5.0.2 }
$msi = "$out\FileBrowser-$version.msi"
wix build "$PSScriptRoot\Package.wxs" -arch x64 -d Version=$version -d Stage=$stage -o $msi
if ($LASTEXITCODE) { throw 'wix build failed' }
"{0}  ({1:N0} MB)" -f $msi, ((Get-Item $msi).Length / 1MB)
