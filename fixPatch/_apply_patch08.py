"""Apply patch_08 (and optionally patch_09) directly and verify."""
import sys, importlib.util
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO

def load_patch(fname):
    fpath = Path(__file__).resolve().parent / 'patches' / fname
    spec = importlib.util.spec_from_file_location(fpath.stem, fpath)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

for patch_file in ['patch_08_onboarding_finished_caller.py',
                   'patch_09_runtime_executors_finished.py',
                   'patch_02_onboarding_next_actions.py']:
    mod = load_patch(patch_file)
    print(f"\nChecking {mod.PATCH_ID}:")
    already = mod.check(REPO)
    if already:
        print("  -> Already applied, skipping")
    else:
        print("  -> Applying...")
        mod.apply(REPO)
        if mod.check(REPO):
            print("  -> Applied and verified OK")
        else:
            print("  -> ERROR: patch applied but check still fails!")
            sys.exit(1)

print("\nDone.")
