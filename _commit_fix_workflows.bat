@echo off
cd /d %USERPROFILE%\Projects\Mio\lobehub
git add .github\workflows\emaxlele-build.yml
git add .github\workflows\test.yml
git add .github\workflows\e2e.yml
git commit -m "fix: emaxlele-dev always build + silence test/e2e on personal branch"
git push origin emaxlele-dev
git log --oneline -3
