import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

result = subprocess.run(
    ['git', 'show', 'HEAD:src/routes/(main)/agent/features/Conversation/WorkingSidebar/Review/FileItem.tsx'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)

outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\FileItem2.txt'
with open(outfile, 'w', encoding='utf-8') as f:
    f.write(result.stdout)

result2 = subprocess.run(
    ['git', 'show', 'HEAD:src/routes/(main)/agent/features/Conversation/WorkingSidebar/Review/useReviewPatches.ts'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
outfile2 = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\useReviewPatches.txt'
with open(outfile2, 'w', encoding='utf-8') as f:
    f.write(result2.stdout)

print(f"FileItem2.txt: {os.path.getsize(outfile)} bytes")
print(f"useReviewPatches.txt: {os.path.getsize(outfile2)} bytes")

# print last 100 lines of FileItem
lines = result.stdout.split('\n')
print(f"\n=== FileItem.tsx lines {max(0,len(lines)-100)}-end ===")
for ln in lines[max(0,len(lines)-100):]:
    print(ln)
