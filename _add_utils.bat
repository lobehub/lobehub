@echo off
cd /d %USERPROFILE%\Projects\Mio\lobehub
git add _push_emaxlele_dev.bat _fix_emaxlele_dev.bat _commit_push.bat _add_utils.bat
git commit -m "chore: add emaxlele-dev utility scripts to branch"
git push origin emaxlele-dev
git log --oneline -4
