import os, sys, subprocess

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Search for PatchDiff/getSingularPatch/usePatch in source
result = subprocess.run(
    ['git', 'grep', '-rn', '-e', 'PatchDiff', '-e', 'getSingularPatch', '-e', 'usePatch', '--', 'src/'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8'
)
print("=== git grep results ===")
print(result.stdout[:5000] if result.stdout else "NESSUN RISULTATO")
print("STDERR:", result.stderr[:300])

# Also search in package.json for @lobehub/ui version
pkg = os.path.join(repo, 'package.json')
with open(pkg, encoding='utf-8') as f:
    content = f.read()
# find lobehub/ui
import re
m = re.search(r'"@lobehub/ui"\s*:\s*"([^"]+)"', content)
print(f"\n@lobehub/ui version: {m.group(1) if m else 'NOT FOUND'}")
