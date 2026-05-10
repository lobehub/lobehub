r"""
PATCH 02 — Stop injection <next_actions> dopo onboarding completato
===================================================================
Root cause REALE (trovata 2026-05-10 leggendo MessagesEngine.ts):

  In MessagesEngine.buildProcessors() sia OnboardingActionHintInjector
  che OnboardingSyntheticStateInjector vengono istanziati con:

    enabled: !!onboardingContext?.phaseGuidance

  Il problema: phaseGuidance viene costruito dal caller anche quando
  onboarding è finished=true. Quindi enabled=true anche a onboarding
  completato => il blocco <next_actions> viene iniettato in OGNI
  conversazione, non solo durante l'onboarding.

Fix in DUE file:

  FILE A — OnboardingContextInjector.ts:
    Aggiunge `finished?: boolean` all'interfaccia OnboardingContext.
    Senza questo campo TypeScript non accetta il campo e il caller
    non può mai passarlo.

  FILE B — MessagesEngine.ts:
    Cambia la condizione enabled per entrambi gli injector:
      DA: enabled: !!onboardingContext?.phaseGuidance
      A:  enabled: !!onboardingContext?.phaseGuidance && !onboardingContext?.finished

    Questo è il vero fix: quando il caller passa finished=true,
    gli injector vengono disabilitati a monte, indipendentemente
    da phaseGuidance.

PR upstream: #14579 (OPEN) — da aggiornare con questo fix esteso.
"""

PATCH_ID    = "patch_02_onboarding_next_actions"
description = "Stop <next_actions> post-onboarding — fix MessagesEngine enabled condition"

# ── FILE A: interfaccia ─────────────────────────────────────────────────────

FILE_A   = "packages/context-engine/src/providers/OnboardingContextInjector.ts"
CHECK_A  = "finished?: boolean;"

OLD_A = """export interface OnboardingContext {
  /** User persona document content (markdown) */
  personaContent?: string | null;"""

NEW_A = """export interface OnboardingContext {
  /** Whether onboarding has been completed — when true, all injectors must skip */
  finished?: boolean;
  /** User persona document content (markdown) */
  personaContent?: string | null;"""

# ── FILE B: MessagesEngine — OnboardingActionHintInjector ──────────────────

FILE_B    = "packages/context-engine/src/engine/messages/MessagesEngine.ts"
CHECK_B   = "!onboardingContext?.finished"

OLD_B_HINT = """      // Onboarding action hints (phase-specific tool call reminders)
      new OnboardingActionHintInjector({
        enabled: !!onboardingContext?.phaseGuidance,
        onboardingContext,
      }),"""

NEW_B_HINT = """      // Onboarding action hints (phase-specific tool call reminders)
      // patch_02: disabled when finished=true so <next_actions> stops after onboarding
      new OnboardingActionHintInjector({
        enabled: !!onboardingContext?.phaseGuidance && !onboardingContext?.finished,
        onboardingContext,
      }),"""

OLD_B_SYNTH = """      // Onboarding synthetic state (fake getOnboardingState tool call pair to drive action loop)
      new OnboardingSyntheticStateInjector({
        enabled: !!onboardingContext?.phaseGuidance,
        onboardingContext,
      }),"""

NEW_B_SYNTH = """      // Onboarding synthetic state (fake getOnboardingState tool call pair to drive action loop)
      // patch_02: disabled when finished=true
      new OnboardingSyntheticStateInjector({
        enabled: !!onboardingContext?.phaseGuidance && !onboardingContext?.finished,
        onboardingContext,
      }),"""


def check(repo):
    fa = repo / FILE_A
    fb = repo / FILE_B
    if not fa.exists() or not fb.exists():
        return False
    a_ok = CHECK_A in fa.read_text(encoding="utf-8")
    b_ok = CHECK_B in fb.read_text(encoding="utf-8")
    return a_ok and b_ok


def apply(repo):
    # ── FILE A: aggiungi finished all'interfaccia ──────────────────────────
    fa = repo / FILE_A
    text = fa.read_text(encoding="utf-8")
    if CHECK_A not in text:
        if OLD_A in text:
            fa.write_text(text.replace(OLD_A, NEW_A, 1), encoding="utf-8")
        else:
            # fallback: inserisci dopo la riga di apertura dell'interfaccia
            marker = "export interface OnboardingContext {"
            if marker in text:
                inject = (
                    "\n  /** Whether onboarding has been completed"
                    " — when true, all injectors must skip */\n"
                    "  finished?: boolean;"
                )
                text = text.replace(marker, marker + inject, 1)
                fa.write_text(text, encoding="utf-8")

    # ── FILE B: gate enabled su !finished ─────────────────────────────────
    fb = repo / FILE_B
    text = fb.read_text(encoding="utf-8")

    # patch_02: assert on primary replaces (fallback regex below handles upstream changes)
    if OLD_B_HINT in text:
        new_text = text.replace(OLD_B_HINT, NEW_B_HINT, 1)
        assert new_text != text, f"{PATCH_ID}: sostituzione OLD_B_HINT fallita in {FILE_B}"
        text = new_text
    if OLD_B_SYNTH in text:
        new_text = text.replace(OLD_B_SYNTH, NEW_B_SYNTH, 1)
        assert new_text != text, f"{PATCH_ID}: sostituzione OLD_B_SYNTH fallita in {FILE_B}"
        text = new_text

    # fallback se canary ha già riscritto i blocchi in forma diversa
    if CHECK_B not in text:
        # cerca le righe enabled delle due classi e aggiunge il gate
        import re
        text = re.sub(
            r"(new OnboardingActionHintInjector\(\{\s*\n\s*enabled: )(!!onboardingContext\?\.phaseGuidance)(,)",
            r"\1\2 && !onboardingContext?.finished\3",
            text,
        )
        text = re.sub(
            r"(new OnboardingSyntheticStateInjector\(\{\s*\n\s*enabled: )(!!onboardingContext\?\.phaseGuidance)(,)",
            r"\1\2 && !onboardingContext?.finished\3",
            text,
        )

    fb.write_text(text, encoding="utf-8")
