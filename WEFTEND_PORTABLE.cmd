@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node\node.exe"
if exist "%NODE_EXE%" goto run_cli

for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
if not "%NODE_EXE%"=="" goto run_cli

echo WeftEnd portable runtime not found.
echo Install Node.js locally or use the portable bundle with runtime\node\node.exe.
exit /b 40

:run_cli
if not exist "%~dp0dist\src\cli\main.js" (
  echo Missing dist\src\cli\main.js in this bundle.
  exit /b 40
)
"%NODE_EXE%" "%~dp0dist\src\cli\main.js" %*
exit /b %ERRORLEVEL%
