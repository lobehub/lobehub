import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Look at @lobehub/ui PatchDiff source to understand expected format
# First find the ui package
ui_path = os.path.join(repo, 'node_modules', '@lobehub', 'ui')
if os.path.exists(ui_path):
    os.write(1, f"@lobehub/ui found at {ui_path}\n".encode())
    # Look for PatchDiff
    for root, dirs, files in os.walk(ui_path):
        dirs[:] = [d for d in dirs if d not in ['__tests__', '.git']]
        for fname in files:
            if 'patch' in fname.lower() or 'diff' in fname.lower():
                fpath = os.path.join(root, fname)
                rel = os.path.relpath(fpath, ui_path)
                os.write(1, f"  {rel}\n".encode())
else:
    os.write(1, b"@lobehub/ui NOT found\n")

# Also search in src for lobe-local-system editFile tool output format
# The tool description says it does "exact string replacement"
# The error is in the UI rendering, not in the actual edit

# Check if the tool result message format is shown somewhere
result = subprocess.run(
    ['git', 'grep', '-rn', 'editFile\|lobe-local-system\|PatchDiff\|patch.*string', '--', 'src/'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
os.write(1, b"\n=== editFile references in src ===\n")
for line in result.stdout.split('\n'):
    if any(x in line for x in ['editFile', 'localSystem', 'local-system', 'PatchDiff']):
        os.write(1, (line + '\n').encode('ascii', errors='replace'))
