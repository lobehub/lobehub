import { cleanup, renderHook, waitFor } from '@testing-library/react';
import useSWR from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { broadcastCacheScope, resetCacheScopeBroadcast } from '@/libs/replica/cacheScopeEvents';
import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';

import { useTaskStore } from '../../store';
import { taskGroupListEntity, taskListEntity } from '../list/projection';
import { taskDetailResource } from './projection';

vi.mock('@/services/task', () => ({
  taskService: { find: vi.fn(), getDetail: vi.fn(), updateStatus: vi.fn(), update: vi.fn() },
}));
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn().mockResolvedValue(undefined),
  useClientDataSWR: vi.fn(),
}));
const detail = {
  id: 'task_1',
  identifier: 'T-1',
  instruction: 'test',
  status: 'backlog',
  name: 'Before',
};
beforeEach(() => {
  vi.clearAllMocks();
  resetCacheScopeBroadcast();
  useTaskStore.setState({
    activeTaskId: undefined,
    activeTaskRef: undefined,
    taskRefIndex: {},
    taskDetailMap: {},
    taskDetailReplica: createReplicaState(),
    taskListMap: {},
    taskListReplica: createReplicaState(),
    taskGroupListMap: {},
    taskGroupListReplica: createReplicaState(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('canonical task cache', () => {
  it('hydrates a canonical route from persisted detail without an online alias lookup', async () => {
    const scope = `task-offline-${crypto.randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    // Run the real hydration query while the network sync is unavailable.
    vi.mocked(useClientDataSWR).mockImplementation(
      (key, fetcher) =>
        useSWR(Array.isArray(key) && key[0] === 'replica:hydrate' ? key : null, fetcher) as never,
    );
    vi.mocked(taskService.find).mockRejectedValue(new Error('offline'));
    await taskDetailResource.storage!.set(
      { scope, queryKey: 'task_1' },
      { data: detail, updatedAt: 1 },
    );
    useTaskStore.getState().setActiveTaskId('task_1');
    const { result } = renderHook(() => useTaskStore.getState().useFetchTaskDetail('task_1'));
    await waitFor(() => expect(useTaskStore.getState().taskDetailMap.task_1).toMatchObject(detail));
    expect(useTaskStore.getState().activeTaskId).toBe('task_1');
    expect(result.current.error).toBeUndefined();
    expect(taskService.find).not.toHaveBeenCalled();
  });

  it('resolves an old route once and stores only the stable id', async () => {
    vi.mocked(taskService.find).mockResolvedValue({ data: detail, success: true } as never);
    vi.mocked(taskService.getDetail).mockResolvedValue({ data: detail, success: true } as never);
    useTaskStore.getState().setActiveTaskId('T-1');
    await useTaskStore.getState().fetchTaskDetail('T-1');
    expect(Object.keys(useTaskStore.getState().taskDetailMap)).toEqual(['task_1']);
    expect(useTaskStore.getState().activeTaskId).toBe('task_1');
    expect(useTaskStore.getState().activeTaskRef).toBe('T-1');
    expect(useTaskStore.getState().taskRefIndex['T-1']).toBe('task_1');
  });

  it('updates loaded list and board rows when an id route changes status or name', async () => {
    const store = useTaskStore.getState();
    store.internal_dispatchTaskDetail({ id: 'task_1', type: 'setTaskDetail', value: detail });
    useTaskStore.setState({
      taskListMap: { list: { items: [detail as never], total: 1 } },
      taskGroupListMap: {
        board: {
          groupBy: 'status',
          groups: [
            { key: 'backlog', tasks: [detail as never], total: 1 },
            { key: 'done', tasks: [], total: 0 },
          ],
        },
      },
    });
    vi.mocked(taskService.updateStatus).mockImplementation(async () => {
      expect(useTaskStore.getState().taskListMap.list.items[0].status).toBe('completed');
      expect(useTaskStore.getState().taskGroupListMap.board.groups[1].tasks[0].id).toBe('task_1');
      return { success: true } as never;
    });
    await store.updateTaskStatus('task_1', 'completed');
    vi.mocked(taskService.update).mockImplementation(async () => {
      expect(useTaskStore.getState().taskListMap.list.items[0].name).toBe('After');
      return { success: true } as never;
    });
    await store.updateTask('task_1', { name: 'After' });
  });

  it('matches collection rows by id even when identifiers collide', () => {
    const list = { items: [detail, { ...detail, id: 'task_2' }], total: 2 } as never;
    const next = taskListEntity.map(list, 'task_1', (row) => ({ ...row, status: 'completed' }));
    expect(next.items.map((row) => row.status)).toEqual(['completed', 'backlog']);
    expect(
      taskGroupListEntity.has(
        { groups: [{ key: 'backlog', tasks: [detail], total: 1 }], groupBy: 'status' } as never,
        'task_1',
      ),
    ).toBe(true);
  });

  it('clears aliases on a scope switch and drops a late alias lookup', async () => {
    let scope = 'user:personal';
    const spy = vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    let resolve!: (value: never) => void;
    vi.mocked(taskService.find).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = useTaskStore.getState().internal_resolveTaskId('T-1');
    scope = 'user:workspace';
    broadcastCacheScope(scope);
    resolve({ data: detail, success: true } as never);
    await expect(pending).rejects.toThrow('Task scope changed');
    expect(useTaskStore.getState().taskRefIndex).toEqual({});
    spy.mockRestore();
  });
});
