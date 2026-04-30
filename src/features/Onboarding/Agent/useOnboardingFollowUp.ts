import { useCallback } from 'react';

import { useFollowUpActionStore } from '@/store/followUpAction';
import type { OnboardingPhase } from '@/types/user';

interface UseOnboardingFollowUpParams {
  enabled: boolean;
  isGreeting: boolean;
  phase?: OnboardingPhase;
}

interface OnboardingFollowUpHandlers {
  onAfterMessageCreate: (params: { assistantMessageId: string }) => Promise<void>;
  onBeforeSendMessage: () => Promise<void>;
}

export const useOnboardingFollowUp = ({
  enabled,
  isGreeting,
  phase,
}: UseOnboardingFollowUpParams): OnboardingFollowUpHandlers => {
  const onAfterMessageCreate = useCallback(
    async ({ assistantMessageId }: { assistantMessageId: string }) => {
      if (!enabled) return;
      if (!phase) return;
      if (phase === 'summary') return;
      if (isGreeting) return;

      await useFollowUpActionStore
        .getState()
        .fetchFor(assistantMessageId, { kind: 'onboarding', phase });
    },
    [enabled, phase, isGreeting],
  );

  const onBeforeSendMessage = useCallback(async () => {
    if (!enabled) return;
    useFollowUpActionStore.getState().clear();
  }, [enabled]);

  return { onAfterMessageCreate, onBeforeSendMessage };
};
