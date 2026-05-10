import subprocess, sys, os
result = subprocess.run(
    [r"C:\Python314\python.exe", r"fixPatch\apply_workflow_fix.py"],
    cwd=os.path.join(os.environ["USERPROFILE"], "Projects", "Mio", "lobehub"),
    capture_output=True, text=True
)
print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr)
sys.exit(result.returncode)
