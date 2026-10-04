@echo off
REM scripts/dev-db-start.cmd — start embedded postgres as a detached daemon.
REM Idempotent: reuses an existing cluster, or inits a fresh one if needed.
REM Exits immediately after pg_ctl start (postgres keeps running independently).

setlocal
set "ROOT=%~dp0.."
set "DATA=%ROOT%\.embedded-pg"
set "BIN=%ROOT%\node_modules\@embedded-postgres\windows-x64\native\bin"
set "LOG=%ROOT%\.embedded-pg.log"

if not exist "%BIN%\pg_ctl.exe" (
  echo [dev-db] pg_ctl.exe not found at %BIN%
  exit /b 1
)

REM Init cluster on first run only
if not exist "%DATA%\PG_VERSION" (
  echo [dev-db] first run: initialising cluster...
  mkdir "%DATA%" 2>nul
  "%BIN%\initdb.exe" -D "%DATA%" -U avomessage --auth=trust --encoding=UTF8 > "%LOG%.initdb" 2>&1
  if errorlevel 1 (
    echo [dev-db] initdb FAILED, see %LOG%.initdb
    exit /b 1
  )
  REM Create the dev database (initdb only makes "avomessage")
  set PGPASSWORD=avomessage_dev_pw
  "%BIN%\createdb.exe" -h localhost -p 5432 -U avomessage avomessage_dev 2>nul
)

echo [dev-db] starting postgres daemon...
"%BIN%\pg_ctl.exe" -D "%DATA%" -l "%LOG%" -w start
if errorlevel 1 (
  echo [dev-db] already running or start FAILED, see %LOG%
  exit /b 1
)
echo [dev-db] postgres up on port 5432 (log: %LOG%)
endlocal