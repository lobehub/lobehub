'use client';

import type { ProjectionRequestMarker, SidebarAgentItem } from '@lobechat/types';
import type { SWRConfiguration } from 'swr';

import { agentConfigKeys, groupKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import type { AvailableAgentItem } from '@/services/agent';

import { type ProjectionQueryResponse, useProjectionRequest } from '../../query/hook';
import {
  agentConfigProjectionQuery,
  agentDirectoryProjectionQuery,
  agentSearchProjectionQuery,
  availableAgentsProjectionQuery,
} from './queries';
import type { AgentProjectionView } from './selectors';
import {
  useAgentDirectoryProjectionState,
  useAgentProjectionState,
  useAgentSearchProjectionState,
  useAvailableAgentsProjectionState,
} from './viewHooks';

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
export const useAgentDirectory = (
  enabled = true,
): ProjectionQueryResponse<AvailableAgentItem[]> => {
  const projection = useAgentDirectoryProjectionState(enabled);
  const request = useProjectionRequest(
    enabled ? groupKeys.queryAgents() : null,
    agentDirectoryProjectionQuery,
    {},
  );

  return {
    ...request,
    data: projection.hasIndex ? projection.data?.map(toAvailableAgent) : undefined,
  };
};

export const useAgentConfigProjection = (
  agentId: string | undefined,
  options?: SWRConfiguration<ProjectionRequestMarker>,
): ProjectionQueryResponse<AgentProjectionView> => {
  const scope = useCacheScope();
  const projection = useAgentProjectionState(agentId);
  const request = useProjectionRequest(
    agentId ? agentConfigKeys.config(agentId, scope) : null,
    agentConfigProjectionQuery,
    { agentId: agentId ?? '' },
    options,
  );

  return {
    ...request,
    data: projection.hasRecord ? projection.data : undefined,
  };
};

export const useAvailableAgentsProjection = (
  enabled: boolean,
  limit: number,
  options?: SWRConfiguration<ProjectionRequestMarker>,
): ProjectionQueryResponse<AvailableAgentItem[]> => {
  const projection = useAvailableAgentsProjectionState(enabled);
  const request = useProjectionRequest(
    enabled ? agentConfigKeys.available() : null,
    availableAgentsProjectionQuery,
    { limit },
    options,
  );

  return {
    ...request,
    data: projection.hasIndex ? projection.data?.map(toAvailableAgent) : undefined,
  };
};

export const useAgentSearchProjection = (
  keyword: string | undefined,
  options?: SWRConfiguration<ProjectionRequestMarker>,
): ProjectionQueryResponse<SidebarAgentItem[]> => {
  const scope = useCacheScope();
  const projection = useAgentSearchProjectionState(keyword);
  const request = useProjectionRequest(
    keyword ? agentConfigKeys.search(keyword, scope) : null,
    agentSearchProjectionQuery,
    { keyword: keyword ?? '' },
    options,
  );

  return {
    ...request,
    data: projection.hasIndex ? projection.data : undefined,
  };
};
