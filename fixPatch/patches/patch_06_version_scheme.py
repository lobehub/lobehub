"""
PATCH 06 — Schema versione emaxlele-dev
========================================
Assicura che il workflow di build usi lo schema corretto:
  canary upstream X.Y.Z → nostra versione X.Y.Z-emaxlele.N
  quando upstream passa a X.Y.(Z+1) → noi passiamo a X.Y.(Z+1)-emaxlele.1

Questo è già nel workflow emaxlele-build.yml — questa patch lo verifica
e aggiorna il commento di documentazione nel workflow per chiarezza.
Non tocca la logica (già corretta), aggiunge solo documentazione inline.
"""

PATCH_ID    = "patch_06_version_scheme"
description = "Documenta schema versione nel workflow (X.Y.Z-emaxlele.N)"

TARGET = ".github/workflows/emaxlele-build.yml"

CHECK_STR = "# Schema: upstream X.Y.Z → emaxlele X.Y.Z-emaxlele.N"

OLD_LINE = "      - name: Calculate version"
NEW_LINES = (
    "      # Schema versione:\n"
    "      #   upstream canary X.Y.Z → nostra X.Y.Z-emaxlele.1, .2, ...\n"
    "      #   quando upstream passa a X.Y.(Z+1) → ricominciamo da X.Y.(Z+1)-emaxlele.1\n"
    "      # Schema: upstream X.Y.Z → emaxlele X.Y.Z-emaxlele.N\n"
    "      - name: Calculate version"
)

def check(repo):
    f = repo / TARGET
    if not f.exists():
        return False
    return CHECK_STR in f.read_text(encoding="utf-8")

def apply(repo):
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")
    new_text = text.replace(OLD_LINE, NEW_LINES, 1)
    assert new_text != text, (
        f"{PATCH_ID}: sostituzione fallita — OLD_LINE non trovato in {TARGET}"
    )
    f.write_text(new_text, encoding="utf-8")
