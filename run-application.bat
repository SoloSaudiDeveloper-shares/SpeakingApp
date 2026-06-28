@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%web"
set "PACKAGED_EXE=%ROOT_DIR%dist\win-unpacked\Speaking Lab.exe"
set "APP_URL=http://localhost:3000"

echo.
echo Starting Speaking Lab...
echo Root: %ROOT_DIR%

if exist "%PACKAGED_EXE%" (
  echo Launching packaged application...
  start "" "%PACKAGED_EXE%"
  exit /b 0
)

echo Packaged application was not found. Falling back to development server.

if not exist "%WEB_DIR%\package.json" (
  echo.
  echo ERROR: Could not find web\package.json.
  echo Expected app folder: %WEB_DIR%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: npm was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo App is already running on %APP_URL%
  start "" "%APP_URL%"
  exit /b 0
)

echo Launching development server...
start "Speaking Lab Server" cmd /k "cd /d ""%WEB_DIR%"" && npm run dev"

echo Waiting for the app to become available...
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } } catch { }; exit 1"
  if not errorlevel 1 (
    echo App is ready: %APP_URL%
    start "" "%APP_URL%"
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)

echo.
echo The server was started, but the app did not respond within 30 seconds.
echo Check the "Speaking Lab Server" window for details.
pause
exit /b 1
