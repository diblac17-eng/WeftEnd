@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0weftend_shell_doctor.ps1" %*
endlocal
