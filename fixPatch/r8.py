import os, subprocess

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Find where diffText is used/rendered
result = subprocess.run(
    ['git', 'grep', '-rn', 'diffText'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)

# Find inspector for editLocalFile
result2 = subprocess.run(
    ['git', 'grep', '-rln', 'editLocalFile.*Inspector\|Inspector.*editLocalFile\|editFile.*Inspector\|diffText'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)

# Also search for the plugin inspector files
result3 = subprocess.run(
    ['git', 'ls-files', 'src/'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)

outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\r8_out.txt'
with open(outfile, 'w', encoding='utf-8', errors='replace') as out:
    out.write("=== diffText grep ===\n")
    out.write(result.stdout)
    out.write("\n\n=== Files with diffText or editLocalFile Inspector ===\n")
    out.write(result2.stdout)
    
    # from all files find those with inspector/edit
    out.write("\n\n=== Inspector-related files ===\n")
    for line in result3.stdout.split('\n'):
        if 'inspector' in line.lower() or 'Inspector' in line:
            out.write(line + '\n')

print(f"Written {os.path.getsize(outfile)} bytes")
with open(outfile, encoding='utf-8', errors='replace') as f:
    content = f.read()
os.write(1, content[:8000].encode('ascii', errors='replace'))
