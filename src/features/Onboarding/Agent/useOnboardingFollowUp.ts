import type { FollowUpModelConfig } from '@lobechat/types';
import { useCallback } from 'react';

import { useFollowUpActionStore } from '@/store/followUpAction';
import type { OnboardingPhase } from '@/types/user';

interface UseOnboardingFollowUpParams {
  enabled: boolean;
  isGreeting: boolean;
  modelConfig: FollowUpModelConfig;
}

interface OnboardingFollowUpHandlers {
  onBeforeSendMessage: () => Promise<void>;
  triggerExtract: (topicId: string, phase: OnboardingPhase | undefined) => Promise<void>;
}

export const useOnboardingFollowUp = ({
  enabled,
  isGreeting,
  modelConfig,
}: UseOnboardingFollowUpParams): OnboardingFollowUpHandlers => {
  const triggerExtract = useCallback(
    async (topicId: string, phase: OnboardingPhase | undefined) => {
      if (!enabled) return;
      if (!phase) return;
      if (phase === 'summary') return;
      if (isGreeting) return;

      await useFollowUpActionStore.getState().fetchFor(topicId, {
        hint: { kind: 'onboarding', phase },
        modelConfig,
      });
    },
    [enabled, isGreeting, modelConfig],
  );

  const onBeforeSendMessage = useCallback(async () => {
    if (!enabled) return;
    useFollowUpActionStore.getState().clear();
  }, [enabled]);

  return { onBeforeSendMessage, triggerExtract };
};
