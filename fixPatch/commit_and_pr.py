import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

def run(args, **kwargs):
    r = subprocess.run(args, cwd=repo, capture_output=True, text=True,
        encoding='utf-8', errors='replace', **kwargs)
    sys.stdout.buffer.write(f"$ {' '.join(args)}\n".encode('ascii', errors='replace'))
    if r.stdout:
        sys.stdout.buffer.write(r.stdout.encode('ascii', errors='replace'))
    if r.stderr:
        sys.stdout.buffer.write(f"STDERR: {r.stderr}\n".encode('ascii', errors='replace'))
    return r

# 1. Stage only the 2 modified files
run(['git', 'add',
    'packages/local-file-shell/src/file/edit.ts',
    'src/features/DevPanel/RenderGallery/fixtures/lobe-local-system.ts'
])

# 2. Check current branch
r = run(['git', 'branch', '--show-current'])
branch = r.stdout.strip()
sys.stdout.buffer.write(f"Current branch: {branch}\n".encode('ascii', errors='replace'))

# 3. Commit
commit_msg = """fix(local-system): strip createPatch preamble to prevent PatchDiff crash

`createPatch()` from the `diff` library emits an "Index: …\\n===…\\n"
preamble before the unified diff hunks. The renderer was then prepending
a "diff --git a/… b/…" header on top, giving PatchDiff two distinct
block headers. `getSingularPatch` inside @lobehub/ui correctly enforces
"exactly 1 patch / 1 diff" and throws:

  Error: PatchDiff: Provided patch must include only 1 patch, with 1 diff

The edit *succeeded* on disk (the file was written correctly) but the
UI crashed while trying to render the diff viewer.

Fix: after calling `createPatch`, slice everything before the first
`--- ` line so PatchDiff receives a single clean unified-diff block.
The `diff --git a/… b/…` header is kept (as a leading hint to the
syntax highlighter) because the trimmed body starts right at `--- `.

Also update the DevPanel fixture for `editLocalFile` so it matches the
newly-emitted format (with the `diff --git` prefix).

Fixes: PatchDiff crash on every successful `editFile` call.
"""

run(['git', 'commit', '-m', commit_msg])

# 4. If on emaxlele-dev, push
if 'emaxlele-dev' in branch:
    run(['git', 'push', 'origin', 'emaxlele-dev'])
    sys.stdout.buffer.write(b"Pushed to emaxlele-dev\n")
else:
    sys.stdout.buffer.write(f"NOTE: not on emaxlele-dev (on {branch}), skipping push\n".encode('ascii', errors='replace'))
    sys.stdout.buffer.write(b"Manual push required: git push origin <branch>\n")
