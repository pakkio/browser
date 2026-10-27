# Serve a folder on the default port (3000); override with `just run ~/Books` or PORT=4000 just run
dir := "test-files"

default: run

# Install deps if missing, print usage, then start the server
run folder=dir:
    @[ -d node_modules ] || npm install
    @echo "File Browser -> http://localhost:${PORT:-3000}  (serving {{folder}})"
    @echo "  stop: Ctrl+C | other folder: just run PATH | other port: PORT=4000 just run"
    @echo "  Google login: AUTH=true plus credentials in .env (see SETUP_AUTH.md)"
    node server.js {{folder}}

# Run the test suite
test:
    npm test
