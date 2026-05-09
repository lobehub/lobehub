@echo off
cd /d %USERPROFILE%\Projects\Mio\lobehub
git commit -m "feat: add emaxlele-dev auto-build workflow and local sync script"
git push origin emaxlele-dev
git log --oneline -4
