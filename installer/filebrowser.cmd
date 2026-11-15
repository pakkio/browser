@echo off
rem File Browser launcher: serves the folder given as argument, or the current directory.
setlocal
set "FB=%~dp0"
set "PATH=%FB%tools\ffmpeg;%FB%tools\poppler;%FB%tools\pandoc;%FB%tools\unrar;%FB%tools\zip;%FB%tools\graphicsmagick;%FB%tools\ghostscript;%PATH%"
if not "%~1"=="" cd /d "%~1" || exit /b 1
if "%PORT%"=="" set "PORT=3000"
echo Serving %CD% on http://localhost:%PORT%  (Ctrl+C to stop)
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:%PORT%"
"%FB%runtime\node.exe" "%FB%app\server.js"
