# Serve a folder on the default port (3000). With no argument it tries Z:\ (/mnt/z)
# first and falls back to test-files. Override with `just run ~/Books` or PORT=4000 just run
fallback := "test-files"

default: run

# Install deps if missing, print usage, then start the server
run folder="":
    #!/usr/bin/env bash
    set -euo pipefail
    [ -d node_modules ] || npm install
    dir="{{folder}}"
    if [ -z "$dir" ]; then
        if [ -d /mnt/z ] && [ -n "$(ls -A /mnt/z 2>/dev/null | head -1)" ]; then
            dir=/mnt/z
        else
            echo "Z:\\ (/mnt/z) not available, falling back to {{fallback}}"
            dir="{{fallback}}"
        fi
    fi
    echo "File Browser -> http://localhost:${PORT:-3000}  (serving $dir)"
    echo "  stop: Ctrl+C | other folder: just run PATH | other port: PORT=4000 just run"
    echo "  Google login: AUTH=true plus credentials in .env (see SETUP_AUTH.md)"
    exec node server.js "$dir"

# Run the test suite
test:
    npm test
