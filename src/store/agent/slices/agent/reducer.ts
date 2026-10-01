import isEqual from 'fast-deep-equal';
import type { PartialDeep } from 'type-fest';

import type { LobeAgentConfig } from '@/types/agent';

import type { AgentSliceState } from './initialState';

export type AgentConfigEffect = {
  data: LobeAgentConfig;
  id: string;
  scope: string;
  type: 'persist';
};
export type AgentConfigDispatchAction = {
  data: LobeAgentConfig;
  id: string;
  scope: string;
  type: 'hydrate' | 'replace';
};
export interface AgentConfigTransition {
  effects: AgentConfigEffect[];
  state: Partial<AgentSliceState>;
}

export const agentConfigReducer = (
  state: AgentSliceState,
  action: AgentConfigDispatchAction,
): AgentConfigTransition => {
  if (
    action.type === 'hydrate' &&
    state.agentConfigScopeMap[action.id] === action.scope &&
    state.agentConfigSourceMap[action.id] === 'server'
  )
    return { effects: [], state: {} };

  const agentMap = isEqual(state.agentMap[action.id], action.data)
    ? state.agentMap
    : { ...state.agentMap, [action.id]: action.data as PartialDeep<LobeAgentConfig> };

  return {
    effects:
      action.type === 'replace'
        ? [{ data: action.data, id: action.id, scope: action.scope, type: 'persist' }]
        : [],
    state: {
      agentConfigScopeMap: { ...state.agentConfigScopeMap, [action.id]: action.scope },
      agentConfigSourceMap: {
        ...state.agentConfigSourceMap,
        [action.id]: action.type === 'replace' ? 'server' : 'storage',
      },
      agentMap,
    },
  };
};
