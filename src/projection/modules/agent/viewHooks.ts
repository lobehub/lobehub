'use client';

import type { AgentProjection, SidebarAgentItem } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useCacheScope } from '@/libs/swr/useCacheScope';

import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import {
  agentConfigViewContract,
  agentDirectoryViewContract,
  agentSearchViewContract,
} from './contracts';
import {
  type AgentProjectionView,
  selectAgentDirectory,
  selectAgentDirectoryIndex,
  selectAgentProjection,
  selectAgentSearch,
  selectAgentSearchIndex,
} from './selectors';

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
