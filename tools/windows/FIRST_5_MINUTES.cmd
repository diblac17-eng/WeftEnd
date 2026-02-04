@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%FIRST_5_MINUTES.ps1"
if errorlevel 1 exit /b %ERRORLEVEL%
echo FIRST_5_MINUTES_OK
exit /b 0
