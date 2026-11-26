<#
Builds installer\out\FileBrowser-<version>.msi.
The MSI holds File Browser's window (app\filebrowser-app.exe) and server (app\filebrowser.exe), both
built from server-rs, the web app (app\public), the
mega.nz helper (app\mega-sidecar) and the launchers. ffmpeg and the PDF tools are downloaded on first
run; Node.js only when mega.nz is set up (tools-manifest.json, fetch-tools.ps1). Run
pack-pdf-tools.ps1 first when the Poppler/Ghostscript pack changes. Needs Rust (cargo) and Node/npm.
#>
$ErrorActionPreference = 'Stop'
$root  = Resolve-Path "$PSScriptRoot\.."
$stage = "$PSScriptRoot\stage"
$out   = "$PSScriptRoot\out"
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage, "$stage\app", "$stage\licenses", $out -Force | Out-Null

# The server: one program, no runtime to install. Cargo reports progress on stderr, which
# Windows PowerShell would otherwise turn into a terminating error.
Push-Location "$root\server-rs"
$ErrorActionPreference = 'Continue'
cargo build --release 2>&1 | ForEach-Object { "$_" }
$built = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($built) { throw 'cargo build failed' }
Copy-Item "$root\server-rs\target\release\filebrowser.exe", "$root\server-rs\target\release\filebrowser-app.exe", "$root\README.md" "$stage\app"
Copy-Item "$root\public" "$stage\app" -Recurse

# mega.nz helper and its one dependency (run by Node.js once mega.nz is set up)
New-Item -ItemType Directory "$stage\app\mega-sidecar" -Force | Out-Null
Copy-Item "$root\mega-sidecar\index.js", "$root\mega-sidecar\package.json" "$stage\app\mega-sidecar"
Push-Location "$stage\app\mega-sidecar"; npm install --omit=dev --no-audit --no-fund; $npm = $LASTEXITCODE; Pop-Location
if ($npm) { throw 'npm install failed' }

Copy-Item "$PSScriptRoot\filebrowser.cmd", "$PSScriptRoot\filebrowser.ico", "$PSScriptRoot\fetch-tools.ps1", "$PSScriptRoot\tools-manifest.json", "$root\THIRD-PARTY-NOTICES.txt" $stage
node "$PSScriptRoot\list-npm-licenses.js" "$stage\app\mega-sidecar\node_modules" "$stage\licenses\npm-packages.txt"

# Licenses of the Rust crates compiled into filebrowser.exe
$meta = cargo metadata --format-version 1 --manifest-path "$root\server-rs\Cargo.toml" --filter-platform x86_64-pc-windows-msvc | ConvertFrom-Json
$used = @{}; foreach ($n in $meta.resolve.nodes) { $used[$n.id] = $true }
$lines = $meta.packages | Where-Object { $used[$_.id] -and $_.name -ne 'filebrowser' } | Sort-Object name, version |
    ForEach-Object { "{0} {1}    {2}" -f $_.name, $_.version, $(if ($_.license) { $_.license } else { 'see ' + $_.license_file }) }
Set-Content "$stage\licenses\rust-crates.txt" -Encoding utf8 -Value (@('Rust crates compiled into filebrowser.exe', '') + $lines)

$manifest = Get-Content "$PSScriptRoot\tools-manifest.json" -Raw | ConvertFrom-Json
foreach ($t in $manifest.tools) {
    if ($t.sha256 -notmatch '^[0-9A-Fa-f]{64}$') {
        Write-Warning "tools-manifest.json: '$($t.name)' has no valid sha256 - run pack-pdf-tools.ps1 and upload its zip, or that tool will not install."
    }
}

if (-not (Get-Command wix -ErrorAction SilentlyContinue)) { dotnet tool install --global wix --version 5.0.2 }
wix extension add -g WixToolset.Util.wixext/5.0.2 | Out-Null
wix extension add -g WixToolset.UI.wixext/5.0.2 | Out-Null
$msi = "$out\FileBrowser-$version.msi"
wix build "$PSScriptRoot\Package.wxs" -arch x64 -ext WixToolset.Util.wixext -ext WixToolset.UI.wixext -d Version=$version -d Stage=$stage -o $msi
if ($LASTEXITCODE) { throw 'wix build failed' }
"{0}  ({1:N1} MB)" -f $msi, ((Get-Item $msi).Length / 1MB)
