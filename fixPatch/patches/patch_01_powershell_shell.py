"""
PATCH 01 — PowerShell shell su Windows
======================================
Sostituisce cmd.exe /c con powershell.exe -NonInteractive -Command
in packages/local-file-shell/src/shell/utils.ts

Risolve: && operators, pipe, $env:, path quotati su Windows.
PR upstream: da aprire
"""

PATCH_ID    = "patch_01_powershell_shell"
description = "Switch Windows shell: cmd.exe → PowerShell (risolve &&, pipe, $env:)"

TARGET = "packages/local-file-shell/src/shell/utils.ts"

EXPECTED_BROKEN = "{ args: ['/c', command], cmd: 'cmd.exe' }"
EXPECTED_FIXED  = "{ args: ['-NoProfile', '-NonInteractive', '-Command', command], cmd: 'powershell.exe' }"

def check(repo):
    f = repo / TARGET
    if not f.exists():
        return False
    return EXPECTED_FIXED in f.read_text(encoding="utf-8")

def apply(repo):
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")
    new = text.replace(
        "{ args: ['/c', command], cmd: 'cmd.exe' }",
        "{ args: ['-NoProfile', '-NonInteractive', '-Command', command], cmd: 'powershell.exe' }"
    )
    assert new != text, (
        f"{PATCH_ID}: sostituzione fallita — stringa target non trovata in {TARGET}"
    )
    f.write_text(new, encoding="utf-8")
