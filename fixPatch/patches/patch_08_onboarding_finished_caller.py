r"""
PATCH 08 — Pass onboardingState.finished to onboardingContext in RuntimeExecutors.ts
=======================================================================================
Root cause (trovata 2026-05-10 leggendo RuntimeExecutors.ts):

  In `createRuntimeExecutors` → `call_llm` executor, il blocco che costruisce
  `onboardingContext` NON passa il campo `finished` dal risultato di
  `onboardingService.getState()`:

    onboardingContext = {
      personaContent: persona?.persona ?? null,
      phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
      soulContent: soulDoc?.content ?? null,
      userInfo,
    };

  Poiché `onboardingState.finished` è disponibile (ritornato da `getState()`)
  ma NON viene propagato, `onboardingContext.finished` è sempre `undefined`,
  quindi `!onboardingContext?.finished` in MessagesEngine è sempre `true`,
  e gli injector restano abilitati anche dopo onboarding completato.

Fix: aggiungere `finished: onboardingState.finished` all'oggetto.

File: src/server/modules/AgentRuntime/RuntimeExecutors.ts
PR upstream: aggiornare PR #14579 con questo fix aggiuntivo.
"""

PATCH_ID    = "patch_08_onboarding_finished_caller"
description = "Pass onboardingState.finished to onboardingContext in RuntimeExecutors"

FILE        = "src/server/modules/AgentRuntime/RuntimeExecutors.ts"
CHECK       = "finished: onboardingState.finished,"

OLD_CONTEXT = """            onboardingContext = {
              personaContent: persona?.persona ?? null,
              phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
              soulContent: soulDoc?.content ?? null,
              userInfo,
            };"""

NEW_CONTEXT = """            onboardingContext = {
              // patch_08: propagate finished so MessagesEngine injectors can gate on it
              finished: onboardingState.finished,
              personaContent: persona?.persona ?? null,
              phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
              soulContent: soulDoc?.content ?? null,
              userInfo,
            };"""


def check(repo):
    f = repo / FILE
    if not f.exists():
        return False
    text = f.read_text(encoding="utf-8")
    # patch_08 is considered applied if either:
    # (a) our specific CHECK marker is present (we applied patch_08 directly), OR
    # (b) patch_09 is applied (which supersedes patch_08 with a more complete fix)
    #     patch_09 adds 'if (onboardingState.finished)' guard at source level
    if CHECK in text:
        return True
    if "if (onboardingState.finished)" in text and "skipping context injection" in text:
        return True  # patch_09 supersedes patch_08 — effectively applied
    return False


def apply(repo):
    f = repo / FILE
    text = f.read_text(encoding="utf-8")
    if CHECK in text:
        return  # già applicata

    if OLD_CONTEXT in text:
        new_text = text.replace(OLD_CONTEXT, NEW_CONTEXT, 1)
        assert new_text != text, (
            f"{PATCH_ID}: sostituzione OLD_CONTEXT fallita in {FILE} anche se OLD_CONTEXT trovato"
        )
        f.write_text(new_text, encoding="utf-8")
    else:
        # Fallback regex: trova l'assegnazione onboardingContext = { ... }
        # nel blocco isOnboardingAgent e inserisce finished come primo campo
        import re
        pattern = re.compile(
            r'(onboardingContext\s*=\s*\{)\s*\n'
            r'(\s+personaContent:)',
            re.MULTILINE,
        )
        replacement = (
            r'\1\n'
            r'              // patch_08: propagate finished so MessagesEngine injectors can gate on it\n'
            r'              finished: onboardingState.finished,\n'
            r'\2'
        )
        new_text, n = pattern.subn(replacement, text)
        if n > 0:
            f.write_text(new_text, encoding="utf-8")
        else:
            raise RuntimeError(
                "patch_08: cannot find onboardingContext assignment to patch — "
                "please inspect RuntimeExecutors.ts manually"
            )
