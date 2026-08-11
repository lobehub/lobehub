'use client';

import type { SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { groupKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { agentService, type AvailableAgentItem } from '@/services/agent';

import { nextProjectionObservedAt } from '../../core/ingest';
import { getProjectionStoreState } from '../../store';
import { selectAgentDirectoryIndex } from './selectors';
import { useAgentDirectoryProjectionState } from './viewHooks';

const toAvailableAgent = (
  item: NonNullable<ReturnType<typeof useAgentDirectoryProjectionState>['data']>[number],
): AvailableAgentItem => ({
  avatar: typeof item.avatar === 'string' ? item.avatar : null,
  backgroundColor: item.backgroundColor ?? null,
  description: item.description ?? null,
  id: item.id,
  name: item.name ?? null,
  title: item.title ?? null,
});

/** Shared Agent directory for group membership and evaluation configuration. */
export const useAgentDirectory = (enabled = true): SWRResponse<AvailableAgentItem[]> => {
  const projection = useAgentDirectoryProjectionState(enabled);
  const request = useClientDataSWRWithSync<AvailableAgentItem[]>(
    enabled ? groupKeys.queryAgents() : null,
    async () => {
      const scope = getCacheScope();
      const observedAt = nextProjectionObservedAt();
      const data = await agentService.queryAgents();
      getProjectionStoreState().commitAgentDirectory(scope, data, {}, observedAt);
      return data;
    },
    {
      onData: (data) => {
        const projectionStore = getProjectionStoreState();
        const scope = getCacheScope();
        if (!selectAgentDirectoryIndex(projectionStore.scopes[scope])) {
          projectionStore.commitAgentDirectory(scope, data, {}, 0);
        }
      },
      syncBeforePaint: true,
    },
  );

  return {
    ...request,
    data: projection.hasIndex ? projection.data?.map(toAvailableAgent) : undefined,
  } as SWRResponse<AvailableAgentItem[]>;
};
