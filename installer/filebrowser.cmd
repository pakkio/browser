@echo off
rem File Browser: opens the folder given as argument (or the current directory) in its own window.
rem   filebrowser [FOLDER]           the window (closing it stops File Browser)
rem   filebrowser --serve [FOLDER]   only the server, in this terminal: http://localhost:3000
rem   filebrowser setup-mega         also download Node.js, which only mega.nz browsing needs
setlocal
set "FB=%~dp0"
if /i "%~1"=="setup-mega" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%FB%fetch-tools.ps1" -Cmd -Features mega || exit /b 1
    echo mega.nz support is ready. Restart File Browser to use it.
    exit /b 0
)
if /i "%~1"=="--serve" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%FB%fetch-tools.ps1" -Cmd || exit /b 1
    call "%LOCALAPPDATA%\FileBrowser\tools\env.cmd"
    if not "%~2"=="" cd /d "%~2" || exit /b 1
    goto serve
)
if "%~1"=="" (
    start "" "%FB%app\filebrowser-app.exe" "%CD%."
) else (
    start "" "%FB%app\filebrowser-app.exe" "%~f1."
)
exit /b 0

:serve
set "PATH=%FB_PATH%;%PATH%"
if "%PORT%"=="" set "PORT=3000"
echo Serving %CD% on http://localhost:%PORT%  (Ctrl+C to stop)
"%FB%app\filebrowser.exe"
