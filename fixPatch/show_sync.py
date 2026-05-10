import os, sys, subprocess
from pathlib import Path

repo = Path(os.environ["USERPROFILE"]) / "Projects" / "Mio" / "lobehub"
sync = repo / "fixPatch" / "sync.py"

txt = sync.read_text(encoding="utf-8")
lines = txt.splitlines()

# Mostra le righe intorno a clean_workflows e il main
sections_to_show = ["clean_workflows", "STEP 1b", "EMAXLELE_WORKFLOW", "__name__"]
in_main = False
print(f"=== sync.py — {len(lines)} righe totali ===\n")

for i, l in enumerate(lines):
    if 'if __name__' in l:
        in_main = True
    if in_main or any(k in l for k in ["clean_workflows", "STEP 1b", "EMAXLELE_WORKFLOW"]):
        print(f"{i+1:4d}: {l}")
