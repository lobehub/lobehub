import { formatWebOnboardingStateMessage } from '@lobechat/builtin-tool-web-onboarding/utils';
import type { OnboardingContext } from '@lobechat/context-engine';

import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { OnboardingService } from '@/server/services/onboarding';

import type { ServerContextFactInput } from './types';

/**
 * Persona, SOUL document and initial user info for the onboarding agent.
 *
 * Personal profile data with no share permission that could ever grant it, so
 * a share visitor run never builds it. Two paths reach here: the builtin
 * `web-onboarding` agent, and any shared agent whose enabled tools include
 * `lobe-web-onboarding`. Gating on `ctx.agentShareVisitor` closes both.
 */
export const resolveOnboardingContextFacts = async ({
  agentId,
  ctx,
  enabledToolIds,
  messagesForContext,
  state,
  workspaceId,
}: ServerContextFactInput): Promise<OnboardingContext | undefined> => {
  const isOnboardingAgent =
    state.world?.agent?.slug === 'web-onboarding' || enabledToolIds.includes('lobe-web-onboarding');
  if (!isOnboardingAgent || ctx.agentShareVisitor || !ctx.serverDB || !ctx.userId) {
    return undefined;
  }

  const alreadyHasOnboardingContext = (
    messagesForContext as Array<{ content: string | unknown }>
  ).some((message) => {
    if (typeof message.content !== 'string') return false;

    return (
      message.content.includes('<onboarding_context>') ||
      message.content.includes('<current_soul_document>') ||
      message.content.includes('<current_user_persona>')
    );
  });
  if (alreadyHasOnboardingContext) return undefined;

  try {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
    const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId, workspaceId);
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

    log('Built onboarding context for agent %s, phase: %s', agentId, onboardingState.phase);
    return {
      discoveryUserMessageCount: onboardingState.discoveryUserMessageCount,
      personaContent: persona?.persona ?? null,
      phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
      remainingDiscoveryExchanges: onboardingState.remainingDiscoveryExchanges,
      soulContent: soulDoc?.content ?? null,
      userInfo,
    };
  } catch (error) {
    log('Failed to build onboarding context: %O', error);
    return undefined;
  }
};
