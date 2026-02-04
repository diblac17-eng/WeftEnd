@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%shell\install_weftend_context_menu.ps1"
if errorlevel 1 exit /b %ERRORLEVEL%
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%shell\weftend_shell_doctor.ps1"
if errorlevel 1 exit /b %ERRORLEVEL%
echo INSTALL_OK
exit /b 0
