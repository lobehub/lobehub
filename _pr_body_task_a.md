## Problem

On Windows, `spawn(cmd.exe, ['/c', command], { shell: false })` causes Node.js to re-escape double quotes before passing the command string to `CreateProcess()`. This means commands containing quoted paths — such as:

```
"C:\Program Files\Git\cmd\git.exe" status
```

fail with: `'C:\Program' is not recognized as an internal or external command`.

This bug affects any `runCommand` call on Windows where the command string includes quoted paths or arguments with spaces.

## Fix

Add `windowsVerbatimArguments: true` to both spawn calls in `runner.ts` (synchronous and background). This tells Node.js to pass the command string verbatim to `CreateProcess()` without re-escaping.

Also adds a small `isWindows()` helper to `utils.ts` to avoid repeating `process.platform === 'win32'` inline.

## Files changed

- `packages/local-file-shell/src/shell/runner.ts` — adds `windowsVerbatimArguments: true` on Windows to both spawn paths (+8 lines)
- `packages/local-file-shell/src/shell/utils.ts` — adds `isWindows()` helper (+6 lines)

## Testing

Tested on Windows 11 with commands containing quoted paths (e.g. Python scripts, git operations via quoted paths). Commands that previously failed with "not recognized" now execute correctly.
