"""Commit + push del fix workflow (target_commitish)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO, git, git_soft, section

section("Commit workflow fix: target_commitish")

branch = git("branch", "--show-current")
print(f"  Branch: {branch}")
if branch != "emaxlele-dev":
    git("checkout", "emaxlele-dev")

git("status", "--short")
git("add", ".github/workflows/emaxlele-build.yml")
git("commit", "-m",
    "fix(emaxlele-build): set target_commitish to pin tags on emaxlele-dev\n\n"
    "Without target_commitish, softprops/action-gh-release creates tags on\n"
    "the repo default branch (canary) instead of the emaxlele-dev commit\n"
    "that triggered the workflow. This caused all emaxlele tags to land on\n"
    "the canary merge commit, meaning builds were compiled WITHOUT our patches.\n\n"
    "Fix: add target_commitish: github.sha to pin the tag (and build) to\n"
    "the exact emaxlele-dev HEAD that was pushed."
)

section("Pull --rebase")
ok, out, err = git_soft("pull", "--rebase", "origin", "emaxlele-dev")
if ok:
    print(f"  OK: {(out or err).splitlines()[-1] if (out or err) else 'up to date'}")
else:
    print(f"  ERROR: {err}")
    sys.exit(1)

section("Push origin emaxlele-dev")
ok2, out2, err2 = git_soft("push", "origin", "emaxlele-dev")
if ok2:
    print(f"  Push OK: {(err2 or out2).splitlines()[-1] if (err2 or out2) else 'ok'}")
else:
    print(f"  PUSH ERROR: {err2}")
    sys.exit(1)

print("\nDone — build workflow triggerato su emaxlele-dev")
