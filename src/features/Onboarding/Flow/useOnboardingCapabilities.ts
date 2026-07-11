import type { OnboardingCapabilities } from '@lobechat/types';
import { useMemo } from 'react';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useOnboardingCapabilities = (): OnboardingCapabilities => {
  const composio = useServerConfigStore(serverConfigSelectors.enableComposio);

  return useMemo(
    () => ({ analysis: false, composio, messenger: false, starterTasks: false }),
    [composio],
  );
};
