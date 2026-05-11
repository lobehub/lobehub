import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Read current edit.ts
r = subprocess.run(
    ['git', 'show', 'HEAD:packages/local-file-shell/src/file/edit.ts'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
original = r.stdout

# The fix: replace the diffText construction to produce clean unified diff
# that PatchDiff can consume without crashing.
#
# createPatch() from 'diff' produces:
#   Index: filePath\n
#   ===...===\n
#   --- filePath\t(header1)\n
#   +++ filePath\t(header2)\n
#   @@ ... @@\n
#   ...
#
# Then we prepend:
#   diff --git aFilePath bFilePath\n
#
# This creates TWO recognizable diff-block headers:
#   1. diff --git aFilePath bFilePath   <- getSingularPatch header #1
#   2. Index: filePath + === ...        <- getSingularPatch sees multiple
#
# Fix: strip the "Index:" and "===" lines from createPatch output, then 
# prepend "diff --git a/filePath b/filePath" so PatchDiff gets exactly ONE
# clean unified diff block.
#
# The key insight from the fixture:
#   "--- a/workspace/...tsx\n+++ b/workspace/...tsx\n@@ -1,3 +1,7 @@\n..."
# The fixture uses "--- a/" prefix (absolute path without "a/" prefix from createPatch).

OLD = '''    const patch = createPatch(filePath, content, newContent, '', '');
    const diffText = `diff --git a${filePath} b${filePath}\\n${patch}`;'''

NEW = '''    const rawPatch = createPatch(filePath, content, newContent, '', '');
    // createPatch() emits an "Index: …\\n===…\\n" preamble that makes
    // PatchDiff's getSingularPatch see multiple diff blocks and crash with
    // "Provided patch must include only 1 patch, with 1 diff".
    // Strip the preamble lines (everything before the first "--- ") so the
    // renderer receives a single clean unified-diff block.
    const unifiedLines = rawPatch.split('\\n');
    const firstMinusIdx = unifiedLines.findIndex((l) => l.startsWith('--- '));
    const cleanPatch = firstMinusIdx > 0 ? unifiedLines.slice(firstMinusIdx).join('\\n') : rawPatch;
    const diffText = `diff --git a/${filePath} b/${filePath}\\n${cleanPatch}`;'''

if OLD in original:
    fixed = original.replace(OLD, NEW)
    
    # Write to actual file
    target = os.path.join(repo, 'packages', 'local-file-shell', 'src', 'file', 'edit.ts')
    with open(target, 'w', encoding='utf-8') as f:
        f.write(fixed)
    sys.stdout.buffer.write(b"SUCCESS: edit.ts patched\n")
    
    # Show the diff
    r2 = subprocess.run(['git', 'diff', 'packages/local-file-shell/src/file/edit.ts'],
        cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace')
    sys.stdout.buffer.write(r2.stdout.encode('ascii', errors='replace'))
else:
    sys.stdout.buffer.write(b"ERROR: OLD string not found in edit.ts\n")
    # Show context around the relevant line
    for i, line in enumerate(original.split('\n')):
        if 'diffText' in line or 'createPatch' in line or 'diff --git' in line:
            sys.stdout.buffer.write(f"  line {i+1}: {line}\n".encode('ascii', errors='replace'))
