"""Diagnostica stato del repo emaxlele-dev."""
import sys, json, io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO, git, git_soft

# Fix stdout encoding for Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 1. Remote
print("=== REMOTES ===")
print(git("remote", "-v"))

# 2. Versione package.json locale
pkg = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
print(f"\n=== package.json version ===\n{pkg['version']}")

# 3. Versione upstream/canary (da package.json nel branch remoto)
ok, out, err = git_soft("show", "upstream/canary:package.json")
if ok:
    upstream_pkg = json.loads(out)
    print(f"\n=== upstream/canary package.json version ===\n{upstream_pkg['version']}")
else:
    print(f"\n=== upstream/canary ERRORE ===\n{err}")

# 4. HEAD locale vs upstream/canary HEAD
out_head = git("rev-parse", "HEAD")
ok2, out_can, _ = git_soft("rev-parse", "upstream/canary")
print(f"\n=== HEAD ===")
print(f"  LOCAL : {out_head[:12]}")
print(f"  CANARY: {out_can[:12] if ok2 else 'N/A'}")
print(f"  SAME  : {out_head == out_can}")

# 5. Ultimi 5 commit emaxlele-dev
print(f"\n=== Last 5 commits emaxlele-dev ===")
print(git("log", "--oneline", "-5", "emaxlele-dev"))

# 6. Ultimi 5 commit upstream/canary
print(f"\n=== Last 5 commits upstream/canary ===")
ok3, out3, _ = git_soft("log", "--oneline", "-5", "upstream/canary")
print(out3 if ok3 else "N/A")
