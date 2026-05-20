import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { agentService } from '@/services/agent';

const FETCH_AGENT_CONFIG_KEY = 'FETCH_AGENT_CONFIG';

/**
 * Returns a callback to prefetch agent config data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 */
export const usePrefetchAgent = () => {
  return useCallback((agentId: string) => {
    if (!agentId) return;

    const key = [FETCH_AGENT_CONFIG_KEY, agentId] as const;

    // Populate the SWR cache without triggering re-renders on consuming hooks
    mutate(key, agentService.getAgentConfigById(agentId), {
      // Don't revalidate if data already exists
      revalidate: false,
    });
  }, []);
};
