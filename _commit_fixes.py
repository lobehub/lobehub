import subprocess, sys

REPO = r"C:\Users\emanuele.gallo\Projects\Mio\lobehub"
GIT = r"C:\Program Files\Git\cmd\git.exe"

def run(args, **kw):
    r = subprocess.run([GIT, "-C", REPO] + args, capture_output=True, text=True, **kw)
    print("CMD:", " ".join(args))
    if r.stdout: print("OUT:", r.stdout.strip())
    if r.stderr: print("ERR:", r.stderr.strip())
    if r.returncode != 0:
        print(f"FAILED (exit {r.returncode})")
        sys.exit(r.returncode)
    return r.stdout.strip()

# 1. Stage the two modified files
run(["add",
     "packages/local-file-shell/src/shell/utils.ts",
     "apps/desktop/src/main/core/App.ts"])

# 2. Commit fix 1 — PowerShell shell
run(["commit", "-m",
     "fix(local-system): switch Windows shell from cmd.exe to PowerShell\n\n"
     "cmd.exe /c breaks on && operators, complex pipes and $env: variables.\n"
     "PowerShell -NonInteractive -Command handles all of these natively.\n"
     "windowsVerbatimArguments is preserved for quoted-path correctness.\n"
     "This fixes the primary runCommand failure mode on Windows desktops.\n"
     "\nPart of emaxlele-dev personal branch — also opening PR upstream."])

print("\n--- Fix 1 committed ---\n")

# 3. Commit fix 2 — double-click multi-instance
# already staged together — let's check if we need a separate amend or if both are in one commit
# They were staged and committed together in step 2 above.
# Actually both files were staged together, so they're in one commit.
# Let's verify
log = run(["log", "--oneline", "-3"])
print("Recent log:\n", log)

# 4. Merge latest upstream canary
run(["fetch", "upstream"])
run(["merge", "--no-edit", "upstream/canary"])
print("\n--- Canary merged ---\n")

# 5. Push emaxlele-dev to origin
run(["push", "origin", "emaxlele-dev"])
print("\n--- Pushed emaxlele-dev ---\n")

print("ALL DONE")
