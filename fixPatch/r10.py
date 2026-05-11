import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Read the cloud-sandbox version too for comparison
files = [
    'packages/builtin-tool-cloud-sandbox/src/client/Render/EditLocalFile/index.tsx',
    'packages/local-file-shell/src/file/edit.ts',
]

outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\r10_out.txt'
out = open(outfile, 'w', encoding='utf-8', errors='replace')

for git_path in files:
    r = subprocess.run(['git', 'show', f'HEAD:{git_path}'], cwd=repo,
        capture_output=True, text=True, encoding='utf-8', errors='replace')
    out.write(f'\n{"="*60}\n=== {git_path} ===\n{"="*60}\n')
    out.write(r.stdout)

out.close()
sys.stdout.buffer.write(open(outfile, 'rb').read())
