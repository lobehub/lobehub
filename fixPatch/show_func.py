import os
from pathlib import Path

repo = Path(os.environ["USERPROFILE"]) / "Projects" / "Mio" / "lobehub"
sync = repo / "fixPatch" / "sync.py"
lines = sync.read_text(encoding="utf-8").splitlines()

# Mostra dalla riga 140 alla 185 (clean_workflows + contesto)
for i, l in enumerate(lines[138:190], start=139):
    print(f"{i+1:4d}: {l}")
