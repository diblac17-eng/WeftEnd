@echo off
setlocal
set "psExe=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%psExe%" set "psExe=powershell.exe"
"%psExe%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0weftend_shell_doctor.ps1" %*
endlocal
