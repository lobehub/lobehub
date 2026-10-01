import { describe, expect, it } from 'vitest';

import type { LobeAgentConfig } from '@/types/agent';

import { initialAgentSliceState } from './initialState';
import { agentConfigReducer } from './reducer';

const config = (title: string) => ({ id: 'agent-1', title }) as LobeAgentConfig;

describe('agentConfigReducer', () => {
  it('hydrates without persisting the storage snapshot again', () => {
    const transition = agentConfigReducer(initialAgentSliceState, {
      data: config('Cached'),
      id: 'agent-1',
      scope: 'personal',
      type: 'hydrate',
    });
    expect(transition.state.agentMap?.['agent-1']?.title).toBe('Cached');
    expect(transition.effects).toEqual([]);
  });

  it('rejects late storage hydration after the server projection is installed', () => {
    const server = agentConfigReducer(initialAgentSliceState, {
      data: config('Server'),
      id: 'agent-1',
      scope: 'personal',
      type: 'replace',
    });
    const transition = agentConfigReducer(
      { ...initialAgentSliceState, ...server.state },
      { data: config('Cached'), id: 'agent-1', scope: 'personal', type: 'hydrate' },
    );
    expect(transition.state).toEqual({});
  });

  it('emits persistence only for confirmed server data', () => {
    const transition = agentConfigReducer(initialAgentSliceState, {
      data: config('Server'),
      id: 'agent-1',
      scope: 'personal',
      type: 'replace',
    });
    expect(transition.effects).toEqual([
      { data: config('Server'), id: 'agent-1', scope: 'personal', type: 'persist' },
    ]);
  });
});
