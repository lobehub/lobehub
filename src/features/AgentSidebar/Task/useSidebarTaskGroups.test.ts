import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { useTaskStore } from '@/store/task';
import { taskGroupListQueryKey } from '@/store/task/slices/list/projection';

import { useSidebarTaskGroups } from './useSidebarTaskGroups';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: true, mutate: vi.fn() })),
}));

vi.mock('@/services/task', () => ({
  taskService: { groupList: vi.fn(), list: vi.fn() },
}));

const sidebarQueryKey = taskGroupListQueryKey({
  agentId: 'agt_1',
  excludeStatuses: ['canceled', 'completed'],
  groupBy: 'status',
  visibility: 'all',
});

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    // A leftover Tasks-page chip must not narrow the panel.
    listVisibility: 'private',
    taskGroupListMap: {},
    taskGroupListReplica: createReplicaState(),
  });
});

describe('useSidebarTaskGroups', () => {
  // Regression: the panel read an SWR-persisted `task:sidebarGroups` key, so a
  // reload showed the skeleton until the whole SWR cache hydrated. It now reads
  // the agent's task-group replica entry, which paints while the refresh runs.
  it('paints the stored groups in panel order while the refresh is in flight', () => {
    const { result } = renderHook(() => useSidebarTaskGroups('agt_1'));
    expect(result.current).toEqual({ groups: [], isLoading: true });

    act(() => {
      useTaskStore.setState({
        taskGroupListMap: {
          [sidebarQueryKey]: {
            excludeStatuses: ['canceled', 'completed'],
            groupBy: 'status',
            groups: [
              { key: 'running', tasks: [{ name: 'Nightly sync' }], total: 1 },
              { key: 'backlog', tasks: [], total: 0 },
              { key: 'needsInput', tasks: [{ name: 'Answer me' }], total: 1 },
              { key: 'done', tasks: [], total: 0 },
            ] as any,
          },
        },
      });
    });

    expect(result.current.groups.map((group) => group.key)).toEqual(['needsInput', 'running']);
  });

  it('syncs the agent board without finished columns, ignoring the visibility chip', async () => {
    const { useClientDataSWR } = await import('@/libs/swr');
    const { taskService } = await import('@/services/task');

    renderHook(() => useSidebarTaskGroups('agt_1'));

    const calls = vi.mocked(useClientDataSWR).mock.calls;
    expect(calls.some(([key]) => Array.isArray(key) && key[0] === 'task:sidebarGroups')).toBe(
      false,
    );
    const [, fetcher] = calls.find(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === 'taskGroupList',
    )!;
    await (fetcher as () => Promise<unknown>)();
    expect(taskService.groupList).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeAgentId: 'agt_1',
        excludeStatuses: ['canceled', 'completed'],
        visibility: undefined,
      }),
    );
  });

  it('fetches nothing without an active agent', async () => {
    const { result } = renderHook(() => useSidebarTaskGroups(undefined));
    expect(result.current.groups).toEqual([]);
  });
});
