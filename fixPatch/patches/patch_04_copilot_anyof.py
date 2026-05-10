"""
PATCH 04 — GitHub Copilot: strip anyOf/oneOf/allOf dai tool schema
===================================================================
Verifica che stripCompositionKeywords sia presente nel provider githubCopilot.
La funzione rimuove anyOf/oneOf/allOf non supportati da Anthropic.

Risolve: modelli Anthropic su GitHub Copilot provider non funzionano.
PR upstream: #14572 (OPEN)

NOTA: canary ha già applicato questa fix con il nome stripCompositionKeywords.
      Questa patch verifica l'idempotenza e se mancasse la riapplica.
"""

PATCH_ID    = "patch_04_copilot_anyof"
description = "Copilot provider: verifica strip anyOf/oneOf/allOf (stripCompositionKeywords)"

TARGET = "packages/model-runtime/src/providers/githubCopilot/index.ts"

# Check string — presente se la patch è applicata (sia nome vecchio che nuovo)
CHECK_STRINGS = ["stripCompositionKeywords", "stripAnyOfFromSchema"]

INJECT_BEFORE = "// Singleton token manager"
INJECT_CODE = (
    "/**\n"
    " * Strip JSON Schema composition keywords (anyOf/oneOf/allOf).\n"
    " * Mirrors the handleSchema sanitizer used by Groq and xAI providers.\n"
    " */\n"
    "const stripCompositionKeywords = (schema: unknown): unknown => {\n"
    "  if (typeof schema !== 'object' || schema === null) return schema;\n"
    "  if (Array.isArray(schema)) return schema.map(stripCompositionKeywords);\n"
    "  const DISALLOWED = new Set(['anyOf', 'oneOf', 'allOf']);\n"
    "  const result: Record<string, unknown> = {};\n"
    "  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {\n"
    "    if (DISALLOWED.has(key)) continue;\n"
    "    result[key] = stripCompositionKeywords(value);\n"
    "  }\n"
    "  return result;\n"
    "};\n\n"
    "// Singleton token manager"
)

def check(repo):
    f = repo / TARGET
    if not f.exists():
        return False
    text = f.read_text(encoding="utf-8")
    return any(s in text for s in CHECK_STRINGS)

def apply(repo):
    f = repo / TARGET
    if not f.exists():
        print(f"    [WARN] File non trovato: {TARGET} — skip")
        return
    text = f.read_text(encoding="utf-8")
    # Se INJECT_BEFORE è presente ma la funzione manca, inseriscila prima
    if INJECT_BEFORE in text and not any(s in text for s in CHECK_STRINGS):
        new_text = text.replace(INJECT_BEFORE, INJECT_CODE, 1)
        assert new_text != text, (
            f"{PATCH_ID}: inject fallito — INJECT_BEFORE presente ma replace non ha prodotto diff in {TARGET}"
        )
        f.write_text(new_text, encoding="utf-8")
    elif not any(s in text for s in CHECK_STRINGS) and INJECT_BEFORE not in text:
        print(f"    [WARN] {PATCH_ID}: INJECT_BEFORE non trovato in {TARGET} — upstream potrebbe aver rinominato il marker. Verifica manuale richiesta.")
