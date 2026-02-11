@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" (
  for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
)
if "%NODE_EXE%"=="" (
  echo WeftEnd menu can open, but no runtime is available for actions.
  echo Install Node.js locally or use the portable bundle with runtime\node\node.exe.
)

set "PS_EXE=%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"

if not exist "%~dp0tools\windows\shell\weftend_menu.ps1" (
  echo Missing tools\windows\shell\weftend_menu.ps1 in this bundle.
  exit /b 40
)

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\windows\shell\weftend_menu.ps1"
exit /b %ERRORLEVEL%
