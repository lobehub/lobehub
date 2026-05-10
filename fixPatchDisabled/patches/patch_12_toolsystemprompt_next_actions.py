PATCH_ID    = "patch_12_toolsystemprompt_next_actions"
description = "Fix toolSystemPrompt punto 3: rimuove istruzione errata su <next_actions> mandatory"

FILE_A = "packages/builtin-tool-web-onboarding/src/toolSystemRole.ts"
CHECK_A = "Follow those reminders when present."

# Il testo OLD contiene il bold ** che potrebbe variare, usiamo un check piu robusto
OLD_PATTERN = "MUST follow the tool call instructions in"

NEW_LINE = "3. Each turn during active onboarding, the system appends a `<next_actions>` block after the user's message with phase-specific tool call reminders. Follow those reminders when present. If no `<next_actions>` block appears, rely on the phase guidance in `<onboarding_context>` and your own judgment."


def check(repo):
    fa = repo / FILE_A
    if not fa.exists():
        return False
    return CHECK_A in fa.read_text(encoding="utf-8")


def apply(repo):
    fa = repo / FILE_A
    txt = fa.read_text(encoding="utf-8")
    if CHECK_A in txt:
        return  # gia applicata
    lines = txt.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if OLD_PATTERN in line:
            # Preserva il line ending
            ending = "\r\n" if line.endswith("\r\n") else "\n"
            lines[i] = NEW_LINE + ending
            break
    fa.write_text("".join(lines), encoding="utf-8")
