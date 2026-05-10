"""
PATCH 05 — Auto-updater: punta a emaxlele/lobehub (non lobehub/lobehub)
========================================================================
Corregge il fallback GitHub provider in UpdaterManager.ts:
cambia owner da 'lobehub' a 'emaxlele' e repo da 'lobehub' a 'lobehub'.

Senza questa patch l'app cerca aggiornamenti sul repo upstream ufficiale
invece che sul fork personale emaxlele/lobehub dove pubblichiamo i build.
"""

PATCH_ID    = "patch_05_autoupdater_emaxlele"
description = "Auto-updater fallback: punta a emaxlele/lobehub invece di lobehub/lobehub"

TARGET = "apps/desktop/src/main/core/infrastructure/UpdaterManager.ts"

CHECK_STR = "owner: 'emaxlele'"

OLD_FEED = (
    "      autoUpdater.setFeedURL({\n"
    "        owner: 'lobehub',\n"
    "        provider: 'github',\n"
    "        repo: 'lobehub',\n"
    "      });"
)
NEW_FEED = (
    "      autoUpdater.setFeedURL({\n"
    "        owner: 'emaxlele',\n"
    "        provider: 'github',\n"
    "        repo: 'lobehub',\n"
    "      });"
)

def check(repo):
    f = repo / TARGET
    if not f.exists():
        return False
    return CHECK_STR in f.read_text(encoding="utf-8")

def apply(repo):
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")
    new_text = text.replace(OLD_FEED, NEW_FEED, 1)
    assert new_text != text, (
        f"{PATCH_ID}: sostituzione fallita — OLD_FEED non trovato in {TARGET}"
    )
    f.write_text(new_text, encoding="utf-8")
