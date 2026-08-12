import { useCallback } from 'react';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { augmentKey, mutate } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, nextProjectionObservedAt } from '@/projection';
import { agentService } from '@/services/agent';

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
    const key = augmentKey(
      agentConfigKeys.config(agentId, scope),
      getActiveWorkspaceId(),
    ) as readonly unknown[];
    const observedAt = nextProjectionObservedAt();
    const request = agentService.getAgentConfigByIdWithAccess(agentId).then((result) => {
      if (result) {
        getProjectionStoreState().commitAgentConfig(
          scope,
          { ...result.data, id: result.data.id ?? agentId },
          result.access,
          'network',
          observedAt,
        );
      } else {
        getProjectionStoreState().deleteAgentProjection(scope, agentId, observedAt);
      }
      return result?.data;
    });

    // Populate the SWR cache without triggering re-renders on consuming hooks
    mutate(key, request, {
      // Don't revalidate if data already exists
      revalidate: false,
    });
  }, []);
};
