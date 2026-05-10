# fixPatch/ - Patch personali emaxlele-dev

Questo tooling e' **tracciato in git** su `emaxlele/lobehub` (branch `emaxlele-dev`).
Garantisce riproducibilita': chiunque cloni il repo puo' eseguire `python fixPatch/sync.py`
per sincronizzarsi senza dover ricreare manualmente le patch.

## Uso

```bash
# Sync completo (merge canary + patch + commit + push)
C:\Python314\python.exe fixPatch\sync.py

# Dry-run (anteprima senza modifiche)
C:\Python314\python.exe fixPatch\sync.py --dry-run
```

Fa tutto in ordine:
1. **Merge** `upstream/canary` -> `emaxlele-dev`
2. **Re-applica** tutte le patch (idempotenti: skip se gia' presenti)
3. **Commit** delle patch riapplicate (o empty version-bump se HEAD == upstream)
4. **Push** `origin/emaxlele-dev` -> il build parte in automatico su GitHub Actions

## Infrastruttura condivisa - `_common.py`

Tutte le costanti (REPO, GIT) e le funzioni helper (git, git_soft, section)
sono definite in `fixPatch/_common.py`.

**Nessun path hardcoded** - tutto viene derivato automaticamente dalla posizione
del file. Se sposti il repo o cloni su un altro PC, funziona senza modifiche.

Per usare le costanti in un nuovo script:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO, GIT, git, git_soft, section
```

## Patch presenti

| File | ID | Descrizione |
|------|----|-------------|
| `patch_01_powershell_shell.py` | `patch_01` | cmd.exe -> PowerShell (risolve &&, pipe) |
| `patch_02_onboarding_next_actions.py` | `patch_02` | Stop next_actions post-onboarding (MessagesEngine) |
| `patch_03_mcp_timeout.py` | `patch_03` | MCP timeout 5s -> 60s configurabile |
| `patch_04_copilot_anyof.py` | `patch_04` | Copilot: strip anyOf/oneOf/allOf per Anthropic |
| `patch_05_autoupdater_emaxlele.py` | `patch_05` | Auto-updater punta a emaxlele/lobehub |
| `patch_06_version_scheme.py` | `patch_06` | Documenta schema versione X.Y.Z-emaxlele.N |
| `patch_07_workflow_target_commitish.py` | `patch_07` | Protegge target_commitish in emaxlele-build.yml |
| `patch_08_onboarding_finished_caller.py` | `patch_08` | Propaga finished nel onboardingContext (RuntimeExecutors) |
| `patch_09_runtime_executors_finished.py` | `patch_09` | Skip onboarding injection quando finished=true (root cause) |

## Come aggiungere una nuova patch

Crea `fixPatch/patches/patch_NN_nome.py` con questa struttura:

```python
PATCH_ID    = "patch_NN_nome"
description = "Cosa fa"

def check(repo) -> bool:
    # Ritorna True se la patch e' GIA' applicata (idempotenza).
    ...

def apply(repo):
    # Applica la patch. DEVE contenere un assert dopo ogni str.replace().
    f = repo / TARGET
    text = f.read_text(encoding="utf-8")
    new_text = text.replace(OLD, NEW, 1)
    assert new_text != text, (
        f"{PATCH_ID}: sostituzione fallita - stringa target non trovata in {TARGET}"
    )
    f.write_text(new_text, encoding="utf-8")
```

**REGOLA**: ogni `apply()` deve avere un `assert` dopo ogni `str.replace()`.
Se il replace non matcha, l'assert lancia un'eccezione con messaggio chiaro invece
di scrivere silenziosamente il file invariato.

## Tracking in git

La cartella `fixPatch/` **e' tracciata** nel repository e pushata su origin.
Questo garantisce riproducibilita': chiunque cloni il repo ha gli stessi script
di manutenzione e puo' eseguire `python fixPatch/sync.py` per sincronizzarsi.

## Logica di versioning

```
upstream canary: v2.1.58
-> nostra build:  v2.1.58-emaxlele.1, v2.1.58-emaxlele.2, ...

upstream canary: v2.1.59 (nuovo release)
-> nostra build:  v2.1.59-emaxlele.1, v2.1.59-emaxlele.2, ...
```

## Note

- Le patch sono **idempotenti**: se upstream ha gia' incluso il fix, `check()` ritorna True e la patch viene saltata automaticamente.
- Il tag di release viene creato dal workflow GitHub Actions `emaxlele-build.yml` - **sync.py NON crea tag**.
- `sync.py` garantisce un commit esclusivo su `emaxlele-dev` prima del push.
