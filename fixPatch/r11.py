import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Check what createPatch actually outputs vs createTwoFilesPatch
r = subprocess.run(
    ['git', 'show', 'HEAD:packages/local-file-shell/src/file/__tests__/file.test.ts'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\r11_out.txt'
with open(outfile, 'w', encoding='utf-8', errors='replace') as f:
    f.write(r.stdout)
sys.stdout.buffer.write(r.stdout[:6000].encode('ascii', errors='replace'))
