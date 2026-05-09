import subprocess, sys, os

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')

def run(cmd, cwd=None, check=False):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or repo)
    print(f'CMD: {" ".join(cmd)}')
    if r.stdout.strip(): print('OUT:', r.stdout)
    if r.stderr.strip(): print('ERR:', r.stderr)
    print(f'RC: {r.returncode}\n')
    return r

# Step 1: Push fix/local-system-windows-cmd-quoting to origin
print('=== STEP 1: Push branch to origin ===')
r = run(['git', 'push', 'origin', 'fix/local-system-windows-cmd-quoting'])
if r.returncode != 0:
    print('Push failed! Abort.')
    sys.exit(1)

print('Push OK')
