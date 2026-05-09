@echo off
cd /d %USERPROFILE%\Projects\Mio\lobehub
git checkout emaxlele-dev
type .github\workflows\release.yml | more /p /c /e
