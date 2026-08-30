'use client';

import type { AgentProjection, SidebarAgentItem } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import {
  agentAvailableViewContract,
  agentConfigViewContract,
  agentDirectoryViewContract,
  agentSearchViewContract,
} from './contracts';
import {
  type AgentProjectionView,
  selectAgentDirectory,
  selectAgentDirectoryIndex,
  selectAgentProjection,
  selectAgentProjectionById,
  selectAgentProjectionRecord,
  selectAgentSearch,
  selectAgentSearchIndex,
  selectAgentSummary,
  selectAvailableAgentsIndex,
} from './selectors';

type EqualityFn<Selected> = (left: Selected, right: Selected) => boolean;

/** Reactive Agent Projection selection for product consumers. */
export const useAgentProjection = <Selected>(
  id: string | undefined,
  selector: (agent: AgentProjectionView | undefined) => Selected,
  equalityFn?: EqualityFn<Selected>,
): Selected => {
  useProjectionViewHydration(agentConfigViewContract, { id: id ?? '' }, Boolean(id));
  const scope = useCacheScope();

  return useProjectionStore(
    (state) => selector(selectAgentProjectionById(state.scopes[scope], id)),
    equalityFn,
  );
};

/** Reactive raw record selection for loading/not-found state. */
export const useAgentProjectionRecord = (id: string | undefined): AgentProjection | undefined => {
  useProjectionViewHydration(agentConfigViewContract, { id: id ?? '' }, Boolean(id));
  const scope = useCacheScope();

  return useProjectionStore((state) => selectAgentProjectionRecord(state.scopes[scope], id));
};

export interface AgentProjectionState {
  data?: AgentProjectionView;
  /** Distinguishes an absent Projection from a tombstoned/incomplete one. */
  hasRecord: boolean;
  record?: AgentProjection;
}

/** Reactive canonical Agent view used by request compatibility hooks. */
export const useAgentProjectionState = (id: string | undefined): AgentProjectionState => {
  useProjectionViewHydration(agentConfigViewContract, { id: id ?? '' }, Boolean(id));
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const record = id ? state.scopes[scope]?.records.agent[id] : undefined;
    return {
      data: selectAgentProjection(record),
      hasRecord: Boolean(record),
      record,
    };
  }, isEqual);
};

export interface AgentSearchProjectionState {
  data?: SidebarAgentItem[];
  hasIndex: boolean;
}

export interface AgentDirectoryProjectionState {
  data?: AgentProjectionView[];
  hasIndex: boolean;
}

export interface AvailableAgentsProjectionState {
  data?: AgentProjectionView[];
  hasIndex: boolean;
}

/** Reactive bounded Agent list used for runtime-context selection. */
export const useAvailableAgentsProjectionState = (
  enabled = true,
): AvailableAgentsProjectionState => {
  useProjectionViewHydration(agentAvailableViewContract, {}, enabled);
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    const index = selectAvailableAgentsIndex(projectionScope);
    return {
      data:
        projectionScope && index
          ? index.refs.flatMap((ref) => {
              const item = selectAgentSummary(projectionScope.records.agent[ref.id]);
              return item ? [item] : [];
            })
          : undefined,
      hasIndex: Boolean(index),
    };
  }, isEqual);
};

/** Reactive full Agent directory resolved from canonical records. */
export const useAgentDirectoryProjectionState = (enabled = true): AgentDirectoryProjectionState => {
  useProjectionViewHydration(agentDirectoryViewContract, {}, enabled);
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    return {
      data: selectAgentDirectory(projectionScope),
      hasIndex: Boolean(selectAgentDirectoryIndex(projectionScope)),
    };
  }, isEqual);
};

/** Reactive Agent/ChatGroup search results resolved from canonical records. */
export const useAgentSearchProjectionState = (
  keyword: string | undefined,
): AgentSearchProjectionState => {
  useProjectionViewHydration(agentSearchViewContract, { keyword });
  const scope = useCacheScope();

  return useProjectionStore((state) => {
    const projectionScope = state.scopes[scope];
    return {
      data: selectAgentSearch(projectionScope, keyword),
      hasIndex: Boolean(selectAgentSearchIndex(projectionScope, keyword)),
    };
  }, isEqual);
};
