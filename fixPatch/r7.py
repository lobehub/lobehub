import os, subprocess

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

files_to_read = [
    'src/services/electron/localFileService.ts',
    'src/features/DevPanel/RenderGallery/fixtures/lobe-local-system.ts',
    'src/features/Conversation/Messages/AssistantGroup/constants.ts',
]

outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\r7_out.txt'
with open(outfile, 'w', encoding='utf-8', errors='replace') as out:
    for git_path in files_to_read:
        result = subprocess.run(
            ['git', 'show', f'HEAD:{git_path}'],
            cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
        )
        out.write(f'\n\n{"="*60}\n=== {git_path} ===\n{"="*60}\n')
        out.write(result.stdout)
        if result.stderr:
            out.write(f'\nSTDERR: {result.stderr}\n')

print(f"Written to {outfile}, size={os.path.getsize(outfile)}")

# Print the file
with open(outfile, encoding='utf-8', errors='replace') as f:
    content = f.read()
# Print ASCII-safe
os.write(1, content.encode('ascii', errors='replace'))
