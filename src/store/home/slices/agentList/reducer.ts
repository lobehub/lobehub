import type { SidebarAgentItem, SidebarAgentListResponse, SidebarGroup } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import type { AgentListState, SidebarAgentMetaPatch } from './initialState';
import { mapResponseToState } from './initialState';

export type AgentListEffect = { data: SidebarAgentListResponse; scope: string; type: 'persist' };
export type AgentListDispatchAction =
  | { data: SidebarAgentListResponse; scope: string; type: 'hydrate' | 'replace' }
  | {
      id: string;
      mutationId: number;
      patch: SidebarAgentMetaPatch;
      scope: string;
      type: 'commitUpdate';
    }
  | {
      id: string;
      mutationId: number;
      patch: SidebarAgentMetaPatch;
      scope: string;
      type: 'optimisticUpdate';
    }
  | { id: string; mutationId: number; scope: string; type: 'rollbackUpdate' };
export interface AgentListTransition {
  effects: AgentListEffect[];
  state: Partial<AgentListState>;
}

const patchItems = (items: SidebarAgentItem[], id: string, patch: SidebarAgentMetaPatch) =>
  items.map((item) => (item.id === id ? { ...item, ...patch } : item));

const patchGroups = (groups: SidebarGroup[], id: string, patch: SidebarAgentMetaPatch) =>
  groups.map((group) => ({ ...group, items: patchItems(group.items, id, patch) }));

const toResponse = (state: AgentListState): SidebarAgentListResponse => ({
  groups: state.agentGroups,
  pinned: state.pinnedAgents,
  privateGroups: state.privateAgentGroups,
  privatePinned: state.privatePinnedAgents,
  privateUngrouped: state.privateUngroupedAgents,
  ungrouped: state.ungroupedAgents,
});

export const agentListReducer = (
  state: AgentListState,
  action: AgentListDispatchAction,
): AgentListTransition => {
  if (action.type === 'optimisticUpdate') {
    return {
      effects: [],
      state: {
        agentOptimisticPatches: {
          ...state.agentOptimisticPatches,
          [action.id]: { mutationId: action.mutationId, patch: action.patch, scope: action.scope },
        },
      },
    };
  }

  if (action.type === 'rollbackUpdate') {
    if (state.agentOptimisticPatches[action.id]?.mutationId !== action.mutationId)
      return { effects: [], state: {} };
    const agentOptimisticPatches = { ...state.agentOptimisticPatches };
    delete agentOptimisticPatches[action.id];
    return { effects: [], state: { agentOptimisticPatches } };
  }

  if (action.type === 'commitUpdate') {
    if (state.agentOptimisticPatches[action.id]?.mutationId !== action.mutationId)
      return { effects: [], state: {} };
    const agentOptimisticPatches = { ...state.agentOptimisticPatches };
    delete agentOptimisticPatches[action.id];
    if (state.agentListScope !== action.scope)
      return { effects: [], state: { agentOptimisticPatches } };
    const nextState: AgentListState = {
      ...state,
      agentGroups: patchGroups(state.agentGroups, action.id, action.patch),
      agentOptimisticPatches,
      pinnedAgents: patchItems(state.pinnedAgents, action.id, action.patch),
      privateAgentGroups: patchGroups(state.privateAgentGroups, action.id, action.patch),
      privatePinnedAgents: patchItems(state.privatePinnedAgents, action.id, action.patch),
      privateUngroupedAgents: patchItems(state.privateUngroupedAgents, action.id, action.patch),
      ungroupedAgents: patchItems(state.ungroupedAgents, action.id, action.patch),
    };
    return {
      effects: [{ data: toResponse(nextState), scope: action.scope, type: 'persist' }],
      state: nextState,
    };
  }

  if (
    action.type === 'hydrate' &&
    state.agentListScope === action.scope &&
    state.agentListSource === 'server'
  ) {
    return { effects: [], state: {} };
  }

  const projection = mapResponseToState(action.data);
  if (
    state.agentListScope === action.scope &&
    state.isAgentListInit &&
    isEqual(state.agentGroups, projection.agentGroups) &&
    isEqual(state.pinnedAgents, projection.pinnedAgents) &&
    isEqual(state.privateAgentGroups, projection.privateAgentGroups) &&
    isEqual(state.privatePinnedAgents, projection.privatePinnedAgents) &&
    isEqual(state.privateUngroupedAgents, projection.privateUngroupedAgents) &&
    isEqual(state.ungroupedAgents, projection.ungroupedAgents)
  )
    return { effects: [], state: {} };

  return {
    effects:
      action.type === 'replace'
        ? [{ data: action.data, scope: action.scope, type: 'persist' }]
        : [],
    state: {
      ...projection,
      agentListScope: action.scope,
      agentListSource: action.type === 'replace' ? 'server' : 'storage',
      isAgentListInit: true,
    },
  };
};
