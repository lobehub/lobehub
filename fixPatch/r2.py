import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

result = subprocess.run(
    ['git', 'show', 'HEAD:src/routes/(main)/agent/features/Conversation/WorkingSidebar/Review/FileItem.tsx'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
out_path = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\FileItem_content.txt'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(result.stdout)
    if result.stderr:
        f.write('\n\nSTDERR:\n' + result.stderr)
print(f"Written to {out_path}, size={os.path.getsize(out_path)}")
print(result.stdout[:3000])
