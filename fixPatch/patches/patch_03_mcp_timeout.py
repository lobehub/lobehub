"""
PATCH 03 — MCP stdio pre-check timeout configurabile (default 60s)
===================================================================
Sostituisce il timeout hardcoded 5000ms con MCP_STARTUP_TIMEOUT env var
in src/libs/mcp/client.ts

Risolve: npx/bunx scaricano il pacchetto al primo avvio (15-60s) e
il pre-check scadeva sempre con INITIALIZATION_TIMEOUT.
PR upstream: #14581 (OPEN)
"""

PATCH_ID    = "patch_03_mcp_timeout"
description = "MCP stdio timeout: 5s hardcoded → 60s configurabile via MCP_STARTUP_TIMEOUT"

TARGET = "src/libs/mcp/client.ts"

CHECK_STR = "MCP_STARTUP_TIMEOUT"

# Cerca il timeout hardcoded 5000 nel contesto del pre-check
OLD_TIMEOUT = "}, 5000);"
NEW_TIMEOUT = (
    "// Pre-check startup timeout: configurable via MCP_STARTUP_TIMEOUT env var.\n"
    "    // Default 60s to allow npx/bunx to download the package on first run.\n"
    "    const _mcpStartupTimeout = (() => {\n"
    "      const v = Number(process.env.MCP_STARTUP_TIMEOUT);\n"
    "      return Number.isFinite(v) && v > 0 ? v : 60_000;\n"
    "    })();\n"
    "    }, _mcpStartupTimeout);"
)

def check(repo):
    f = repo / TARGET
    if not f.exists():
        return False
    return CHECK_STR in f.read_text(encoding="utf-8")

def apply(repo):
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")
    # Sostituisce solo la prima occorrenza (il pre-check, non altri timeout)
    new_text = text.replace(OLD_TIMEOUT, NEW_TIMEOUT, 1)
    assert new_text != text, (
        f"{PATCH_ID}: sostituzione fallita — OLD_TIMEOUT non trovato in {TARGET}"
    )
    f.write_text(new_text, encoding="utf-8")
