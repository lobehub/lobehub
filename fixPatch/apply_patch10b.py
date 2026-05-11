import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'
target = os.path.join(repo, 'packages', 'local-file-shell', 'src', 'file', 'edit.ts')

with open(target, encoding='utf-8') as f:
    content = f.read()

# Fix the remaining reference to old variable name
OLD = "    const patchLines = patch.split('\\n');"
NEW = "    const patchLines = rawPatch.split('\\n');"

if OLD in content:
    fixed = content.replace(OLD, NEW)
    with open(target, 'w', encoding='utf-8') as f:
        f.write(fixed)
    sys.stdout.buffer.write(b"SUCCESS: patchLines variable renamed to rawPatch\n")
else:
    sys.stdout.buffer.write(b"ERROR: OLD string not found\n")
    # Show context
    for i, line in enumerate(content.split('\n')):
        if 'patchLines' in line or 'patch.split' in line:
            sys.stdout.buffer.write(f"  line {i+1}: {line}\n".encode('ascii', errors='replace'))

# Show final file content around the edit
r = subprocess.run(['git', 'diff', 'packages/local-file-shell/src/file/edit.ts'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace')
sys.stdout.buffer.write(r.stdout.encode('ascii', errors='replace'))
