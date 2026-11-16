<#
Makes sure the tools listed in tools-manifest.json are present under
%LOCALAPPDATA%\FileBrowser\tools, downloading and SHA-256-checking any that are missing.
Each tool lives in tools\<name>-<version>, so a manifest bump fetches the new version.

  fetch-tools.ps1 [-Gui]   returns @{ Node = <node.exe>; Path = <dirs for PATH> }
  fetch-tools.ps1 -Cmd     writes tools\env.cmd (FB_NODE / FB_PATH) for filebrowser.cmd

A failed "required" tool (node) throws; the others only warn, and the server starts without them.
#>
param([switch]$Gui, [switch]$Cmd)
$ErrorActionPreference = 'Stop'

$manifest = Get-Content (Join-Path $PSScriptRoot 'tools-manifest.json') -Raw | ConvertFrom-Json
$toolsRoot = Join-Path $env:LOCALAPPDATA 'FileBrowser\tools'
New-Item -ItemType Directory $toolsRoot -Force | Out-Null

$form = $null
if ($Gui) {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $form = New-Object System.Windows.Forms.Form -Property @{
        Text = 'File Browser'; Width = 420; Height = 130; StartPosition = 'CenterScreen'
        FormBorderStyle = 'FixedDialog'; ControlBox = $false; TopMost = $true
    }
    $label = New-Object System.Windows.Forms.Label -Property @{ Left = 12; Top = 12; Width = 380; Height = 36 }
    $bar = New-Object System.Windows.Forms.ProgressBar -Property @{ Left = 12; Top = 54; Width = 380; Height = 20 }
    $form.Controls.AddRange(@($label, $bar))
    $form.Show()
}

function Show-Progress($text, $percent) {
    if ($form) {
        $label.Text = $text; $bar.Value = [math]::Max(0, [math]::Min(100, $percent))
        [System.Windows.Forms.Application]::DoEvents()
    } else {
        Write-Progress -Activity 'File Browser: first-run setup' -Status $text -PercentComplete $percent
    }
}

function Get-Download($tool, $file) {
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(30)
    try {
        $response = $client.GetAsync($tool.url, 'ResponseHeadersRead').GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode() | Out-Null
        $total = $response.Content.Headers.ContentLength
        $in = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $out = [IO.File]::Create($file)
        try {
            $buffer = New-Object byte[] 262144
            $done = 0
            while (($n = $in.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $out.Write($buffer, 0, $n); $done += $n
                $pct = if ($total) { [int](100 * $done / $total) } else { 0 }
                Show-Progress ("Downloading {0} {1} ({2:N0} MB)" -f $tool.name, $tool.version, ($done / 1MB)) $pct
            }
        } finally { $out.Dispose(); $in.Dispose() }
    } finally { $client.Dispose() }
}

# Plain .NET instead of Get-FileHash / Expand-Archive: no dependency on PowerShell modules auto-loading
function Get-Sha256($file) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($file)
    try { [BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '' }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Install-Tool($tool, $dest) {
    $work = Join-Path $toolsRoot ("tmp-{0}-{1}" -f $tool.name, [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $work | Out-Null
    try {
        $zip = Join-Path $work 'download.zip'
        Get-Download $tool $zip
        Show-Progress "Verifying $($tool.name)" 100
        $hash = Get-Sha256 $zip
        if ($hash -ne $tool.sha256) { throw "SHA-256 mismatch for $($tool.name): expected $($tool.sha256), got $hash" }
        Show-Progress "Unpacking $($tool.name)" 100
        $extract = Join-Path $work 'x'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
        # an archive with a single top-level folder is unwrapped
        $top = @(Get-ChildItem $extract)
        $src = if ($top.Count -eq 1 -and $top[0].PSIsContainer) { $top[0].FullName } else { $extract }
        Move-Item $src $dest
    } finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

$dirs = @(); $node = $null; $problems = @()
foreach ($tool in $manifest.tools) {
    $dest = Join-Path $toolsRoot ("{0}-{1}" -f $tool.name, $tool.version)
    try {
        if (-not (Test-Path $dest)) { Install-Tool $tool $dest }
        foreach ($d in $tool.dirs) { $dirs += (Join-Path $dest $d).TrimEnd('\') }
        if ($tool.name -eq 'node') { $node = Join-Path $dest 'node.exe' }
    } catch {
        if ($tool.required) { if ($form) { $form.Close() }; throw }
        $problems += "$($tool.name): $($_.Exception.Message)"
    }
}
if ($form) { $form.Close() }
if ($problems) { Write-Warning ("Optional tools unavailable (some previews will be missing):`n" + ($problems -join "`n")) }

# remove versions no longer in the manifest
$keep = $manifest.tools | ForEach-Object { "{0}-{1}" -f $_.name, $_.version }
Get-ChildItem $toolsRoot -Directory | Where-Object { $_.Name -notin $keep } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$path = $dirs -join ';'
if ($Cmd) {
    Set-Content (Join-Path $toolsRoot 'env.cmd') -Encoding ascii -Value @("set `"FB_NODE=$node`"", "set `"FB_PATH=$path`"")
} else {
    [pscustomobject]@{ Node = $node; Path = $path; Problems = $problems }
}
