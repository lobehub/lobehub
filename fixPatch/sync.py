r"""
fixPatch/sync.py — Master entry point per emaxlele-dev
=======================================================
Uso: C:\Python314\python.exe fixPatch\sync.py [--dry-run]
     (da %USERPROFILE%\Projects\Mio\lobehub, oppure da qualsiasi directory)

Cosa fa in ordine:
  1. Fetch + merge upstream/canary in emaxlele-dev
  2. Re-applica tutte le nostre patch (idempotenti: skip se già applicate)
  3. Commit (patch riapplicate + eventuali altre modifiche tracked)
     Se nessuna modifica e HEAD == upstream/canary HEAD → empty version-bump
     commit per garantire che emaxlele-dev abbia un commit ESCLUSIVO prima del push.
  4. Push origin emaxlele-dev  ← solo il branch, NO tag

Il tag di release (vX.Y.Z-emaxlele.N) viene creato dal workflow GitHub Actions
`emaxlele-build.yml` che si attiva sul push. Il workflow lo crea sul commit HEAD
del push — che è garantito essere esclusivo di emaxlele-dev dal punto 3.

Le patch sono in fixPatch/patches/*.py — ognuna espone:
  - PATCH_ID   : stringa univoca (usata per check idempotenza)
  - check()    : ritorna True se la patch è GIÀ applicata
  - apply()    : applica la patch
  - description: stringa leggibile

Flag:
  --dry-run    Mostra cosa farebbe senza eseguire modifiche
"""

import argparse, sys, os, json, re, io
from pathlib import Path
import importlib.util

# Fix stdout encoding for Windows terminals
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ── Import da _common.py (REPO, GIT, helpers) ─────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO, GIT, PATCHES_DIR, git, git_soft, section

# ── DRY_RUN flag ───────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Sync emaxlele-dev con upstream canary")
parser.add_argument("--dry-run", action="store_true",
                    help="Mostra cosa farebbe senza eseguire modifiche")
args = parser.parse_args()
DRY_RUN = args.dry_run

if DRY_RUN:
    print("[DRY-RUN] Nessuna modifica verra effettuata")


# ── get_canary_version ─────────────────────────────────────────────────────

def get_canary_version():
    """
    Legge la versione upstream dal tag git più recente su upstream/canary.
    upstream lobehub NON committa il bump in package.json — usa solo tag git.
    Esempio: 'v2.1.58-canary.1' → '2.1.58-canary.1'
    Fallback: package.json se nessun tag trovato.
    """
    ok, out, _ = git_soft(
        "describe", "--tags", "--abbrev=0", "--match", "v*", "upstream/canary"
    )
    if ok and out.strip():
        return out.strip().lstrip("v")

    ok2, out2, _ = git_soft(
        "tag", "--sort=-version:refname", "--merged", "upstream/canary"
    )
    if ok2 and out2.strip():
        for line in out2.strip().splitlines():
            t = line.strip().lstrip("v")
            if "canary" in t:
                return t
        return out2.strip().splitlines()[0].lstrip("v")

    pkg_path = REPO / "package.json"
    try:
        with open(pkg_path, encoding="utf-8") as f:
            pkg = json.load(f)
        return pkg.get("version", "unknown")
    except Exception as e:
        print(f"  [WARNING] Impossibile leggere package.json: {e}")
        return "unknown"


# ── step 1: merge canary ───────────────────────────────────────────────────

