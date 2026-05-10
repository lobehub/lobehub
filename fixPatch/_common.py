"""
fixPatch/_common.py — Costanti e helper condivisi da tutti gli script fixPatch.

NESSUN PATH HARDCODED. Tutto è derivato dalla posizione di questo file:
  _common.py vive in fixPatch/ → parent = fixPatch/ → parent.parent = repo root

Uso:
    from _common import REPO, GIT, git, git_soft, section
"""

import subprocess, sys, shutil
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────
#
#   Questo file (_common.py) si trova in:
#     <repo_root>/fixPatch/_common.py
#
#   Quindi:
#     Path(__file__).resolve().parent         = <repo_root>/fixPatch/
#     Path(__file__).resolve().parent.parent  = <repo_root>/
#
REPO = Path(__file__).resolve().parent.parent

# Cerca git nel PATH di sistema.
# shutil.which("git") ritorna il path completo (es. "C:\Program Files\Git\cmd\git.exe")
# oppure None se git non è installato.
_git_path = shutil.which("git")
if _git_path is None:
    print("ERRORE: git non trovato nel PATH di sistema.")
    print("Installa git e assicurati che sia nel PATH.")
    sys.exit(1)
GIT = _git_path

# Cartella delle patch
PATCHES_DIR = REPO / "fixPatch" / "patches"


# ── Helper functions ───────────────────────────────────────────────────────

def git(*args):
    """
    Esegue un comando git nel repo. Esce con errore se il comando fallisce.

    Uso:
        output = git("status", "--short")
        output = git("log", "--oneline", "-5")
    """
    r = subprocess.run(
        [GIT, "-C", str(REPO)] + list(args),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace"
    )
    if r.returncode != 0:
        print(f"  [GIT ERROR] git {' '.join(args)}")
        print(f"  stderr: {r.stderr.strip()}")
        sys.exit(r.returncode)
    return r.stdout.strip()


def git_soft(*args):
    """
    Come git() ma NON esce in caso di errore.
    Ritorna una tupla: (successo: bool, stdout: str, stderr: str)

    Uso:
        ok, out, err = git_soft("merge", "--no-edit", "upstream/canary")
        if ok:
            print("merge riuscito")
        else:
            print(f"merge fallito: {err}")
    """
    r = subprocess.run(
        [GIT, "-C", str(REPO)] + list(args),
        capture_output=True, text=True,
        encoding="utf-8", errors="replace"
    )
    return r.returncode == 0, (r.stdout or "").strip(), (r.stderr or "").strip()


def section(msg):
    """Stampa un separatore visivo con un messaggio. Utile per i log."""
    print(f"\n{'='*60}\n  {msg}\n{'='*60}")
