<#
File Browser with a notification-area (taskbar) icon.
Serves -Dir (or a folder picked in a dialog), opens the browser, and keeps an icon
whose menu reopens the page or stops the server. If a server is already running on
the port, it is switched to the new folder instead of starting a second one.
#>
param([string]$Dir, [switch]$Help)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$fb = $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { '3000' }
$url = "http://localhost:$port"
# -Help (Explorer's "File Browser help" entry) opens the page with the shortcut legend showing
$openUrl = if ($Help) { "$url/?help=shortcuts" } else { $url }
$logDir = Join-Path $env:LOCALAPPDATA 'FileBrowser'
New-Item -ItemType Directory $logDir -Force | Out-Null
$log = Join-Path $logDir 'server.log'

function Show-Error($text) {
    [System.Windows.Forms.MessageBox]::Show($text, 'File Browser', 'OK', 'Error') | Out-Null
}

if (-not $Dir) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Folder to serve'
    $dialog.SelectedPath = if (Test-Path 'Z:\') { 'Z:\' } else { $env:USERPROFILE }
    if ($dialog.ShowDialog() -ne 'OK') { exit }
    $Dir = $dialog.SelectedPath
}
if (-not (Test-Path $Dir -PathType Container)) { Show-Error "Not a folder: $Dir"; exit 1 }

# Already running: point it at the new folder and open the page
try {
    Invoke-RestMethod "$url/api/server-info" -TimeoutSec 2 | Out-Null
    if ($Help) { Start-Process $openUrl; exit }
    try {
        Invoke-RestMethod "$url/api/config/root" -Method Post -ContentType 'application/json' `
            -Body (@{ path = $Dir } | ConvertTo-Json) | Out-Null
    } catch {
        Show-Error "File Browser is already running on port $port but could not switch to $Dir.`n$($_.Exception.Message)"
    }
    Start-Process $openUrl
    exit
} catch { }

# First run: download Node and the media tools (shows a progress window)
try { $tools = & (Join-Path $fb 'fetch-tools.ps1') -Gui }
catch { Show-Error "Could not set up File Browser's tools. Check your internet connection and try again.`n`n$($_.Exception.Message)"; exit 1 }
$env:PATH = $tools.Path + ';' + $env:PATH
$env:PORT = $port

$server = Start-Process $tools.Node -ArgumentList "`"$(Join-Path $fb 'app\server.js')`"" `
    -WorkingDirectory $Dir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"

# Wait for the port to answer before opening the page
$ready = $false
for ($i = 0; $i -lt 60 -and -not $server.HasExited; $i++) {
    try { Invoke-RestMethod "$url/api/server-info" -TimeoutSec 1 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Milliseconds 250 }
}
if (-not $ready) {
    $detail = (Get-Content "$log.err", $log -Tail 15 -ErrorAction SilentlyContinue) -join "`n"
    if (-not $server.HasExited) { & taskkill /T /F /PID $server.Id | Out-Null }
    Show-Error "File Browser did not start.`n`n$detail`n`nLog: $log"
    exit 1
}
Start-Process $openUrl

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = New-Object System.Drawing.Icon (Join-Path $fb 'filebrowser.ico')
$tip = "File Browser - $Dir"
$icon.Text = if ($tip.Length -gt 63) { $tip.Substring(0, 60) + '...' } else { $tip }

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$serving = $menu.Items.Add("Serving $Dir on port $port")
$serving.Enabled = $false
$menu.Items.Add('-') | Out-Null
$open = $menu.Items.Add('Open in browser')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Start-Process $url })
$help = $menu.Items.Add('Keyboard shortcuts / Help')
$help.add_Click({ Start-Process "$url/?help=shortcuts" })
$stop = $menu.Items.Add('Stop File Browser')
$stop.add_Click({
    # /T also ends ffmpeg/gm children still working for the server
    if (-not $server.HasExited) { & taskkill /T /F /PID $server.Id | Out-Null }
    $icon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Start-Process $url })
$icon.Visible = $true

# Drop the icon if the server dies on its own
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
    if ($server.HasExited) {
        $timer.Stop()
        $icon.Visible = $false
        Show-Error "File Browser stopped unexpectedly.`n`nLog: $log"
        [System.Windows.Forms.Application]::Exit()
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$icon.Dispose()
