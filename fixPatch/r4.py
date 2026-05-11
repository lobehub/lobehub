import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

for git_path, outname in [
    ('src/routes/(main)/agent/features/Conversation/WorkingSidebar/Review/FileItem.tsx', 'FileItem2.txt'),
    ('src/routes/(main)/agent/features/Conversation/WorkingSidebar/Review/useReviewPatches.ts', 'useReviewPatches.txt'),
    ('src/routes/(main)/agent/features/Conversation/WorkingSidebar/Review/index.tsx', 'ReviewIndex.txt'),
]:
    result = subprocess.run(
        ['git', 'show', f'HEAD:{git_path}'],
        cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
    )
    outfile = os.path.join(repo, 'fixPatch', outname)
    with open(outfile, 'w', encoding='utf-8', errors='replace') as f:
        f.write(result.stdout)
    os.write(1, f"=== {outname}: {os.path.getsize(outfile)} bytes ===\n".encode('ascii', errors='replace'))
    os.write(1, result.stdout.encode('ascii', errors='replace'))
    os.write(1, b"\n\n")
