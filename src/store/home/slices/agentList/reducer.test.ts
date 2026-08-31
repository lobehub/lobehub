import type { SidebarAgentListResponse } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { initialAgentListState, mapResponseToState } from './initialState';
import { agentListReducer } from './reducer';

const response = (id: string): SidebarAgentListResponse => ({
  groups: [],
  pinned: [],
  privateGroups: [],
  privatePinned: [],
  privateUngrouped: [],
  ungrouped: [{ id } as SidebarAgentListResponse['ungrouped'][number]],
});

describe('agentListReducer', () => {
  it('exposes an optimistic rename immediately and rolls it back on failure', () => {
    const loaded = {
      ...initialAgentListState,
      agentListScope: 'personal',
      ...mapResponseToState(response('agent-1')),
    };
    loaded.ungroupedAgents[0] = { ...loaded.ungroupedAgents[0], title: 'Original' };

    const optimistic = agentListReducer(loaded, {
      id: 'agent-1',
      mutationId: 1,
      patch: { title: 'Renamed' },
      scope: 'personal',
      type: 'optimisticUpdate',
    });
    const optimisticState = { ...loaded, ...optimistic.state };

    expect(optimisticState.agentOptimisticPatches['agent-1'].patch.title).toBe('Renamed');
    expect(
      agentListReducer(optimisticState, {
        id: 'agent-1',
        mutationId: 1,
        scope: 'personal',
        type: 'rollbackUpdate',
      }).state.agentOptimisticPatches,
    ).toEqual({});
  });

  it('commits an optimistic rename into the durable sidebar projection', () => {
    const loaded = {
      ...initialAgentListState,
      agentListScope: 'personal',
      ...mapResponseToState(response('agent-1')),
      agentOptimisticPatches: {
        'agent-1': { mutationId: 1, patch: { title: 'Renamed' }, scope: 'personal' },
      },
    };
    const transition = agentListReducer(loaded, {
      id: 'agent-1',
      mutationId: 1,
      patch: { title: 'Renamed' },
      scope: 'personal',
      type: 'commitUpdate',
    });

    expect(transition.state.ungroupedAgents?.[0].title).toBe('Renamed');
    expect(transition.effects[0]).toMatchObject({ scope: 'personal', type: 'persist' });
  });

  it('hydrates the UI projection without producing a persistence effect', () => {
    const transition = agentListReducer(initialAgentListState, {
      data: response('cached'),
      scope: 'personal',
      type: 'hydrate',
    });
    expect(transition.state.ungroupedAgents?.[0].id).toBe('cached');
    expect(transition.state.agentListSource).toBe('storage');
    expect(transition.effects).toEqual([]);
  });

  it('does not let late hydration overwrite server data for the same scope', () => {
    const current = {
      ...initialAgentListState,
      ...agentListReducer(initialAgentListState, {
        data: response('server'),
        scope: 'personal',
        type: 'replace',
      }).state,
    };
    const transition = agentListReducer(current, {
      data: response('cached'),
      scope: 'personal',
      type: 'hydrate',
    });
    expect(transition.state).toEqual({});
  });
});
