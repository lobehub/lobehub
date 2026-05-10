"""
Commit patch_08/09 + traccia fixPatch/ (rimuovi da .gitignore) + push.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO, git, git_soft, section

section("Remove fixPatch/ from .gitignore")
gi_path = REPO / ".gitignore"
if gi_path.exists():
    lines = gi_path.read_text(encoding="utf-8").splitlines(keepends=True)
    to_remove = {"fixPatch/", "fixPatch", "/fixPatch/", "/fixPatch"}
    new_lines = [l for l in lines if l.strip() not in to_remove]
    if len(new_lines) != len(lines):
        gi_path.write_text("".join(new_lines), encoding="utf-8")
        print("  Removed fixPatch entries from .gitignore")
    else:
        print("  fixPatch not found in .gitignore")
else:
    print("  .gitignore not found")

section("Stage changes")
git("add",
    "src/server/modules/AgentRuntime/RuntimeExecutors.ts",
    "fixPatch/sync.py",
    "fixPatch/patches/patch_02_onboarding_next_actions.py",
    "fixPatch/patches/patch_08_onboarding_finished_caller.py",
    ".gitignore"
)
git("add", "fixPatch/")
git("status", "--short")

section("Check diff --cached")
ok, staged, _ = git_soft("diff", "--cached", "--stat")
print(f"  Staged: {staged[:400] if staged else '(nothing)'}")
if not staged:
    print("  Nothing staged — nothing to commit")
    sys.exit(0)

section("Commit")
msg = (
    "fix(onboarding): propagate finished field to onboardingContext\n\n"
    "patch_08: pass onboardingState.finished to onboardingContext in\n"
    "RuntimeExecutors.ts so MessagesEngine injectors correctly gate on\n"
    "!finished and stop injecting <next_actions> after onboarding.\n\n"
    "Also: track fixPatch/ directory (remove from .gitignore) for\n"
    "reproducibility. Related: PR #14579 (upstream), patch_02"
)
git("commit", "--allow-empty", "-m", msg)

section("Pull rebase")
ok2, out2, err2 = git_soft("pull", "--rebase", "origin", "emaxlele-dev")
if not ok2:
    print(f"  [WARN] rebase issue: {err2}")

section("Push")
ok3, out3, err3 = git_soft("push", "origin", "emaxlele-dev")
if ok3:
    print(f"  Push OK: {(err3 or out3).splitlines()[-1] if (err3 or out3) else 'ok'}")
else:
    print(f"  PUSH ERROR: {err3}")
    sys.exit(1)

print("\nDone.")
