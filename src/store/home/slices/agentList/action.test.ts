import type { SidebarAgentListResponse } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { HomeStore } from '@/store/home/store';

import { AgentListActionImpl } from './action';
import { initialAgentListState } from './initialState';

const response: SidebarAgentListResponse = {
  groups: [],
  pinned: [
    {
      id: 'agent-1',
      pinned: true,
      title: 'Agent One',
      type: 'agent',
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    },
  ],
  privateGroups: [],
  privatePinned: [],
  privateUngrouped: [],
  ungrouped: [],
};

describe('AgentListActionImpl compatibility projection', () => {
  it('clears the previous scope before a replacement Projection view is available', () => {
    const state = { ...initialAgentListState };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new AgentListActionImpl(set as never, () => state as HomeStore);

    action.internal_syncAgentListProjection(response, 'user-1:workspace-1');
    expect(state.pinnedAgents).toEqual(response.pinned);
    expect(state.isAgentListInit).toBe(true);

    action.internal_syncAgentListProjection(undefined, 'user-1:workspace-2');
    expect(state.agentListScope).toBe('user-1:workspace-2');
    expect(state.pinnedAgents).toEqual([]);
    expect(state.isAgentListInit).toBe(false);
  });
});
