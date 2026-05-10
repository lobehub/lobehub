PATCH_ID    = "patch_09_onboarding_finished_propagation"
description = "Fix <next_actions> post-onboarding: propaga finished nel return di getOnboardingAgentContext"

FILE_A = "src/server/routers/lambda/user.ts"
CHECK_A = "finished: state.finished,"

FILE_B = "src/services/user/index.ts"
CHECK_B = "finished?: boolean;"


def check(repo):
    fa = repo / FILE_A
    fb = repo / FILE_B
    if not fa.exists() or not fb.exists():
        return False
    return CHECK_A in fa.read_text(encoding="utf-8") and CHECK_B in fb.read_text(encoding="utf-8")


def apply(repo):
    import re

    # FILE A: inserisci finished: state.finished, subito dopo `    return {` nel contesto getOnboardingAgentContext
    fa = repo / FILE_A
    txt = fa.read_text(encoding="utf-8")
    lines = txt.splitlines(keepends=True)
    if CHECK_A not in txt:
        for i, line in enumerate(lines):
            if "    return {" in line and i + 1 < len(lines) and "personaContent" in lines[i + 1]:
                nl = "      finished: state.finished,\r\n" if line.endswith("\r\n") else "      finished: state.finished,\n"
                lines.insert(i + 1, nl)
                break
        fa.write_text("".join(lines), encoding="utf-8")

    # FILE B: inserisci finished?: boolean; come prima proprieta del tipo
    fb = repo / FILE_B
    txt = fb.read_text(encoding="utf-8")
    lines = txt.splitlines(keepends=True)
    if CHECK_B not in txt:
        for i, line in enumerate(lines):
            if "getOnboardingAgentContext = async (): Promise<{" in line:
                nl = "    finished?: boolean;\r\n" if line.endswith("\r\n") else "    finished?: boolean;\n"
                lines.insert(i + 1, nl)
                break
        fb.write_text("".join(lines), encoding="utf-8")
