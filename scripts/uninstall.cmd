@echo off
REM NJAU CA - uninstall.ps1 launcher.
REM
REM This does NOT delete your club data. It only unhooks the plugins.
REM See uninstall.ps1 for details.
REM
REM Usage:
REM   uninstall.cmd            remove plugins from profile "njau"
REM   uninstall.cmd myprofile  remove plugins from profile "myprofile"

setlocal
set "HERE=%~dp0"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=njau"

echo [njau-ca] running uninstall.ps1 for profile "%PROFILE%" ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%uninstall.ps1" -ProfileName "%PROFILE%"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo [njau-ca] uninstall finished.) else (echo [njau-ca] uninstall FAILED with code %RC%.)
echo Press any key to close.
pause >nul
exit /b %RC%