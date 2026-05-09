"""Debug: esegue sync.py step per step e cattura errori."""
import subprocess, sys, os
from pathlib import Path

REPO = Path(r"C:\Users\emanuele.gallo\Projects\Mio\lobehub")
GIT  = r"C:\Program Files\Git\cmd\git.exe"
PYTHON = r"C:\Python314\python.exe"

def git(*args):
    r = subprocess.run([GIT, "-C", str(REPO)] + list(args),
                       capture_output=True, text=True)
    print(f"  git {' '.join(args)}")
    if r.stdout: print(f"  OUT: {r.stdout.strip()[:300]}")
    if r.stderr: print(f"  ERR: {r.stderr.strip()[:300]}")
    print(f"  exit: {r.returncode}")
    return r.returncode == 0, r.stdout.strip()

print("=== DEBUG SYNC ===")

# Step 1: branch corrente
ok, out = git("branch", "--show-current")
print(f"Current branch: {out}")

# Step 2: fetch upstream
print("\n--- fetch upstream ---")
ok, _ = git("fetch", "upstream")

# Step 3: stato prima del merge
ok, out = git("status", "--short")
print(f"Status: '{out}'")

# Step 4: merge canary
print("\n--- merge upstream/canary ---")
ok, out = git("merge", "--no-edit", "--no-ff", "upstream/canary")
if not ok:
    print("MERGE FAILED — verifica conflitti")
    sys.exit(1)

# Step 5: carica e testa patch
print("\n--- test patch check ---")
sys.path.insert(0, str(REPO / "fixPatch"))
patches_dir = REPO / "fixPatch" / "patches"
import importlib.util

for f in sorted(patches_dir.glob("patch_*.py")):
    spec = importlib.util.spec_from_file_location(f.stem, f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    already = mod.check(REPO)
    print(f"  [{mod.PATCH_ID}] check={'OK (skip)' if already else 'MISSING (apply)'}")
    if not already:
        print(f"    applying...")
        mod.apply(REPO)
        after = mod.check(REPO)
        print(f"    after check: {'OK' if after else 'FAILED'}")

# Step 6: git status dopo patch
ok, out = git("status", "--short")
print(f"\nStatus dopo patch: '{out}'")

# Step 7: commit se necessario
if out.strip():
    git("add", "-A")
    git("commit", "-m", "chore(emaxlele-dev): re-apply patches after canary merge")

# Step 8: push
print("\n--- push ---")
ok, out = git("push", "origin", "emaxlele-dev")
print(f"Push result: ok={ok}")
print("\n=== DONE ===")
