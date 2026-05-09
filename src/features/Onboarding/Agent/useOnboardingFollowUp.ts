import { useCallback } from 'react';

import { useFollowUpActionStore } from '@/store/followUpAction';
import type { OnboardingPhase } from '@/types/user';

interface UseOnboardingFollowUpParams {
  enabled: boolean;
  isGreeting: boolean;
}

interface OnboardingFollowUpHandlers {
  onBeforeSendMessage: () => Promise<void>;
  triggerExtract: (topicId: string, phase: OnboardingPhase | undefined) => Promise<void>;
}

export const useOnboardingFollowUp = ({
  enabled,
  isGreeting,
}: UseOnboardingFollowUpParams): OnboardingFollowUpHandlers => {
  const triggerExtract = useCallback(
    async (topicId: string, phase: OnboardingPhase | undefined) => {
      if (!enabled) return;
      if (!phase) return;
      if (phase === 'summary') return;
      if (isGreeting) return;

      await useFollowUpActionStore.getState().fetchFor(topicId, { kind: 'onboarding', phase });
    },
    [enabled, isGreeting],
  );

  const onBeforeSendMessage = useCallback(async () => {
    if (!enabled) return;
    useFollowUpActionStore.getState().clear();
  }, [enabled]);

  return { onBeforeSendMessage, triggerExtract };
};
