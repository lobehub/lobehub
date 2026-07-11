import type { OnboardingCapabilities } from '@lobechat/types';
import { useMemo } from 'react';

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

export const useOnboardingCapabilities = (): OnboardingCapabilities => {
  const composio = useServerConfigStore(serverConfigSelectors.enableComposio);

  const { data: platforms, error } = useClientDataSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  const messenger = resolveMessengerCapability(platforms, error);

  return useMemo(
    () => ({ analysis: false, composio, messenger, starterTasks: false }),
    [composio, messenger],
  );
};
