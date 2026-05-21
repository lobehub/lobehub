import type { FollowUpModelConfig } from '@lobechat/types';
import { useCallback } from 'react';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFollowUpActionStore } from '@/store/followUpAction';
import type { OnboardingPhase } from '@/types/user';

interface UseOnboardingFollowUpParams {
  enabled: boolean;
  isGreeting: boolean;
  modelConfig: FollowUpModelConfig;
  onboardingAgentId: string | undefined;
}

interface OnboardingFollowUpHandlers {
  onBeforeSendMessage: (topicId: string) => Promise<void>;
  triggerExtract: (topicId: string, phase: OnboardingPhase | undefined) => Promise<void>;
}

export const useOnboardingFollowUp = ({
  enabled,
  isGreeting,
  modelConfig,
  onboardingAgentId,
}: UseOnboardingFollowUpParams): OnboardingFollowUpHandlers => {
  const triggerExtract = useCallback(
    async (topicId: string, phase: OnboardingPhase | undefined) => {
      if (!enabled) return;
      if (!onboardingAgentId) return;
      if (!phase) return;
      if (phase === 'summary') return;
      if (isGreeting) return;

      const conversationKey = messageMapKey({ agentId: onboardingAgentId, topicId });
      await useFollowUpActionStore.getState().fetchFor(conversationKey, {
        hint: { kind: 'onboarding', phase },
        modelConfig,
        topicId,
      });
    },
    [enabled, isGreeting, modelConfig, onboardingAgentId],
  );

  const onBeforeSendMessage = useCallback(
    async (topicId: string) => {
      if (!enabled) return;
      if (!onboardingAgentId) return;
      const conversationKey = messageMapKey({ agentId: onboardingAgentId, topicId });
      useFollowUpActionStore.getState().clear(conversationKey);
    },
    [enabled, onboardingAgentId],
  );

  return { onBeforeSendMessage, triggerExtract };
};
