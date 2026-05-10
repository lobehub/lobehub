import subprocess, os, sys

repo = os.path.join(os.environ["USERPROFILE"], "Projects", "Mio", "lobehub")

# Verifica grep
r = subprocess.run(
    [r"C:\Python314\python.exe", "fixPatch\\verify_fix.py"],
    cwd=repo, capture_output=True, text=True
)
print("=== VERIFICA ===")
print(r.stdout or "(nessun output)")
if r.stderr:
    print("STDERR:", r.stderr[:500])

# Dry-run sync
print("\n=== DRY RUN sync.py ===")
r2 = subprocess.run(
    [r"C:\Python314\python.exe", "fixPatch\\sync.py", "--dry-run"],
    cwd=repo, capture_output=True, text=True
)
print(r2.stdout[:3000] if r2.stdout else "(nessun output)")
if r2.stderr:
    print("STDERR:", r2.stderr[:500])
