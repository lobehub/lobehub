/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { useHomeStore } from '@/store/home';
import { initialAgentListState } from '@/store/home/slices/agentList/initialState';

import { useAddableGroupMembers } from './useAddableGroupMembers';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: { queryAgents: vi.fn(() => new Promise(() => {})) },
}));

// The sidebar list sync is the replica's concern; here the list is already local.
vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: () => ({ error: undefined, isRevalidating: false, mutate: vi.fn() }),
}));

const sidebarAgent = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  avatar: null,
  description: null,
  id,
  pinned: false,
  title: id,
  type: 'agent' as const,
  updatedAt: new Date(updatedAt),
  ...extra,
});

describe('useAddableGroupMembers', () => {
  beforeEach(() => {
    vi.mocked(agentService.queryAgents).mockClear();
    act(() => useHomeStore.setState(initialAgentListState));
  });

  // The picker used to fetch `queryAgents` on every open and show a skeleton
  // until it answered; the sidebar replica already holds those agents locally.
  it('offers the agents from the local sidebar list without its own request', () => {
    act(() =>
      useHomeStore.setState({
        agentGroups: [
          {
            id: 'folder',
            items: [sidebarAgent('agt_old', '2026-01-01')],
            name: 'Folder',
            sort: 0,
          },
        ],
        isAgentListInit: true,
        pinnedAgents: [sidebarAgent('agt_new', '2026-03-01')],
        ungroupedAgents: [
          sidebarAgent('agt_member', '2026-02-01'),
          sidebarAgent('grp_chat', '2026-04-01', { type: 'group' }),
        ],
      }),
    );

    const { result } = renderHook(() => useAddableGroupMembers(['agt_member']));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.availableAgents.map((agent) => agent.id)).toEqual(['agt_new', 'agt_old']);
    expect(agentService.queryAgents).not.toHaveBeenCalled();
  });

  // A private agent bound to a shared project is hidden from every other member.
  it('leaves private agents out when only shared agents are wanted', () => {
    act(() =>
      useHomeStore.setState({
        isAgentListInit: true,
        privateUngroupedAgents: [sidebarAgent('agt_private', '2026-05-01')],
        ungroupedAgents: [sidebarAgent('agt_shared', '2026-02-01')],
      }),
    );

    const { result: all } = renderHook(() => useAddableGroupMembers([]));
    const { result: shared } = renderHook(() => useAddableGroupMembers([], { sharedOnly: true }));

    expect(all.current.availableAgents.map((agent) => agent.id)).toEqual([
      'agt_private',
      'agt_shared',
    ]);
    expect(shared.current.availableAgents.map((agent) => agent.id)).toEqual(['agt_shared']);
  });

  it('treats a restored empty list as loading until the server confirms it', () => {
    act(() => useHomeStore.setState({ isAgentListInit: true }));

    const { result } = renderHook(() => useAddableGroupMembers([]));

    expect(result.current.isLoading).toBe(true);
  });
});
