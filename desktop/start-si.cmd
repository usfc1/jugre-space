@echo off
setlocal
set "JUGRE_ELECTRON=%~dp0.cache\physx-runtime\electron.exe"
if not exist "%JUGRE_ELECTRON%" (
  echo The local Electron runtime is missing. See BUILD.md to restore it.
  pause
  exit /b 1
)
start "" "%JUGRE_ELECTRON%" "%~dp0main.cjs"
