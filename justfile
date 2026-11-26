# Serve a folder on the default port (3000). With no argument it tries Z:\ first (/mnt/z, or
# Windows node.exe when WSL can't see the drive) and falls back to test-files.
# Override with `just run ~/Books` or PORT=4000 just run. Works from WSL and PowerShell.
fallback := "test-files"

default: run

# Install deps if missing, print usage, then start the server
[unix]
run folder="":
    #!/usr/bin/env bash
    set -euo pipefail
    [ -d node_modules ] || npm install
    port="${PORT:-3000}"
    if (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        echo "Port $port is already in use (old server still running?). Stop it: pkill -f 'node server.js'"
        exit 1
    fi
    dir="{{folder}}"
    if [ -z "$dir" ]; then
        # Z:\ is a Windows drive; mapped/virtual ones (e.g. RaiDrive) are not visible to WSL,
        # so when /mnt/z is empty but Windows has Z:\, serve it with the Windows node.exe
        if [ -n "$(ls -A /mnt/z 2>/dev/null | head -1)" ]; then
            dir=/mnt/z
        elif [ "$(powershell.exe -NoProfile -Command 'Test-Path Z:\' 2>/dev/null | tr -d '\r')" = "True" ]; then
            echo "File Browser -> http://localhost:$port  (serving Z:\ via Windows node)"
            echo "  stop: Ctrl+C | other folder: just run PATH | other port: PORT=4000 just run"
            # reload PATH from the registry so tools installed after WSL started are found
            exec powershell.exe -NoProfile -Command "\$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); Set-Location '$(wslpath -w "$PWD")'; \$env:PORT='$port'; node server.js 'Z:\'"
        else
            echo "Z:\\ not available, falling back to {{fallback}}"
            dir="{{fallback}}"
        fi
    fi
    echo "File Browser -> http://localhost:$port  (serving $dir)"
    echo "  stop: Ctrl+C | other folder: just run PATH | other port: PORT=4000 just run"
    echo "  Google login: AUTH=true plus credentials in .env (see SETUP_AUTH.md)"
    exec node server.js "$dir"

# Same as above, for `just run` typed in PowerShell
[windows]
[extension: '.ps1']
run folder="":
    #!powershell.exe -File
    $ErrorActionPreference = 'Stop'
    if (-not (Test-Path node_modules)) { npm install }
    $port = if ($env:PORT) { $env:PORT } else { '3000' }
    $env:PORT = $port
    $dir = '{{folder}}'
    if (-not $dir) { $dir = if (Test-Path 'Z:\') { 'Z:\' } else { '{{fallback}}' } }
    Write-Host "File Browser -> http://localhost:$port  (serving $dir)"
    Write-Host "  stop: Ctrl+C | other folder: just run PATH | other port: `$env:PORT=4000; just run"
    node server.js $dir

# Same, with the Rust server (built first if needed): `just rust` or `just rust D:\Comics`
[windows]
[extension: '.ps1']
rust folder="":
    #!powershell.exe -File
    $ErrorActionPreference = 'Stop'
    $exe = 'server-rs\target\release\filebrowser.exe'
    if (-not (Test-Path $exe)) { cargo build --release --manifest-path server-rs\Cargo.toml }
    $port = if ($env:PORT) { $env:PORT } else { '3000' }
    $env:PORT = $port
    $dir = '{{folder}}'
    if (-not $dir) { $dir = if (Test-Path 'Z:\') { 'Z:\' } else { '{{fallback}}' } }
    Write-Host "File Browser (Rust) -> http://localhost:$port  (serving $dir)"
    Write-Host "  stop: Ctrl+C | other folder: just rust PATH | other port: `$env:PORT=4000; just rust"
    & $exe $dir

[unix]
rust folder="":
    #!/usr/bin/env bash
    set -euo pipefail
    exe=server-rs/target/release/filebrowser
    [ -x "$exe" ] || cargo build --release --manifest-path server-rs/Cargo.toml
    dir="{{folder}}"
    [ -n "$dir" ] || { [ -n "$(ls -A /mnt/z 2>/dev/null | head -1)" ] && dir=/mnt/z || dir="{{fallback}}"; }
    echo "File Browser (Rust) -> http://localhost:${PORT:-3000}  (serving $dir)"
    exec "$exe" "$dir"

# Run the test suite
test:
    npm test
