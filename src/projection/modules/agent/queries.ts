import { agentService } from '@/services/agent';
import { homeService } from '@/services/home';

import { defineProjectionQuery, executeProjectionQuery } from '../../query/runtime';
import { getProjectionStoreState } from '../../store';
import type { AgentProjectionInput } from './ingestors';
import { selectAgentProjection } from './selectors';

export interface AgentConfigQueryParams {
  agentId: string;
}

type AgentConfigQueryResponse = Awaited<
  ReturnType<typeof agentService.getAgentConfigByIdWithAccess>
>;

export const agentConfigProjectionQuery = defineProjectionQuery<
  AgentConfigQueryParams,
  AgentConfigQueryResponse
>({
  project: (result, { observedAt, params, scope }) => {
    const projectionStore = getProjectionStoreState();
    if (result) {
      projectionStore.commitAgentConfig(
        scope,
        { ...result.data, id: result.data.id ?? params.agentId },
        result.access,
        'network',
        observedAt,
      );
      return;
    }

    projectionStore.deleteAgentProjection(scope, params.agentId, observedAt);
  },
  query: ({ agentId }) => agentService.getAgentConfigByIdWithAccess(agentId),
});

export const loadAgentConfigProjection = async (agentId: string, scope: string) => {
  const { response } = await executeProjectionQuery(agentConfigProjectionQuery, { agentId }, scope);
  const recordId = response?.data.id ?? agentId;
  return selectAgentProjection(getProjectionStoreState().scopes[scope]?.records.agent[recordId]);
};

export interface AgentCollectionQueryParams {
  limit?: number;
}

type AgentCollectionQueryResponse = Awaited<ReturnType<typeof agentService.queryAgents>>;

export const agentDirectoryProjectionQuery = defineProjectionQuery<
  AgentCollectionQueryParams,
  AgentCollectionQueryResponse
>({
  project: (items, { observedAt, scope }) => {
    getProjectionStoreState().commitAgentDirectory(scope, items, {}, observedAt);
  },
  query: ({ limit }) => agentService.queryAgents(limit === undefined ? undefined : { limit }),
});

export const availableAgentsProjectionQuery = defineProjectionQuery<
  AgentCollectionQueryParams,
  AgentCollectionQueryResponse
>({
  project: (items, { observedAt, params, scope }) => {
    getProjectionStoreState().commitAvailableAgents(
      scope,
      items as AgentProjectionInput[],
      { limit: params.limit },
      observedAt,
    );
  },
  query: ({ limit }) => agentService.queryAgents(limit === undefined ? undefined : { limit }),
});

export interface AgentSearchQueryParams {
  keyword: string;
}

type AgentSearchQueryResponse = Awaited<ReturnType<typeof homeService.searchAgents>>;

export const agentSearchProjectionQuery = defineProjectionQuery<
  AgentSearchQueryParams,
  AgentSearchQueryResponse
>({
  project: (items, { observedAt, params, scope }) => {
    getProjectionStoreState().commitAgentSearch(
      scope,
      items,
      { keyword: params.keyword },
      observedAt,
    );
  },
  query: ({ keyword }) => homeService.searchAgents(keyword),
});
