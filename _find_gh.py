import subprocess, sys, os, shutil

# Find gh
gh_path = shutil.which('gh')
print(f'gh from shutil.which: {gh_path}')

# Try common locations
for p in [
    r'C:\Program Files\GitHub CLI\gh.exe',
    r'C:\Users\emanuele.gallo\AppData\Local\Programs\GitHub CLI\gh.exe',
    r'C:\Program Files (x86)\GitHub CLI\gh.exe',
]:
    print(f'{p}: exists={os.path.exists(p)}')

# Check PATH
print(f'\nPATH:\n{os.environ.get("PATH", "").replace(";", chr(10))}')

# Try running gh directly
r = subprocess.run(['gh', '--version'], capture_output=True, text=True)
print(f'\ngh --version: RC={r.returncode}')
if r.stdout: print(r.stdout)
if r.stderr: print(r.stderr)

# Try with shell=True
r2 = subprocess.run('gh --version', capture_output=True, text=True, shell=True)
print(f'gh --version (shell=True): RC={r2.returncode}')
if r2.stdout: print(r2.stdout)
if r2.stderr: print(r2.stderr)
