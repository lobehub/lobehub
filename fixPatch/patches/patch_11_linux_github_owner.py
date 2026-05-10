r"""
PATCH 11 - Aggiunge UPDATE_GITHUB_OWNER/REPO al job build-linux nel workflow
=============================================================================
Problema:
  Il job build-windows ha gia' le env vars:
    UPDATE_GITHUB_OWNER: emaxlele
    UPDATE_GITHUB_REPO: lobehub

  Il job build-linux NON le ha. electron-builder.mjs usa il fallback:
    const githubOwner = process.env.UPDATE_GITHUB_OWNER || 'lobehub';
    const githubRepo  = process.env.UPDATE_GITHUB_REPO  || 'lobehub';

  Senza le env, il build Linux genera app-update.yml con owner: lobehub
  (repo ufficiale) invece di owner: emaxlele (nostro fork).
  Il risultato e' che l'app Linux si aggiorna dall'upstream ufficiale,
  ignorando completamente le nostre patch.

Fix:
  Aggiungere UPDATE_GITHUB_OWNER e UPDATE_GITHUB_REPO all'env del
  "Build Linux artifact" step, esattamente come gia' fatto per Windows.

Questo garantisce che entrambi i build (Windows + Linux) producano
un app-update.yml che punta esclusivamente a emaxlele/lobehub.
"""

PATCH_ID    = "patch_11_linux_github_owner"
description = "Aggiunge UPDATE_GITHUB_OWNER/REPO al job build-linux (parità con Windows)"

TARGET = ".github/workflows/emaxlele-build.yml"

CHECK_STR = "# patch_11: linux github owner"

OLD_LINUX_ENV = """      - name: Build Linux artifact
        run: npm run desktop:package:app
        env:
          UPDATE_CHANNEL: canary
          APP_URL: http://localhost:3015
          DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres'
          KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE='"""

NEW_LINUX_ENV = """      - name: Build Linux artifact
        run: npm run desktop:package:app
        env:
          UPDATE_CHANNEL: canary
          UPDATE_GITHUB_OWNER: emaxlele  # patch_11: linux github owner
          UPDATE_GITHUB_REPO: lobehub
          APP_URL: http://localhost:3015
          DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres'
          KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE='"""


def check(repo) -> bool:
    f = repo / TARGET
    if not f.exists():
        return False
    return CHECK_STR in f.read_text(encoding="utf-8")


def apply(repo) -> None:
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")

    new_text = text.replace(OLD_LINUX_ENV, NEW_LINUX_ENV, 1)
    assert new_text != text, (
        f"{PATCH_ID}: sostituzione fallita - OLD_LINUX_ENV non trovato in {TARGET}. "
        "Il job build-linux potrebbe avere una struttura diversa - verifica manualmente."
    )
    f.write_text(new_text, encoding="utf-8")
