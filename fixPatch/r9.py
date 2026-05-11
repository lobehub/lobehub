import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

files = [
    'packages/builtin-tool-local-system/src/client/Render/EditLocalFile/index.tsx',
    'packages/local-file-shell/src/file/edit.ts',
    'packages/electron-client-ipc/src/types/localSystem.ts',
]

outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\r9_out.txt'
out = open(outfile, 'w', encoding='utf-8', errors='replace')

for git_path in files:
    r = subprocess.run(['git', 'show', f'HEAD:{git_path}'], cwd=repo,
        capture_output=True, text=True, encoding='utf-8', errors='replace')
    out.write(f'\n{"="*60}\n=== {git_path} ===\n{"="*60}\n')
    out.write(r.stdout)
    if r.stderr:
        out.write(f'\nSTDERR: {r.stderr}\n')

out.close()
sys.stdout.buffer.write(open(outfile, 'rb').read()[:10000])
