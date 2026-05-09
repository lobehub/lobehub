#!/usr/bin/env python3
"""
sync-and-build.py  —  emaxlele-dev local build helper
======================================================
Uso:
  python sync-and-build.py              # sync + push + build locale
  python sync-and-build.py --skip-build # sync + push, senza build
  python sync-and-build.py --build-only # solo build locale
  python sync-and-build.py --skip-rebase # salta fetch/rebase (dopo conflitto risolto)

Workflow:
  1. Aggiunge remote 'upstream' (lobehub/lobehub) se mancante
  2. Fetch upstream/canary
  3. Rebase emaxlele-dev su upstream/canary
  4. Push origin/emaxlele-dev  →  GitHub Actions si avvia automaticamente
  5. Build locale Windows (opzionale)
"""

import subprocess
import sys
import os
import argparse

REPO = os.path.dirname(os.path.abspath(__file__))
UPSTREAM_URL = "https://github.com/lobehub/lobehub.git"
UPSTREAM_BRANCH = "canary"
MY_BRANCH = "emaxlele-dev"


def run(cmd, check=True, cwd=REPO):
    print(f"  > {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.stderr.strip():
        print(r.stderr.strip(), file=sys.stderr)
    if check and r.returncode != 0:
        print(f"\nERRORE (exit {r.returncode})", file=sys.stderr)
        sys.exit(r.returncode)
    return r


def setup_upstream():
    print("\n[1/4] Setup upstream remote...")
    remotes = run(["git", "remote"]).stdout
    if "upstream" not in remotes:
        run(["git", "remote", "add", "upstream", UPSTREAM_URL])
        print("  upstream aggiunto")
    else:
        print("  upstream gia configurato")


def fetch_and_rebase():
    print("\n[2/4] Fetch upstream + rebase...")
    run(["git", "checkout", MY_BRANCH])
    run(["git", "fetch", "upstream"])
    result = run(
        ["git", "rebase", f"upstream/{UPSTREAM_BRANCH}"],
        check=False
    )
    if result.returncode != 0:
        print("\nCONFLITTO durante rebase. Risolvi manualmente:")
        print("  1. git status")
        print("  2. [risolvi conflitti]")
        print("  3. git rebase --continue")
        print("  4. python sync-and-build.py --skip-rebase")
        sys.exit(1)
    print("  Rebase completato")


def push_origin():
    print("\n[3/4] Push origin/emaxlele-dev...")
    run(["git", "push", "origin", MY_BRANCH, "--force-with-lease"])
    print("  Push completato — GitHub Actions si avviera automaticamente")


def build_local():
    print("\n[4/4] Build locale Windows...")
    print("  pnpm install...")
    run(["pnpm", "install", "--node-linker=hoisted"])
    print("  npm install-isolated desktop...")
    run(["npm", "run", "install-isolated", "--prefix=./apps/desktop"])
    print("  Build in corso (5-15 min)...")
    env = os.environ.copy()
    env.update({
        "UPDATE_CHANNEL": "canary",
        "APP_URL": "http://localhost:3015",
        "DATABASE_URL": "postgresql://postgres@localhost:5432/postgres",
        "KEY_VAULTS_SECRET": "oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE=",
    })
    r = subprocess.run(
        ["npm", "run", "desktop:package:app"],
        cwd=REPO, env=env
    )
    if r.returncode != 0:
        print("Build fallita.", file=sys.stderr)
        sys.exit(r.returncode)

    release_dir = os.path.join(REPO, "apps", "desktop", "release")
    if os.path.exists(release_dir):
        exes = [f for f in os.listdir(release_dir) if f.endswith(".exe")]
        if exes:
            print(f"\n  Build completata!")
            for exe in exes:
                full = os.path.join(release_dir, exe)
                size_mb = os.path.getsize(full) / 1024 / 1024
                print(f"  {exe}  ({size_mb:.1f} MB)")
            print(f"\n  Percorso: {release_dir}")


def main():
    parser = argparse.ArgumentParser(description="emaxlele-dev sync & build")
    parser.add_argument("--skip-build",  action="store_true", help="Sync+push senza build locale")
    parser.add_argument("--build-only",  action="store_true", help="Solo build locale")
    parser.add_argument("--skip-rebase", action="store_true", help="Salta fetch/rebase")
    args = parser.parse_args()

    print("=" * 55)
    print("  emaxlele-dev  —  sync & build")
    print("=" * 55)
    print(f"  Repo   : {REPO}")
    print(f"  Branch : {MY_BRANCH}  →  upstream/{UPSTREAM_BRANCH}")

    if not args.build_only:
        setup_upstream()
        if not args.skip_rebase:
            fetch_and_rebase()
        push_origin()

    if not args.skip_build:
        build_local()

    print("\nTutto completato!")


if __name__ == "__main__":
    main()
