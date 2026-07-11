import type { OnboardingCapabilities } from '@lobechat/types';
import { useMemo, useRef } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const resolveMessengerCapability = (
  platforms: unknown[] | undefined,
  error: unknown,
): boolean => {
  if (error) return false;
  return (platforms?.length ?? 0) > 0;
};

export const latchCapabilities = (
  previous: OnboardingCapabilities,
  next: OnboardingCapabilities,
): OnboardingCapabilities => ({
  analysis: previous.analysis || next.analysis,
  composio: previous.composio || next.composio,
  messenger: previous.messenger || next.messenger,
  starterTasks: previous.starterTasks || next.starterTasks,
});

const useLatchedCapabilities = (capabilities: OnboardingCapabilities): OnboardingCapabilities => {
  const latchRef = useRef(capabilities);
  latchRef.current = latchCapabilities(latchRef.current, capabilities);
  const { analysis, composio, messenger, starterTasks } = latchRef.current;

  return useMemo(
    () => ({ analysis, composio, messenger, starterTasks }),
    [analysis, composio, messenger, starterTasks],
  );
};

export const useOnboardingCapabilities = (): OnboardingCapabilities => {
  const composio = useServerConfigStore(serverConfigSelectors.enableComposio);

  const { data: platforms, error } = useClientDataSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  const messenger = resolveMessengerCapability(platforms, error);

  const capabilities = useMemo(
    () => ({ analysis: false, composio, messenger, starterTasks: false }),
    [composio, messenger],
  );

  return useLatchedCapabilities(capabilities);
};
