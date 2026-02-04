@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%shell\uninstall_weftend_context_menu.ps1"
if errorlevel 1 exit /b %ERRORLEVEL%
echo UNINSTALL_OK
exit /b 0
