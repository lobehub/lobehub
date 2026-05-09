@echo off
cd /d %USERPROFILE%\Projects\Mio\lobehub

REM Aggiunge upstream se mancante
git remote get-url upstream >nul 2>&1 || git remote add upstream https://github.com/lobehub/lobehub.git

REM Fetch origin per avere il branch remoto
git fetch origin emaxlele-dev

REM Checkout branch locale emaxlele-dev (crea da origin se non esiste)
git checkout emaxlele-dev 2>nul || git checkout -b emaxlele-dev origin/emaxlele-dev

REM Stage i nuovi file
git add .github\workflows\emaxlele-build.yml
git add sync-and-build.py

REM Commit
git commit -m "feat: add emaxlele-dev auto-build workflow and local sync script"

REM Push
git push origin emaxlele-dev

echo.
echo === DONE ===
git log --oneline -3
