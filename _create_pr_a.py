import subprocess, sys, os, tempfile

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')

pr_body = r"""## Problem

On Windows, `spawn(cmd.exe, ['/c', command], { shell: false })` causes Node.js to re-escape double quotes before passing the command string to `CreateProcess()`. Commands containing quoted paths fail with: `'C:\Program' is not recognized as an internal or external command`.

This bug affects any `runCommand` call on Windows where the command string includes quoted paths or arguments with spaces.

## Fix

Add `windowsVerbatimArguments: true` to both spawn calls in `runner.ts` (synchronous and background). This tells Node.js to pass the command string verbatim to `CreateProcess()` without re-escaping.

Also adds a small `isWindows()` helper to `utils.ts` to avoid repeating `process.platform === 'win32'` inline.

## Files changed

- `packages/local-file-shell/src/shell/runner.ts` — adds `windowsVerbatimArguments: true` on Windows to both spawn paths (+8 lines)
- `packages/local-file-shell/src/shell/utils.ts` — adds `isWindows()` helper (+6 lines)

## Testing

Tested on Windows 11 with commands containing quoted paths. Commands that previously failed with "not recognized" now execute correctly.
"""

# Write body to a temp file
tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, encoding='utf-8')
tmp.write(pr_body)
tmp.close()
print(f'Temp body file: {tmp.name}')

# Run gh pr create
cmd = [
    'gh', 'pr', 'create',
    '--repo', 'lobehub/lobehub',
    '--title', 'fix(local-system): add windowsVerbatimArguments for Windows cmd quoting',
    '--base', 'canary',
    '--head', 'emaxlele:fix/local-system-windows-cmd-quoting',
    '--body-file', tmp.name,
]
print(f'Running: {" ".join(cmd)}')
r = subprocess.run(cmd, capture_output=True, text=True, cwd=repo)
if r.stdout.strip(): print('OUT:', r.stdout)
if r.stderr.strip(): print('ERR:', r.stderr)
print(f'RC: {r.returncode}')

# Cleanup
os.unlink(tmp.name)

if r.returncode != 0:
    sys.exit(1)
print('PR created successfully!')
