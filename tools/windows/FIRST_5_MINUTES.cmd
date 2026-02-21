@echo off
setlocal
set SCRIPT_DIR=%~dp0
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%FIRST_5_MINUTES.ps1"
if errorlevel 1 exit /b %ERRORLEVEL%
echo FIRST_5_MINUTES_OK
exit /b 0