def merge_canary():
    section("STEP 1 — Merge upstream/canary")

    if DRY_RUN:
        print("  [DRY RUN] Farebbe: git fetch upstream + merge -X theirs upstream/canary")
        ok, out, _ = git_soft("rev-parse", "upstream/canary")
        print(f"  [DRY RUN] upstream/canary HEAD: {out[:8] if ok else 'N/A'}")
        return

    if (REPO / ".git" / "MERGE_HEAD").exists():
        print("  Merge in corso rilevato — abort...")
        git_soft("merge", "--abort")
        print("  Merge abortito OK")
    if (REPO / ".git" / "rebase-merge").exists() or (REPO / ".git" / "rebase-apply").exists():
        print("  Rebase in corso rilevato — abort...")
        git_soft("rebase", "--abort")
        print("  Rebase abortito OK")
    _, idx, _ = git_soft("diff", "--name-only", "--diff-filter=U")
    if idx.strip():
        print(f"  Conflitti nell'index — reset hard HEAD...")
        git_soft("reset", "--hard", "HEAD")
        print("  Reset OK")

    current = git("branch", "--show-current")
    if current != "emaxlele-dev":
        print(f"  Checkout emaxlele-dev (era: {current})")
        git("checkout", "emaxlele-dev")

    print("  fetch upstream...")
    git("fetch", "upstream")

    canary_ver = get_canary_version()

    _, dirty, _ = git_soft("status", "--porcelain")
    if dirty.strip():
        print("  Working tree sporco — checkout --. (fixPatch/ ignorata da git, intatta)")
        git("checkout", "--", ".")
        print("  Checkout OK — file tracked ripristinati a HEAD")

    ok, out, err = git_soft("merge", "--no-edit", "-X", "theirs", "upstream/canary")
    if ok:
        first_line = out.splitlines()[0] if out else "up-to-date"
        print(f"  merge OK (-X theirs): {first_line}")
        print(f"  upstream canary version: {canary_ver}")
    else:
        print(f"  [MERGE ERROR] {err}")
        git_soft("merge", "--abort")
        sys.exit(1)


# ── step 2: carica e applica patch ─────────────────────────────────────────

def load_patches():
    patches = []
    for f in sorted(PATCHES_DIR.glob("patch_*.py")):
        spec_name = f"fixPatch.patches.{f.stem}"
        spec = importlib.util.spec_from_file_location(spec_name, f)
        mod  = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        patches.append(mod)
    return patches

def apply_patches():
    section("STEP 2 — Re-applica patch emaxlele")
    patches = load_patches()
    if not patches:
        print("  Nessuna patch trovata in fixPatch/patches/")
        return []

    applied = []
    for p in patches:
        print(f"\n  [{p.PATCH_ID}] {p.description}")
        if p.check(REPO):
            print("    → già applicata, skip")
        else:
            if DRY_RUN:
                print(f"    [DRY RUN] Applicherebbe {p.PATCH_ID}")
            else:
                print("    → applicazione...")
                p.apply(REPO)
                if p.check(REPO):
                    print("    ✓ applicata con successo")
                    applied.append(p)
                else:
                    print("    ✗ ERRORE: check fallito dopo apply")
                    sys.exit(1)
    return applied


# ── step 3: commit ─────────────────────────────────────────────────────────

def commit_and_ensure_exclusive(applied_patches):
    section("STEP 3 — Commit + garanzia commit esclusivo")

    canary_ver = get_canary_version()
    _, status, _ = git_soft("status", "--porcelain")
    has_changes = bool(status.strip())

    head = git("rev-parse", "HEAD")
    canary_ok, canary_head, _ = git_soft("rev-parse", "upstream/canary")
    is_shared = canary_ok and (head == canary_head)

    if DRY_RUN:
        print(f"  HEAD: {head[:8]}, upstream/canary: {canary_head[:8] if canary_ok else 'N/A'}")
        print(f"  has_changes: {has_changes}, is_shared: {is_shared}")
        if has_changes:
            names = ", ".join(p.PATCH_ID for p in applied_patches) if applied_patches else "tracked changes"
            print(f"  [DRY RUN] Committerebbe patches: {names}")
        elif is_shared:
            print(f"  [DRY RUN] Creerebbe empty version-bump commit (HEAD condiviso con canary)")
        else:
            print(f"  [DRY RUN] HEAD già esclusivo — niente da committare")
        return

    if has_changes:
        git("add", "-A")
        names = ", ".join(p.PATCH_ID for p in applied_patches) if applied_patches else "tracked changes"
        msg = (
            f"chore(emaxlele-dev): sync canary + re-apply patches\n\n"
            f"Upstream canary: {canary_ver}\n"
            f"Patches: {names}\n\n"
            f"Auto-applied by fixPatch/sync.py — idempotent re-application\n"
            f"after upstream/canary merge. Upstream PRs still open."
        )
        git("commit", "-m", msg)
        head = git("rev-parse", "HEAD")
        print(f"  Committed: {names}")
        print(f"  Nuovo HEAD: {head[:8]} (esclusivo di emaxlele-dev)")

    elif is_shared:
        print(f"  HEAD ({head[:8]}) == upstream/canary HEAD — nessuna modifica da committare")
        print(f"  Creo empty version-bump commit per garantire commit esclusivo su emaxlele-dev")
        msg = (
            f"chore(emaxlele-dev): version-bump — upstream canary {canary_ver}\n\n"
            f"Empty commit — ensures emaxlele-dev has an exclusive commit\n"
            f"so the release tag created by the build workflow lands only\n"
            f"on emaxlele-dev and not on upstream/canary.\n\n"
            f"Upstream canary: {canary_ver}"
        )
        git("commit", "--allow-empty", "-m", msg)
        head = git("rev-parse", "HEAD")
        print(f"  Nuovo HEAD: {head[:8]} (esclusivo di emaxlele-dev)")

    else:
        print(f"  HEAD ({head[:8]}) già esclusivo, nessuna modifica — nothing to commit")


