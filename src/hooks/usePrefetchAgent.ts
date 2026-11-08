import { useCallback } from 'react';

import { getAgentStoreState } from '@/store/agent';

/**
 * Returns a callback that warms an agent's config before navigation (call it
 * on mouseEnter). The config lands in `agentMap`, so the page paints it on
 * its first frame; agents already there are skipped.
 */
export const usePrefetchAgent = () => {
  return useCallback((agentId: string) => {
    if (!agentId) return;

    void getAgentStoreState().prefetchAgentConfig(agentId);
  }, []);
};
