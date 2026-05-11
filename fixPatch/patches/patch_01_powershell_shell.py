"""
PATCH 01 — Cross-platform shell: expandEnvVars + EncodedCommand
===============================================================
Due fix combinati che rendono runCommand shell-agnostic:

1. getShellConfig (utils.ts):
   Sostituisce powershell.exe -Command con -EncodedCommand (UTF-16LE -> Base64)
   per bypassare completamente il tokenizer CRT di Windows e il quoting hell.

2. expandEnvVars (utils.ts + runner.ts):
   Pre-espande %VAR%, $env:VAR, $VAR, ${VAR} in Node.js prima che il comando
   tocchi qualsiasi shell. Tutti e tre i formati funzionano su qualsiasi OS.

Risolve:
- %USERPROFILE% non espanso da PowerShell
- $env:VAR non espanso da bash/sh
- Path con spazi e backslash spezzati dal CRT di Windows
- windowsVerbatimArguments rimosso (non piu' necessario)

PR upstream: https://github.com/lobehub/lobehub/pull/14697
"""

PATCH_ID    = "patch_01_powershell_shell"
description = "Cross-platform shell: expandEnvVars + -EncodedCommand (risolve %VAR%, $env:, $HOME su qualsiasi shell)"

UTILS  = "packages/local-file-shell/src/shell/utils.ts"
RUNNER = "packages/local-file-shell/src/shell/runner.ts"

# Stringhe di check per sapere se la patch e' applicata
ENCODED_CMD_MARKER  = "'-EncodedCommand', encoded"
EXPAND_VARS_MARKER  = "export const expandEnvVars"
RUNNER_IMPORT_MARKER = "import { expandEnvVars, getShellConfig"

def check(repo):
    utils_text  = (repo / UTILS).read_text(encoding="utf-8")
    runner_text = (repo / RUNNER).read_text(encoding="utf-8")
    return (
        ENCODED_CMD_MARKER  in utils_text and
        EXPAND_VARS_MARKER  in utils_text and
        RUNNER_IMPORT_MARKER in runner_text
    )

def apply(repo):
    import re

    # ── utils.ts ─────────────────────────────────────────────────────────────
    utils_path = repo / UTILS
    text = utils_path.read_text(encoding="utf-8")

    # 1. getShellConfig -> -EncodedCommand
    pattern_shell = r'export const getShellConfig = \(command: string\).*?^};'
    NEW_SHELL_CONFIG = (
        "export const getShellConfig = (command: string) => {\n"
        "  if (process.platform === 'win32') {\n"
        "    // Encode as UTF-16LE -> Base64 to completely bypass Windows\n"
        "    // command-line tokenization and CRT argv[] parsing.\n"
        "    // PowerShell decodes -EncodedCommand internally - no quoting issues,\n"
        "    // no backslash escape ambiguity, no space-in-path splitting.\n"
        "    const encoded = Buffer.from(command, 'utf16le').toString('base64');\n"
        "    return {\n"
        "      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],\n"
        "      cmd: 'powershell.exe',\n"
        "    };\n"
        "  }\n"
        "  return { args: ['-c', command], cmd: '/bin/sh' };\n"
        "};"
    )
    m = re.search(pattern_shell, text, re.DOTALL | re.MULTILINE)
    assert m, f"{PATCH_ID}: getShellConfig non trovato in {UTILS}"
    text = text[:m.start()] + NEW_SHELL_CONFIG + text[m.end():]

    # 2. aggiungi expandEnvVars prima di isWindows (o in fondo)
    if EXPAND_VARS_MARKER not in text:
        EXPAND_FN = (
            "\n"
            "/**\n"
            " * Pre-expand environment variable references in a command string using\n"
            " * Node.js process.env - shell-agnostic and cross-platform.\n"
            " *\n"
            " * Handles all three common syntaxes:\n"
            " *   %VAR%         -> Windows cmd style\n"
            " *   $env:VAR      -> PowerShell style\n"
            " *   $VAR / ${VAR} -> Unix bash/sh style\n"
            " *\n"
            " * Unknown variables are left as-is (no substitution).\n"
            " */\n"
            "export const expandEnvVars = (command: string): string => {\n"
            "  const replace = (name: string, original: string): string =>\n"
            "    process.env[name] ?? original;\n"
            "\n"
            "  // %VAR% - Windows cmd\n"
            "  let result = command.replace(/%([^%]+)%/g, (match, name) => replace(name, match));\n"
            "  // $env:VAR - PowerShell\n"
            "  result = result.replace(/\\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => replace(name, match));\n"
            "  // ${VAR} - Unix braced\n"
            "  result = result.replace(/\\$\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g, (match, name) => replace(name, match));\n"
            "  // $VAR - Unix unbraced (uppercase + underscore only to avoid false positives)\n"
            "  result = result.replace(/\\$([A-Z_][A-Z0-9_]*)/g, (match, name) => replace(name, match));\n"
            "  return result;\n"
            "};\n"
        )
        anchor = "/**\n * Returns true when running on Windows"
        if anchor in text:
            text = text.replace(anchor, EXPAND_FN + "\n" + anchor)
        else:
            text = text + "\n" + EXPAND_FN

    utils_path.write_text(text, encoding="utf-8")

    # ── runner.ts ────────────────────────────────────────────────────────────
    runner_path = repo / RUNNER
    rtext = runner_path.read_text(encoding="utf-8")

    # import
    if RUNNER_IMPORT_MARKER not in rtext:
        rtext = rtext.replace(
            "import { getShellConfig, truncateOutput } from './utils';",
            "import { expandEnvVars, getShellConfig, truncateOutput } from './utils';"
        )

    # chiamata
    if "expandedCommand" not in rtext:
        rtext = rtext.replace(
            "  const shellConfig = getShellConfig(command);",
            "  const expandedCommand = expandEnvVars(command);\n  const shellConfig = getShellConfig(expandedCommand);"
        )

    # rimuovi windowsVerbatimArguments
    verbatim_pattern = (
        r"\s*// On Windows, cmd\.exe /c requires verbatim args.*?\n"
        r"\s*// Without this flag.*?\n"
        r"\s*// like.*?\n"
        r"\s*\.\.\.\(os\.platform\(\) === 'win32' && \{ windowsVerbatimArguments: true \}\),\n"
    )
    rtext = re.sub(verbatim_pattern, "\n", rtext, flags=re.DOTALL)

    # rimuovi import os se non piu' usato
    if "os.platform()" not in rtext and "import os from 'node:os';" in rtext:
        rtext = rtext.replace("import os from 'node:os';\n", "")

    runner_path.write_text(rtext, encoding="utf-8")
