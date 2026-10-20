@echo off
REM NJAU CA - doctor.ps1 launcher.
REM
REM Why this file exists:
REM Windows blocks unsigned .ps1 files by default.
REM This wrapper calls PowerShell with -ExecutionPolicy Bypass.
REM
REM Usage:
REM   doctor.cmd            check profile "njau"
REM   doctor.cmd myprofile  check profile "myprofile"

setlocal
set "HERE=%~dp0"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=njau"

echo [njau-ca] running doctor.ps1 for profile "%PROFILE%" ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%doctor.ps1" -ProfileName "%PROFILE%"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo [njau-ca] doctor: all checks passed.) else (echo [njau-ca] doctor: something needs attention - read the FAIL lines above.)
echo Press any key to close.
pause >nul
exit /b %RC%