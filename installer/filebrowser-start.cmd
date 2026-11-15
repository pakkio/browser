@echo off
rem Start menu entry: ask for the folder to serve (default Z:\ when present).
setlocal
set "DEF=%USERPROFILE%"
if exist Z:\ set "DEF=Z:\"
set "DIR="
set /p "DIR=Folder to serve [%DEF%]: "
if "%DIR%"=="" set "DIR=%DEF%"
call "%~dp0filebrowser.cmd" "%DIR%"
pause
