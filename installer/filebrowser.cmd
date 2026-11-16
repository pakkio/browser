@echo off
rem File Browser launcher: serves the folder given as argument, or the current directory.
rem The first run downloads Node and the media tools (see tools-manifest.json).
setlocal
set "FB=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%FB%fetch-tools.ps1" -Cmd || exit /b 1
call "%LOCALAPPDATA%\FileBrowser\tools\env.cmd"
set "PATH=%FB_PATH%;%PATH%"
if not "%~1"=="" cd /d "%~1" || exit /b 1
if "%PORT%"=="" set "PORT=3000"
echo Serving %CD% on http://localhost:%PORT%  (Ctrl+C to stop)
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:%PORT%"
"%FB_NODE%" "%FB%app\server.js"
