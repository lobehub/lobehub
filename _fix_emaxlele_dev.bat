@echo off
cd /d %USERPROFILE%\Projects\Mio\lobehub

REM Salva SHA del commit appena fatto
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set COMMIT_SHA=%%i
echo Commit da portare: %COMMIT_SHA%

REM Torna al branch di partenza (per non lasciarlo sporco)
git checkout fix/local-system-systemrole-placeholders
git revert HEAD --no-edit
echo Revert fatto sul branch originale

REM Crea branch emaxlele-dev da origin/emaxlele-dev
git fetch origin
git checkout -b emaxlele-dev --track origin/emaxlele-dev
echo Branch emaxlele-dev creato e tracciato

REM Porta i 2 file direttamente (cherry-pick non serve, i file sono gia scritti)
git add .github\workflows\emaxlele-build.yml
git add sync-and-build.py
git commit -m "feat: add emaxlele-dev auto-build workflow and local sync script"

REM Push
git push origin emaxlele-dev
echo.
echo === DONE ===
git log --oneline -3
