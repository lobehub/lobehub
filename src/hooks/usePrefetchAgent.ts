import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { agentService } from '@/services/agent';

/**
 * Returns a callback to prefetch agent config data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 *
 * Warms the exact identity-scoped key `useFetchAgentConfig` reads. The scoped
 * mutate wrapper appends the workspace once; callers must not pre-augment it.
 */
export const usePrefetchAgent = () => {
  return useCallback((agentId: string) => {
    if (!agentId) return;

    const key = agentConfigKeys.config(agentId, getCacheScope());

    // Populate the SWR cache without triggering re-renders on consuming hooks
    mutate(key, agentService.getAgentConfigById(agentId), {
      // Don't revalidate if data already exists
      revalidate: false,
    });
  }, []);
};
