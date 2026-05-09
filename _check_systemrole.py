import subprocess, sys, os

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')

def run(cmd, cwd=None, check=False):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or repo)
    if r.stdout.strip(): print(r.stdout)
    if r.stderr.strip(): print('[stderr]', r.stderr, file=sys.stderr)
    return r

# Check current content of systemRole files (on current branch = emaxlele-dev)
for fname in [
    'packages/builtin-tool-local-system/src/systemRole.ts',
    'packages/builtin-tool-local-system/src/systemRole.desktop.ts',
]:
    print(f'\n{"="*60}')
    print(f'FILE: {fname}')
    print('='*60)
    fpath = os.path.join(repo, fname)
    if os.path.exists(fpath):
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        # Show only relevant lines (search for hardcoded paths or placeholder patterns)
        lines = content.split('\n')
        for i, line in enumerate(lines, 1):
            if any(x in line for x in [
                'Win32', 'USERPROFILE', 'home-path', 'hostname', 'emanuele', 'PocketBase',
                'Known Locations', 'Desktop', 'Documents', 'Downloads', 'device name',
                'os=', 'platform', 'currentWorkingDirectory'
            ]):
                print(f'  L{i:4d}: {line}')
    else:
        print(f'  FILE NOT FOUND')

# Also check the fix branch content
print('\n\n=== diff fix/local-system-systemrole-placeholders vs canary (full) ===')
run(['git', 'diff', 'canary', 'fix/local-system-systemrole-placeholders', '--',
     'packages/builtin-tool-local-system/src/systemRole.ts',
     'packages/builtin-tool-local-system/src/systemRole.desktop.ts'])

# Check if fix branch has the right commits
print('\n=== full log fix/local-system-systemrole-placeholders ===')
run(['git', 'log', '--oneline', 'canary..fix/local-system-systemrole-placeholders'])
