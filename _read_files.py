import subprocess, sys, os

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')

def run(cmd, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or repo)
    if r.stdout.strip(): print(r.stdout)
    if r.stderr.strip(): print('[stderr]', r.stderr, file=sys.stderr)
    return r

# Full content of systemRole.ts
print('=== FULL systemRole.ts ===')
fpath = os.path.join(repo, 'packages/builtin-tool-local-system/src/systemRole.ts')
with open(fpath, 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        print(f'{i:4d}: {line}', end='')

print('\n\n=== FULL systemRole.desktop.ts (first 60 lines) ===')
fpath2 = os.path.join(repo, 'packages/builtin-tool-local-system/src/systemRole.desktop.ts')
with open(fpath2, 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i, line in enumerate(lines[:60], 1):
    print(f'{i:4d}: {line}', end='')

# diff working tree (emaxlele-dev) vs canary for these files
print('\n\n=== diff emaxlele-dev working tree vs canary (systemRole files) ===')
run(['git', 'diff', 'canary', 'HEAD', '--',
     'packages/builtin-tool-local-system/src/systemRole.ts',
     'packages/builtin-tool-local-system/src/systemRole.desktop.ts'])

# Also check parserPlaceholder index.ts to understand current state (for TASK C)
print('\n\n=== parserPlaceholder/index.ts snippet (platform-related) ===')
ph_path = os.path.join(repo, 'src/helpers/parserPlaceholder/index.ts')
if os.path.exists(ph_path):
    with open(ph_path, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.split('\n')
    for i, line in enumerate(lines, 1):
        if any(x in line.lower() for x in ['platform', 'hostname', 'arch', 'computername', 'variable_generator', 'const ', 'export']):
            print(f'  L{i:4d}: {line}')
else:
    print('FILE NOT FOUND:', ph_path)
    # try to find it
    run(['git', 'ls-files', '--full-name', '*parserPlaceholder*'])
