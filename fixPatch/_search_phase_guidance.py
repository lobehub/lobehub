"""Cerca phaseGuidance in tutti i file TypeScript del repo."""
import re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO

pattern = re.compile(r'phaseGuidance', re.IGNORECASE)
results = []
for f in REPO.rglob('*.ts'):
    try:
        text = f.read_text(encoding='utf-8', errors='ignore')
        if pattern.search(text):
            lines = text.splitlines()
            for i, line in enumerate(lines):
                if pattern.search(line):
                    ctx_start = max(0, i-3)
                    ctx_end   = min(len(lines), i+5)
                    print(f"\n=== {f.relative_to(REPO)} (line {i+1}) ===")
                    for j in range(ctx_start, ctx_end):
                        marker = '>>>' if j == i else '   '
                        print(f"  {marker} {j+1:4d}: {lines[j]}")
            results.append(str(f.relative_to(REPO)))
    except Exception:
        pass
print(f'\nTotal files with phaseGuidance: {len(results)}')
for r in sorted(results):
    print(' -', r)
