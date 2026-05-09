#!/usr/bin/env python3
"""Crea branch separato e PR upstream per multi-instance support."""
import subprocess, sys, os, json

GIT = r"C:\Program Files\Git\cmd\git.exe"
REPO = r"C:\Users\emanuele.gallo\Projects\Mio\lobehub"
BRANCH = "feat/desktop-multi-instance-support"

def git(*args, check=False):
    r = subprocess.run([GIT, "-C", REPO] + list(args), capture_output=True, text=True)
    print(f"git {' '.join(args)}: rc={r.returncode}")
    if r.stdout.strip(): print(r.stdout.strip())
    if r.stderr.strip(): print(r.stderr.strip(), file=sys.stderr)
    if check and r.returncode != 0:
        sys.exit(1)
    return r.returncode, r.stdout, r.stderr

def gh(*args):
    r = subprocess.run(["gh"] + list(args), capture_output=True, text=True)
    print(f"gh {' '.join(args[:3])}: rc={r.returncode}")
    if r.stdout.strip(): print(r.stdout.strip())
    if r.stderr.strip(): print(r.stderr.strip(), file=sys.stderr)
    return r.returncode, r.stdout, r.stderr

# Verifica branch corrente
rc, out, _ = git("branch", "--show-current")
current = out.strip()
print(f"Current branch: {current}")

# Crea branch dedicato dalla stessa base di emaxlele-dev (solo i file cambiati)
# Prima porta in emaxlele-dev
git("checkout", "emaxlele-dev")

# Crea branch separato per la PR
git("branch", "-D", BRANCH)  # ignora errore se non esiste
git("checkout", "-b", BRANCH)

# Push branch sul fork
rc, out, err = git("push", "-f", "origin", BRANCH)
if rc != 0:
    print("Push failed:", err)
    sys.exit(1)

# Crea PR upstream via gh
title = "feat(desktop): multi-instance support via --instance-id flag"
body = """## Problem

On desktop, Electron's `requestSingleInstanceLock()` prevents running more than one LobeHub instance simultaneously. On the browser this works naturally — each tab/window is independent.

Users who want two isolated LobeHub setups (work + personal, or two different agent ecosystems) have no way to do so on desktop.

## Solution

Add multi-instance support via a `--instance-id=<name>` launch flag and `LOBEHUB_INSTANCE_ID` env var.

When `--instance-id=work` is passed:
1. `app.setPath('userData', '<baseUserData>-work')` is called **before** any store/DB init
2. Each instance gets a fully isolated userData directory with independent store, DB, and settings
3. The single-instance lock is scoped to that userData path (per Electron native behaviour)
4. Instances are completely independent — no shared state

Also adds `--allow-multiple-instances` / `LOBEHUB_ALLOW_MULTIPLE_INSTANCES` to skip the lock entirely.

## Usage

```
# Two isolated instances side by side
LobeHub.exe --instance-id=work
LobeHub.exe --instance-id=personal

# Via env var
set LOBEHUB_INSTANCE_ID=dev
LobeHub.exe

# Skip lock entirely (shared userData, advanced use)
LobeHub.exe --allow-multiple-instances
```

## Files changed

- `apps/desktop/src/main/core/App.ts` - multi-instance logic in `bootstrap()`
- `apps/desktop/src/main/const/dir.ts` - comment clarifying lazy resolution of userData path

## Notes

- No change when no flag is passed - single-instance behaviour is fully preserved
- userData isolation ensures each instance has its own lobehub-storage, plugins, and settings
- Matches browser behaviour where multiple independent sessions are trivially possible
"""

# Scrivi body su file temporaneo per evitare problemi di quoting
body_file = r"C:\Users\emanuele.gallo\Projects\Mio\lobehub\_pr_body_multi_instance.md"
with open(body_file, "w", encoding="utf-8") as f:
    f.write(body)

rc, out, err = gh("pr", "create",
    "-R", "lobehub/lobehub",
    "--title", title,
    "--body-file", body_file,
    "--base", "canary",
    "--head", f"emaxlele:{BRANCH}"
)

if rc == 0:
    print(f"\nPR creata: {out.strip()}")
else:
    print(f"\nPR creation failed: {err}")
    # Controlla se esiste già
    rc2, out2, _ = gh("pr", "list", "-R", "lobehub/lobehub", "--author", "emaxlele", "--state", "open")
    print("Open PRs:", out2)

# Torna a emaxlele-dev
git("checkout", "emaxlele-dev")
print("\n=== DONE ===")