# ── step 4: push branch (NO tag) ──────────────────────────────────────────

def pull_rebase():
    section("STEP 4a — Pull --rebase origin emaxlele-dev")

    if DRY_RUN:
        print("  [DRY RUN] Farebbe: git pull --rebase -X theirs origin emaxlele-dev")
        return

    if (REPO / ".git" / "rebase-merge").exists() or (REPO / ".git" / "rebase-apply").exists():
        print("  Rebase in sospeso — abort...")
        git_soft("rebase", "--abort")

    ok, out, err = git_soft("pull", "--rebase", "-X", "theirs", "origin", "emaxlele-dev")
    if ok:
        last = (out or err).splitlines()[-1] if (out or err) else "already up to date"
        print(f"  Pull rebase OK: {last}")
    else:
        print(f"  [WARN] Pull rebase conflitto — skip commit problematici...")
        for _ in range(20):
            ok2, _, _ = git_soft("rebase", "--skip")
            if ok2:
                if not (REPO / ".git" / "rebase-merge").exists() and \
                   not (REPO / ".git" / "rebase-apply").exists():
                    print("  Rebase completato dopo skip")
                    break
            else:
                break
        else:
            git_soft("rebase", "--abort")
            print("  [WARN] Rebase abortito dopo troppi skip — push diretto")


def push():
    section("STEP 4b — Push origin emaxlele-dev (branch only, no tag)")

    if DRY_RUN:
        print("  [DRY RUN] Pusherebbe origin emaxlele-dev")
        print("  [DRY RUN] Il workflow emaxlele-build.yml si attiverebbe e creerebbe il tag")
        return

    ok, out, err = git_soft("push", "origin", "emaxlele-dev")
    if ok:
        last = (err or out).splitlines()[-1] if (err or out) else "ok"
        print(f"  Push OK: {last}")
        print(f"  → il workflow emaxlele-build.yml si attiverà automaticamente")
        print(f"  → creerà il tag release (vX.Y.Z-emaxlele.N) sul commit HEAD")
    else:
        print(f"  [PUSH ERROR] {err}")
        sys.exit(1)


# ── main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"fixPatch/sync.py — repo: {REPO}")
    canary_ver = get_canary_version()
    print(f"  upstream canary version: {canary_ver}")
    merge_canary()
    applied = apply_patches()
    commit_and_ensure_exclusive(applied)
    pull_rebase()
    push()
    section("DONE")
    if DRY_RUN:
        print(f"  DRY-RUN completato — nessuna modifica effettuata.")
    else:
        print(f"  emaxlele-dev aggiornato e pushato.")
        print(f"  upstream canary: {canary_ver}")
        print(f"  Attendi il workflow GitHub Actions per la release e il tag.")
