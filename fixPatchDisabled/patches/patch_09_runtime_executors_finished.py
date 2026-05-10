r"""
patch_09_runtime_executors_finished.py
---------------------------------------
Fix: skip onboarding context injection when onboardingState.finished === true

Real root cause: isOnboardingAgent is true for any agent that has 'lobe-web-onboarding'
in its enabled tools (e.g. the Supervisor). This means onboardingContext was built and
injected unconditionally, regardless of the finished flag.

Fix: call onboardingService.getState() FIRST, before the expensive imports/Promise.all,
and skip the entire context build if finished === true.

OLD pattern matches the file after patch_08 (which added `finished` at the top of the
onboardingContext object literal with a comment).
"""

from pathlib import Path

PATCH_ID    = "patch_09_runtime_executors_finished"
description = "Skip onboarding context injection when finished=true (RuntimeExecutors — real root cause)"

TARGET = Path("src") / "server" / "modules" / "AgentRuntime" / "RuntimeExecutors.ts"

OLD = """\
        if (isOnboardingAgent && !alreadyHasOnboardingContext && ctx.serverDB && ctx.userId) {
          try {
            const { formatWebOnboardingStateMessage } =
              await import('@lobechat/builtin-tool-web-onboarding/utils');
            const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
            const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
            const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
            const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

            const [onboardingState, soulDoc, persona, userInfo] = await Promise.all([
              onboardingService.getState(),
              onboardingService
                .getInboxAgentId()
                .then((inboxAgentId) =>
                  inboxAgentId ? docService.getDocumentByFilename(inboxAgentId, 'SOUL.md') : null,
                )
                .catch((error) => {
                  log('Failed to fetch SOUL.md for onboarding context: %O', error);
                  return null;
                }),
              personaModel.getLatestPersonaDocument().catch((error) => {
                log('Failed to fetch user persona for onboarding context: %O', error);
                return null;
              }),
              onboardingService.getInitialUserInfo().catch((error) => {
                log('Failed to fetch initial user info for onboarding context: %O', error);
                return undefined;
              }),
            ]);

            onboardingContext = {
              // patch_08: propagate finished so MessagesEngine injectors can gate on it
              finished: onboardingState.finished,
              personaContent: persona?.persona ?? null,
              phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
              soulContent: soulDoc?.content ?? null,
              userInfo,
            };
            log('Built onboarding context for agent %s, phase: %s', agentId, onboardingState.phase);
          } catch (error) {
            log('Failed to build onboarding context: %O', error);
          }
        }\
"""

NEW = """\
        if (isOnboardingAgent && !alreadyHasOnboardingContext && ctx.serverDB && ctx.userId) {
          try {
            const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
            const onboardingState = await onboardingService.getState();

            if (onboardingState.finished) {
              log('Onboarding already finished, skipping context injection for agent %s', agentId);
            } else {
              const { formatWebOnboardingStateMessage } =
                await import('@lobechat/builtin-tool-web-onboarding/utils');
              const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
              const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
              const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

              const [soulDoc, persona, userInfo] = await Promise.all([
                onboardingService
                  .getInboxAgentId()
                  .then((inboxAgentId) =>
                    inboxAgentId ? docService.getDocumentByFilename(inboxAgentId, 'SOUL.md') : null,
                  )
                  .catch((error) => {
                    log('Failed to fetch SOUL.md for onboarding context: %O', error);
                    return null;
                  }),
                personaModel.getLatestPersonaDocument().catch((error) => {
                  log('Failed to fetch user persona for onboarding context: %O', error);
                  return null;
                }),
                onboardingService.getInitialUserInfo().catch((error) => {
                  log('Failed to fetch initial user info for onboarding context: %O', error);
                  return undefined;
                }),
              ]);

              onboardingContext = {
                finished: false,
                personaContent: persona?.persona ?? null,
                phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
                soulContent: soulDoc?.content ?? null,
                userInfo,
              };
              log('Built onboarding context for agent %s, phase: %s', agentId, onboardingState.phase);
            }
          } catch (error) {
            log('Failed to build onboarding context: %O', error);
          }
        }\
"""


def check(repo: Path) -> bool:
    f = repo / TARGET
    if not f.exists():
        return False
    content = f.read_text(encoding="utf-8")
    if "if (onboardingState.finished)" in content and \
       "skipping context injection" in content:
        return True
    if OLD not in content:
        return True
    return False


def apply(repo: Path) -> None:
    f = repo / TARGET
    content = f.read_text(encoding="utf-8")
    count = content.count(OLD)
    if count != 1:
        raise RuntimeError(
            f"patch_09: expected exactly 1 occurrence of OLD pattern, found {count}. "
            "Manual review required."
        )
    modified = content.replace(OLD, NEW, 1)
    f.write_text(modified, encoding="utf-8")
    print("    patch_09: finished guard added at source level — injection skipped when finished=true")
