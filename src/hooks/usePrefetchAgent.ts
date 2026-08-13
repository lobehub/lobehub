import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { agentConfigProjectionQuery } from '@/projection/modules/agent/queries';
import { executeProjectionRequest } from '@/projection/query/runtime';

/**
 * Returns a callback to prefetch agent config data into the SWR cache.
 * Call the returned function on mouseEnter to warm the cache before navigation.
 *
 * Warms the exact key `useFetchAgentConfig` reads — the workspace-augmented
 * form of `agentConfigKeys.config(agentId, scope)` — so the prefetch actually
 * hits the consumer's cache entry without crossing identity partitions.
 */
export const usePrefetchAgent = () => {
  return useCallback((agentId: string) => {
    if (!agentId) return;

    const scope = getCacheScope();
    const key = agentConfigKeys.config(agentId, scope);
    const request = executeProjectionRequest(agentConfigProjectionQuery, { agentId }, scope);

    // Populate the SWR cache without triggering re-renders on consuming hooks
    mutate(key, request, {
      // Don't revalidate if data already exists
      revalidate: false,
    });
  }, []);
};
