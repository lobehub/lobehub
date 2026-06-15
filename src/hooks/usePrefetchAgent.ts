import { useCallback } from 'react';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { augmentKey, mutate } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';

/**
 * Returns a callback to prefetch agent config data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 *
 * Warms the exact key `useFetchAgentConfig` reads — the workspace-augmented
 * form of `agentConfigKeys.config(agentId)` — so the prefetch actually hits the
 * consumer's cache entry.
 */
export const usePrefetchAgent = () => {
  return useCallback((agentId: string) => {
    if (!agentId) return;

    const key = augmentKey(
      agentConfigKeys.config(agentId),
      getActiveWorkspaceId(),
    ) as readonly unknown[];

    // Populate the SWR cache without triggering re-renders on consuming hooks
    mutate(key, agentService.getAgentConfigById(agentId), {
      // Don't revalidate if data already exists
      revalidate: false,
    });
  }, []);
};
