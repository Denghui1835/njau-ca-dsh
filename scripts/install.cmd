@echo off
REM NJAU CA - install.ps1 launcher.
REM
REM Why this file exists:
REM Windows blocks unsigned .ps1 files by default
REM ("cannot be loaded because running scripts is disabled").
REM This wrapper calls PowerShell with -ExecutionPolicy Bypass,
REM so a fresh machine can just double-click it.
REM
REM Usage:
REM   install.cmd                  install into profile "njau"
REM   install.cmd myprofile        install into profile "myprofile"
REM   install.cmd njau -SkipVerify install without the final verification

setlocal
set "HERE=%~dp0"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=njau"

echo [njau-ca] running install.ps1 in profile "%PROFILE%" ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%install.ps1" -ProfileName "%PROFILE%" %2 %3 %4 %5

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo [njau-ca] install finished OK.) else (echo [njau-ca] install FAILED with code %RC%.)
echo Press any key to close.
pause >nul
exit /b %RC%