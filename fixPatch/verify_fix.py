import os
from pathlib import Path
f = Path(os.environ["USERPROFILE"]) / "Projects" / "Mio" / "lobehub" / "fixPatch" / "sync.py"
txt = f.read_text(encoding="utf-8")
lines = txt.splitlines()
hits = [(i+1, l) for i, l in enumerate(lines)
        if any(k in l for k in ["clean_workflows", "EMAXLELE_WORKFLOW", "STEP 1b", "emaxlele-build.yml"])]
for n, l in hits:
    print(f"  {n:4d}: {l}")
print(f"\nTotale occorrenze: {len(hits)}")
