<#
Builds installer\out\FileBrowser-<version>.msi.
The MSI holds only the app, its production node_modules and the launchers; Node, ffmpeg and the PDF
tools are downloaded on first run (tools-manifest.json, fetch-tools.ps1). Run pack-pdf-tools.ps1
first when the GraphicsMagick/Ghostscript pack changes.
#>
$ErrorActionPreference = 'Stop'
$root  = Resolve-Path "$PSScriptRoot\.."
$stage = "$PSScriptRoot\stage"
$out   = "$PSScriptRoot\out"
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage, "$stage\app", "$stage\licenses", $out -Force | Out-Null

# app (no tests/specs/dev data), then production dependencies only
Copy-Item "$root\server.js", "$root\auth.js", "$root\cache.js", "$root\package.json", "$root\package-lock.json" "$stage\app" -ErrorAction SilentlyContinue
Copy-Item "$root\lib", "$root\routes", "$root\middleware", "$root\utils", "$root\public" "$stage\app" -Recurse
Push-Location "$stage\app"; npm install --omit=dev --no-audit --no-fund; Pop-Location
if ($LASTEXITCODE) { throw 'npm install failed' }

# pdf-parse ships four pdf.js builds; it loads only its default (v1.10.100)
$pdfjs = "$stage\app\node_modules\pdf-parse\lib\pdf.js"
Get-ChildItem $pdfjs -Directory | Where-Object Name -ne 'v1.10.100' | Remove-Item -Recurse -Force

Copy-Item "$PSScriptRoot\filebrowser.cmd", "$PSScriptRoot\filebrowser-tray.ps1", "$PSScriptRoot\filebrowser-tray.vbs",
    "$PSScriptRoot\filebrowser.ico", "$PSScriptRoot\fetch-tools.ps1", "$PSScriptRoot\tools-manifest.json", "$root\THIRD-PARTY-NOTICES.txt" $stage
node "$PSScriptRoot\list-npm-licenses.js" "$stage\app\node_modules" "$stage\licenses\npm-packages.txt"

$manifest = Get-Content "$PSScriptRoot\tools-manifest.json" -Raw | ConvertFrom-Json
foreach ($t in $manifest.tools) {
    if ($t.sha256 -notmatch '^[0-9A-Fa-f]{64}$') {
        Write-Warning "tools-manifest.json: '$($t.name)' has no valid sha256 - run pack-pdf-tools.ps1 and upload its zip, or that tool will not install."
    }
}

if (-not (Get-Command wix -ErrorAction SilentlyContinue)) { dotnet tool install --global wix --version 5.0.2 }
wix extension add -g WixToolset.Util.wixext/5.0.2 | Out-Null
$msi = "$out\FileBrowser-$version.msi"
wix build "$PSScriptRoot\Package.wxs" -arch x64 -ext WixToolset.Util.wixext -d Version=$version -d Stage=$stage -o $msi
if ($LASTEXITCODE) { throw 'wix build failed' }
"{0}  ({1:N1} MB)" -f $msi, ((Get-Item $msi).Length / 1MB)
