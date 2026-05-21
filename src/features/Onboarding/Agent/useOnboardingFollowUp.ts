import type { FollowUpModelConfig } from '@lobechat/types';
import { useMemo } from 'react';

import { type ConversationHooks } from '@/features/Conversation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFollowUpActionStore } from '@/store/followUpAction';
import type { OnboardingPhase } from '@/types/user';

interface UseOnboardingFollowUpParams {
  enabled: boolean;
  isGreeting: boolean;
  modelConfig: FollowUpModelConfig;
  onboardingAgentId: string | undefined;
  phase: OnboardingPhase | undefined;
  topicId: string | undefined;
}

export const useOnboardingFollowUp = ({
  enabled,
  isGreeting,
  modelConfig,
  onboardingAgentId,
  phase,
  topicId,
}: UseOnboardingFollowUpParams): ConversationHooks => {
  return useMemo<ConversationHooks>(() => {
    if (!enabled || !onboardingAgentId || !topicId) return {};

    const conversationKey = messageMapKey({ agentId: onboardingAgentId, topicId });
    const phaseSnapshot = phase;

    return {
      onAssistantTurnSettled: async (_messageId, { reason }) => {
        if (reason === 'stopped') return;
        if (isGreeting) return;
        if (!phaseSnapshot) return;
        if (phaseSnapshot === 'summary') return;
        await useFollowUpActionStore.getState().fetchFor(conversationKey, {
          hint: { kind: 'onboarding', phase: phaseSnapshot },
          modelConfig,
          topicId,
        });
      },
      onBeforeSendMessage: async () => {
        useFollowUpActionStore.getState().clear(conversationKey);
      },
    };
  }, [
    enabled,
    isGreeting,
    modelConfig.model,
    modelConfig.provider,
    onboardingAgentId,
    phase,
    topicId,
  ]);
};
