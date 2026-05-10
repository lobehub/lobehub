"""
PATCH 07 — Protegge emaxlele-build.yml: target_commitish obbligatorio
======================================================================
Garantisce che `softprops/action-gh-release` nel workflow abbia sempre
`target_commitish: ${{ github.sha }}`.

Senza questo campo, GitHub crea il tag di release sul default branch del
repo (canary) invece che sul commit di emaxlele-dev che ha triggerato il
workflow. Conseguenza: tutti i tag -emaxlele.N atterrano sul merge commit
upstream, il build viene compilato da quel commit (senza le nostre patch)
e tutti i fix risultano assenti nel binario finale.

Questa patch viene re-applicata ad ogni run di sync.py (step 2), quindi
anche se una futura merge o modifica manuale rimuovesse la riga, viene
ripristinata automaticamente.

Root cause documentata: bug scoperto 2026-05-10, tutti i tag da
v2.1.58-emaxlele.1 a .4 erano su origin/canary invece di emaxlele-dev.
"""

PATCH_ID    = "patch_07_workflow_target_commitish"
description = "Protegge target_commitish in emaxlele-build.yml (anti-regressione tag)"

TARGET = ".github/workflows/emaxlele-build.yml"

CHECK_STR = "target_commitish: ${{ github.sha }}"

# Blocco senza target_commitish (da rimpiazzare)
OLD = (
    "      - name: Create GitHub Release\n"
    "        uses: softprops/action-gh-release@v1\n"
    "        with:\n"
    "          tag_name: ${{ needs.calculate-version.outputs.tag }}\n"
    "          name: 'emaxlele-dev ${{ needs.calculate-version.outputs.tag }}'"
)

# Blocco con target_commitish (forma corretta)
NEW = (
    "      - name: Create GitHub Release\n"
    "        uses: softprops/action-gh-release@v1\n"
    "        with:\n"
    "          tag_name: ${{ needs.calculate-version.outputs.tag }}\n"
    "          target_commitish: ${{ github.sha }}\n"
    "          name: 'emaxlele-dev ${{ needs.calculate-version.outputs.tag }}'"
)


def check(repo):
    f = repo / TARGET
    if not f.exists():
        return False
    return CHECK_STR in f.read_text(encoding="utf-8")


def apply(repo):
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")
    if OLD in text:
        new_text = text.replace(OLD, NEW, 1)
        assert new_text != text, (
            f"{PATCH_ID}: sostituzione OLD fallita in {TARGET} anche se OLD trovato"
        )
        f.write_text(new_text, encoding="utf-8")
    elif CHECK_STR not in text:
        # Fallback: cerca la firma generica e inserisce la riga dopo tag_name
        marker = "          tag_name: ${{ needs.calculate-version.outputs.tag }}\n"
        inject = "          target_commitish: ${{ github.sha }}\n"
        if marker in text and inject not in text:
            new_text = text.replace(marker, marker + inject, 1)
            assert new_text != text, (
                f"{PATCH_ID}: fallback inject fallito in {TARGET}"
            )
            f.write_text(new_text, encoding="utf-8")
        elif marker not in text:
            print(f"    [WARN] {PATCH_ID}: marker tag_name non trovato in {TARGET} — verifica manuale")
