import os, subprocess

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Find all files related to editFile tool result rendering
result = subprocess.run(
    ['git', 'grep', '-rln', 'editFile\|EditFile\|edit_file\|PatchDiff\|getSingularPatch', '--', 'src/'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
files = [l.strip() for l in result.stdout.strip().split('\n') if l.strip()]
os.write(1, f"Files mentioning editFile/PatchDiff:\n".encode())
for f in files:
    os.write(1, f"  {f}\n".encode())

# Find tool result rendering components
result2 = subprocess.run(
    ['git', 'grep', '-rln', 'editFile\|localFiles\.editFile', '--', 'src/features/', 'src/routes/'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
files2 = [l.strip() for l in result2.stdout.strip().split('\n') if l.strip()]
os.write(1, b"\nFeature/route files for editFile:\n")
for f in files2:
    os.write(1, f"  {f}\n".encode())

# Look at the workflow tool display name for editFile
result3 = subprocess.run(
    ['git', 'grep', '-rn', 'editLocalFile\|EditLocalFile\|editFile.*patch\|patch.*editFile', '--', 'src/'],
    cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace'
)
os.write(1, b"\nSpecific editFile patch references:\n")
for line in result3.stdout.split('\n'):
    if line.strip():
        os.write(1, (line + '\n').encode('ascii', errors='replace'))
