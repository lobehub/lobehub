import subprocess, sys, os

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')

def run(cmd, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or repo)
    if r.stdout.strip(): print(r.stdout)
    if r.stderr.strip(): print('[stderr]', r.stderr, file=sys.stderr)
    return r

print('=== remotes ===')
run(['git', 'remote', '-v'])

print('\n=== remote branches ALL ===')
run(['git', 'branch', '-r'])

print('\n=== log fix/local-system-windows-cmd-quoting (last 3) ===')
run(['git', 'log', '--oneline', '-3', 'fix/local-system-windows-cmd-quoting'])

print('\n=== log fix/local-system-systemrole-placeholders (last 3) ===')
run(['git', 'log', '--oneline', '-3', 'fix/local-system-systemrole-placeholders'])

print('\n=== diff fix/local-system-systemrole-placeholders vs canary (stat) ===')
run(['git', 'diff', 'canary...fix/local-system-systemrole-placeholders', '--stat'])
