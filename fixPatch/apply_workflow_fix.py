r"""
Applica la modifica a sync.py:
aggiunge clean_workflows() tra merge_canary() e apply_patches()
"""
import os
from pathlib import Path

REPO = Path(os.environ["USERPROFILE"]) / "Projects" / "Mio" / "lobehub"
SYNC = REPO / "fixPatch" / "sync.py"

content = SYNC.read_text(encoding="utf-8")

# ----- 1. Inserisci la funzione clean_workflows dopo apply_patches() -----
NEW_FUNC = '''
# ━━ step 1b: pulisce .github/workflows/ lasciando solo emaxlele-build.yml ━━━━━

EMAXLELE_WORKFLOW = "emaxlele-build.yml"

def clean_workflows():
    section("STEP 1b — Pulizia .github/workflows/ (tieni solo emaxlele-build.yml)")

    workflows_dir = REPO / ".github" / "workflows"
    if not workflows_dir.exists():
        print("  .github/workflows/ non esiste — skip")
        return

    kept = []
    removed = []
    for f in workflows_dir.iterdir():
        if f.is_file():
            if f.name == EMAXLELE_WORKFLOW:
                kept.append(f.name)
            else:
                if DRY_RUN:
                    removed.append(f.name)
                else:
                    f.unlink()
                    removed.append(f.name)

    print(f"  Tenuto:  {kept}")
    if removed:
        if DRY_RUN:
            print(f"  [DRY RUN] Eliminerebbe {len(removed)} workflow: {removed[:5]}{'...' if len(removed)>5 else ''}")
        else:
            print(f"  Eliminati {len(removed)} workflow upstream: {removed[:5]}{'...' if len(removed)>5 else ''}")
    else:
        print("  Nessun workflow upstream da eliminare")


'''

# Inserisci la funzione prima di "# ━━ step 2: carica e applica patch"
MARKER = "# ━━ step 2: carica e applica patch"
if MARKER in content:
    content = content.replace(MARKER, NEW_FUNC + MARKER)
    print("  [OK] Funzione clean_workflows() inserita")
else:
    # fallback: cerca la funzione load_patches
    MARKER2 = "def load_patches():"
    if MARKER2 in content:
        content = content.replace(MARKER2, NEW_FUNC.rstrip() + "\n\n\ndef load_patches():")
        print("  [OK] Funzione clean_workflows() inserita (fallback marker)")
    else:
        print("  [ERRORE] Marker non trovato — sync.py non modificato")
        exit(1)

# ----- 2. Aggiorna il main: chiama clean_workflows() dopo merge_canary() -----
OLD_MAIN_CALL = "    merge_canary()\n    applied = apply_patches()"
NEW_MAIN_CALL = "    merge_canary()\n    clean_workflows()\n    applied = apply_patches()"

if OLD_MAIN_CALL in content:
    content = content.replace(OLD_MAIN_CALL, NEW_MAIN_CALL)
    print("  [OK] Chiamata clean_workflows() aggiunta nel main")
else:
    print("  [ERRORE] Pattern main non trovato — controlla manualmente")
    exit(1)

# ----- 3. Scrivi -----
SYNC.write_text(content, encoding="utf-8")
print(f"\n  sync.py aggiornato: {SYNC}")
print("  Verifica: grep 'clean_workflows' fixPatch/sync.py")
