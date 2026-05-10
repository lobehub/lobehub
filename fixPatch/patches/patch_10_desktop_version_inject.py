r"""
PATCH 10 — Inietta versione emaxlele nel workflow build (apps/desktop/package.json)
====================================================================================
Problema:
  apps/desktop/package.json ha version: "0.0.0" hardcoded.
  Electron-updater usa questa versione come "versione corrente installata"
  per confrontarla con i release su GitHub e decidere se c'e' un aggiornamento.
  Con "0.0.0" l'updater non sa mai qual e' la versione reale → confronto errato.

Fix:
  Nel workflow emaxlele-build.yml, PRIMA dello step di build, aggiungi uno step
  che aggiorna apps/desktop/package.json con la versione calcolata dal workflow
  (es. "2.1.58-emaxlele.12").

  Lo step usa `node -e` per fare il patch in-place del JSON senza dipendenze esterne.
  Deve stare subito prima dello step "Build desktop app" in ogni job di build
  (build-windows, build-mac-arm, build-mac-x64, ecc.).

Questo garantisce che l'app installata conosca la sua versione precisa e
l'auto-updater possa confrontarla correttamente con i release su GitHub.

PR upstream: nessuna (e' specifica del nostro fork)
"""

PATCH_ID    = "patch_10_desktop_version_inject"
description = "Inietta versione emaxlele in apps/desktop/package.json nel workflow build"

TARGET = ".github/workflows/emaxlele-build.yml"

# Stringa CHECK: presente se la patch e' applicata
CHECK_STR = "patch_10: inject desktop version"

# Step da inserire prima di ogni step di build
# Lo step usa node per aggiornare apps/desktop/package.json con la versione del workflow
INJECT_STEP = """\
      - name: Inject desktop app version
        # patch_10: inject desktop version into apps/desktop/package.json
        # so electron-updater knows the real installed version for update comparison
        run: |
          node -e "
            const fs = require('fs');
            const p = 'apps/desktop/package.json';
            const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
            pkg.version = '${{ needs.calculate-version.outputs.version }}';
            fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\\n');
            console.log('Desktop package.json version set to:', pkg.version);
          "\
"""

# Marker: lo step che viene PRIMA del build nei job (build step)
# In ogni job c'e' uno step "Build desktop app" o simile — inseriamo prima di quello
BUILD_STEP_MARKER = "      - name: Build desktop app"


def check(repo) -> bool:
    f = repo / TARGET
    if not f.exists():
        return False
    return CHECK_STR in f.read_text(encoding="utf-8")


def apply(repo) -> None:
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")

    if CHECK_STR in text:
        return  # gia' applicata

    # Inserisci lo step prima di OGNI occorrenza di "- name: Build desktop app"
    # (ci sono piu' job: windows, mac-arm, mac-x64)
    if BUILD_STEP_MARKER not in text:
        # Fallback: cerca step di build con nome diverso
        import re
        # Cerca qualsiasi step che esegua il build effettivo
        alt_markers = [
            "      - name: Build",
            "      - name: Build Windows",
            "      - name: Build Mac",
        ]
        for marker in alt_markers:
            if marker in text:
                BUILD_STEP_MARKER_USED = marker
                break
        else:
            raise RuntimeError(
                f"{PATCH_ID}: non trovato nessun step di build in {TARGET}. "
                "Verifica manualmente il workflow."
            )
    else:
        BUILD_STEP_MARKER_USED = BUILD_STEP_MARKER

    new_text = text.replace(
        BUILD_STEP_MARKER_USED,
        INJECT_STEP + "\n" + BUILD_STEP_MARKER_USED
    )

    assert new_text != text, (
        f"{PATCH_ID}: sostituzione fallita — BUILD_STEP_MARKER non trovato in {TARGET}"
    )

    # Verifica che almeno una sostituzione sia avvenuta
    count_before = text.count(BUILD_STEP_MARKER_USED)
    count_injected = new_text.count(CHECK_STR)
    assert count_injected >= 1, (
        f"{PATCH_ID}: nessun inject avvenuto — controllare il marker nel workflow"
    )

    f.write_text(new_text, encoding="utf-8")
