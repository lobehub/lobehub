import subprocess, sys, os

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')

def run(cmd, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or repo)
    if r.stdout: print(r.stdout)
    if r.stderr: print('[stderr]', r.stderr, file=sys.stderr)
    return r

print('=== git status ===')
run(['git', 'status', '--short', '--branch'])

print('\n=== branch list (local) ===')
run(['git', 'branch', '-v'])

print('\n=== diff systemRole.ts (stat) ===')
run(['git', 'diff', 'HEAD', '--stat', '--', 'packages/builtin-tool-local-system/src/systemRole.ts', 'packages/builtin-tool-local-system/src/systemRole.desktop.ts'])

print('\n=== remote branches fix/ ===')
run(['git', 'branch', '-r', '--list', 'origin/fix/*'])
