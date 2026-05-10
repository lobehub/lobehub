import subprocess, os, sys
repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')
r = subprocess.run(
    [r'C:\Python314\python.exe', r'fixPatch\sync.py'],
    cwd=repo, capture_output=True, text=True, timeout=600
)
print('STDOUT:', r.stdout[-4000:] if len(r.stdout) > 4000 else r.stdout)
print('STDERR:', r.stderr[-1000:] if len(r.stderr) > 1000 else r.stderr)
print('RC:', r.returncode)
