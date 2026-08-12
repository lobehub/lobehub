// @vitest-environment happy-dom
import type { SidebarAgentListResponse } from '@lobechat/types';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectionStoreState, selectAgentSearchIndex, useProjectionStore } from '@/projection';
import { homeService } from '@/services/home';
import type { HomeStore } from '@/store/home/store';
import { withSWR } from '~test-utils';

import { AgentListActionImpl } from './action';
import { initialAgentListState } from './initialState';

const scopeState = vi.hoisted(() => ({ current: 'user-1:workspace-a' }));

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCacheScope: () => scopeState.current,
  useCacheScope: () => scopeState.current,
}));

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
  beforeEach(() => {
    vi.restoreAllMocks();
    scopeState.current = 'user-1:workspace-a';
    useProjectionStore.setState({ scopes: {} });
  });

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

  it('commits delayed search results only to the initiating scope', async () => {
    let resolveSearch!: (value: SidebarAgentListResponse['pinned']) => void;
    vi.spyOn(homeService, 'searchAgents').mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const state = { ...initialAgentListState };
    const action = new AgentListActionImpl(vi.fn() as never, () => state as HomeStore);

    renderHook(() => action.useSearchAgents('Agent'), { wrapper: withSWR });
    scopeState.current = 'user-1:workspace-b';
    resolveSearch(response.pinned);

    await waitFor(() =>
      expect(
        selectAgentSearchIndex(getProjectionStoreState().scopes['user-1:workspace-a'], 'Agent'),
      ).toBeDefined(),
    );
    expect(
      selectAgentSearchIndex(getProjectionStoreState().scopes['user-1:workspace-b'], 'Agent'),
    ).toBeUndefined();
  });
});
