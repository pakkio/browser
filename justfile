# Serve a folder on the default port (3000). With no argument it tries Z:\ (/mnt/z)
# first and falls back to test-files. Override with `just run ~/Books` or PORT=4000 just run
fallback := "test-files"

default: run

# Install deps if missing, print usage, then start the server
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
        # Z:\ is a Windows drive; in WSL it only shows up once mounted (drvfs, needs sudo)
        if [ -z "$(ls -A /mnt/z 2>/dev/null | head -1)" ]; then
            if [ "$(powershell.exe -NoProfile -Command 'Test-Path Z:\' 2>/dev/null | tr -d '\r')" = "True" ]; then
                echo "Z:\\ exists in Windows but /mnt/z is empty; mounting (sudo)..."
                sudo mkdir -p /mnt/z && sudo mount -t drvfs Z: /mnt/z || echo "Mount failed"
            else
                echo "Z:\\ not found in Windows"
            fi
        fi
        if [ -n "$(ls -A /mnt/z 2>/dev/null | head -1)" ]; then
            dir=/mnt/z
        else
            echo "Z:\\ (/mnt/z) not available, falling back to {{fallback}}"
            dir="{{fallback}}"
        fi
    fi
    echo "File Browser -> http://localhost:$port  (serving $dir)"
    echo "  stop: Ctrl+C | other folder: just run PATH | other port: PORT=4000 just run"
    echo "  Google login: AUTH=true plus credentials in .env (see SETUP_AUTH.md)"
    exec node server.js "$dir"

# Run the test suite
test:
    npm test
