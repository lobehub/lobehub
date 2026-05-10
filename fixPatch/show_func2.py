import os, subprocess, sys
from pathlib import Path

repo = Path(os.environ["USERPROFILE"]) / "Projects" / "Mio" / "lobehub"
sync = repo / "fixPatch" / "sync.py"
lines = sync.read_text(encoding="utf-8").splitlines()

# stampa righe 139-188
for i in range(138, min(188, len(lines))):
    try:
        print(f"{i+1:4d}: {lines[i]}")
    except Exception:
        print(f"{i+1:4d}: <encode error>")
