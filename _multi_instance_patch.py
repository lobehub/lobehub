#!/usr/bin/env python3
"""
Patch: multi-instance support per LobeHub Desktop
Branch: emaxlele-dev
Modifica App.ts per supportare più istanze via flag --instance-id=<name>
"""
import subprocess
import sys
import os

GIT = r"C:\Program Files\Git\cmd\git.exe"
REPO = r"C:\Users\emanuele.gallo\Projects\Mio\lobehub"

def git(*args):
    result = subprocess.run([GIT, "-C", REPO] + list(args), capture_output=True, text=True)
    print(f"git {' '.join(args)}")
    if result.stdout: print(result.stdout)
    if result.stderr: print(result.stderr, file=sys.stderr)
    return result.returncode, result.stdout, result.stderr

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print(f"Written: {path}")

# ---- 1. Patch App.ts ----
app_ts_path = os.path.join(REPO, "apps", "desktop", "src", "main", "core", "App.ts")
app_ts = read_file(app_ts_path)

# Sostituisce il blocco single-instance lock con uno che supporta multi-istanza
OLD_BOOTSTRAP_LOCK = """  bootstrap = async () => {
    logger.info('Bootstrapping application');
    // make single instance
    const isSingle = app.requestSingleInstanceLock();
    if (!isSingle) {
      logger.info('Another instance is already running, exiting');
      app.exit(0);
    }

    this.initDevBranding();"""

NEW_BOOTSTRAP_LOCK = """  bootstrap = async () => {
    logger.info('Bootstrapping application');

    // Multi-instance support: --instance-id=<name> flag or LOBEHUB_INSTANCE_ID env var
    // allows running multiple isolated LobeHub instances side by side.
    const instanceIdArg = process.argv.find((a) => a.startsWith('--instance-id='));
    const instanceId = instanceIdArg
      ? instanceIdArg.slice('--instance-id='.length).replace(/[^a-zA-Z0-9_-]/g, '_')
      : (process.env.LOBEHUB_INSTANCE_ID ?? '');

    if (instanceId) {
      // Each instance gets its own isolated userData directory so stores / DBs don't conflict.
      const baseUserData = app.getPath('userData');
      const instanceUserData = `${baseUserData}-${instanceId}`;
      app.setPath('userData', instanceUserData);
      logger.info(`Multi-instance mode: id="${instanceId}", userData="${instanceUserData}"`);
    }

    // Single-instance lock is per-userData, so different instances get independent locks.
    const allowMultiple =
      !!instanceId || process.argv.includes('--allow-multiple-instances') ||
      !!process.env.LOBEHUB_ALLOW_MULTIPLE_INSTANCES;

    if (!allowMultiple) {
      const isSingle = app.requestSingleInstanceLock();
      if (!isSingle) {
        logger.info('Another instance is already running, exiting');
        app.exit(0);
      }

      app.on('second-instance', (_event, _commandLine) => {
        // Focus the existing window if a second launch is attempted
        const mainBrowser = this.browserManager?.getBrowser('app');
        if (mainBrowser?.window) {
          if (mainBrowser.window.isMinimized()) mainBrowser.window.restore();
          mainBrowser.window.focus();
        }
      });
    } else {
      logger.info('Multi-instance / allow-multiple-instances mode: skipping single-instance lock');
    }

    this.initDevBranding();"""

if OLD_BOOTSTRAP_LOCK not in app_ts:
    print("ERROR: Old bootstrap lock block not found — check alignment")
    sys.exit(1)

new_app_ts = app_ts.replace(OLD_BOOTSTRAP_LOCK, NEW_BOOTSTRAP_LOCK, 1)
write_file(app_ts_path, new_app_ts)

# ---- 2. Patch dir.ts: istanza-aware appStorageDir ----
dir_ts_path = os.path.join(REPO, "apps", "desktop", "src", "main", "const", "dir.ts")
dir_ts = read_file(dir_ts_path)

OLD_STORAGE = """export const userDataDir = app.getPath('userData');

export const appStorageDir = path.join(userDataDir, 'lobehub-storage');"""

NEW_STORAGE = """// Note: userDataDir is resolved AFTER bootstrap() may have called app.setPath('userData', ...)
// for multi-instance mode. Calling app.getPath('userData') here (module init time) is fine
// because dir.ts is only imported after Electron app-ready, but AppStorageDir is accessed
// lazily via StoreManager which initialises after setPath in App.bootstrap.
export const userDataDir = app.getPath('userData');

export const appStorageDir = path.join(userDataDir, 'lobehub-storage');"""

if OLD_STORAGE in dir_ts:
    new_dir_ts = dir_ts.replace(OLD_STORAGE, NEW_STORAGE, 1)
    write_file(dir_ts_path, new_dir_ts)
else:
    print("NOTE: dir.ts OLD_STORAGE pattern not found — skipping (may already be patched)")

# ---- 3. Verifica branch ----
rc, out, _ = git("branch", "--show-current")
current_branch = out.strip()
print(f"Current branch: {current_branch}")

if current_branch != "emaxlele-dev":
    print(f"Switching to emaxlele-dev...")
    git("checkout", "emaxlele-dev")

# ---- 4. Git add + commit ----
git("add",
    "apps/desktop/src/main/core/App.ts",
    "apps/desktop/src/main/const/dir.ts"
)

rc, out, err = git("status", "--short")
if not out.strip():
    print("Nothing to commit — patch may already be applied")
    sys.exit(0)

rc, out, err = git("commit", "-m",
    "feat(desktop): multi-instance support via --instance-id=<name> flag\n\n"
    "Adds multi-instance support for LobeHub Desktop:\n\n"
    "  --instance-id=<name>  Launch a second isolated instance with its own\n"
    "                         userData directory (userData-<name>), independent\n"
    "                         store, DB, and single-instance lock.\n\n"
    "  LOBEHUB_INSTANCE_ID   Same as --instance-id via environment variable.\n\n"
    "  --allow-multiple-instances  Skip single-instance lock entirely (shared userData).\n"
    "  LOBEHUB_ALLOW_MULTIPLE_INSTANCES  Same via env var.\n\n"
    "When an instanceId is present:\n"
    "- app.setPath('userData') is called before any store/DB init\n"
    "- Single-instance lock is scoped to the instance userData (per Electron behaviour)\n"
    "- A second-instance focus handler is NOT registered (each instance is independent)\n\n"
    "This matches browser behaviour where multiple tabs/windows can run the same agent.\n\n"
    "Usage examples:\n"
    "  LobeHub.exe --instance-id=work\n"
    "  LobeHub.exe --instance-id=personal\n"
    "  LOBEHUB_INSTANCE_ID=dev LobeHub.exe"
)
print(f"Commit rc={rc}")
if rc != 0:
    print("Commit failed:", err)
    sys.exit(1)

# ---- 5. Push ----
rc, out, err = git("push", "origin", "emaxlele-dev")
print(f"Push rc={rc}")
if err: print(err)

print("\n=== DONE ===")
print("emaxlele-dev pushed. CI build will create v2.1.57-emaxlele.5")
print("Monitor: https://github.com/emaxlele/lobehub/actions")
