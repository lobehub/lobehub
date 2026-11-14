import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState, replicaKeys } from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { saveToast } from '@/store/utils/saveToast';

import { useTaskStore } from '../../store';
import { taskListResource } from '../list/projection';
import { taskDetailRefreshes } from './testUtils';

vi.mock('@/services/task', () => ({
  taskService: {
    find: vi.fn(),
    getDetail: vi.fn(),
    groupList: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn().mockResolvedValue(undefined),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

vi.mock('@/store/utils/saveToast', () => ({ saveToast: vi.fn() }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

const row = (id: string, projectId: string | null) =>
  ({ id, identifier: id, projectId, status: 'backlog' }) as any;

const OLD_LIST = 'old-project-list';
const GLOBAL_LIST = 'global-list';
const OLD_BOARD = 'old-project-board';

const seed = () =>
  useTaskStore.setState({
    activeTaskId: 'T-1',
    taskDetailMap: {
      'T-1': { id: 'T-1', identifier: 'T-1', instruction: 'x', projectId: 'p1', status: 'backlog' },
    },
    taskGroupListMap: {
      [OLD_BOARD]: {
        groupBy: 'status',
        groups: [{ key: 'backlog', tasks: [row('T-1', 'p1'), row('T-2', 'p1')], total: 2 }],
        projectId: 'p1',
      },
    },
    taskListMap: {
      [GLOBAL_LIST]: { items: [row('T-1', 'p1'), row('T-2', 'p1')], total: 2 },
      [OLD_LIST]: { items: [row('T-1', 'p1'), row('T-2', 'p1')], projectId: 'p1', total: 2 },
    },
  });

const state = () => useTaskStore.getState();
const ids = (key: string) => state().taskListMap[key].items.map((task) => task.id);
const boardIds = () => state().taskGroupListMap[OLD_BOARD].groups[0].tasks.map((task) => task.id);

const holdUpdate = () => {
  let settle!: { reject: (error: Error) => void; resolve: () => void };
  vi.mocked(taskService.update).mockReturnValue(
    new Promise((resolve, reject) => {
      settle = { reject, resolve: () => resolve({ success: true } as any) };
    }) as any,
  );
  return settle;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mutate).mockResolvedValue(undefined);
  vi.mocked(taskService.getDetail).mockResolvedValue({ data: undefined } as any);
  useTaskStore.setState({
    listVisibility: 'all',
    taskDetailMap: {},
    taskDetailReplica: createReplicaState(),
    taskGroupListMap: {},
    taskGroupListReplica: createReplicaState(),
    taskListMap: {},
    taskListReplica: createReplicaState(),
    taskRefIndex: { 'T-1': 'T-1', 'T-2': 'T-2' },
    taskSaveStatusMap: {},
  });
});

describe('updateTask projectId', () => {
  it.each([
    ['moving', 'p2'],
    ['clearing', null],
  ])('%s shows at once in detail and every list, and refreshes them', async (_label, projectId) => {
    seed();
    const update = holdUpdate();

    const pending = state().updateTask('T-1', { projectId });

    expect(state().taskDetailMap['T-1'].projectId).toBe(projectId);
    // Gone from the old project's list and board, the other row untouched.
    expect(ids(OLD_LIST)).toEqual(['T-2']);
    expect(state().taskListMap[OLD_LIST].total).toBe(1);
    expect(boardIds()).toEqual(['T-2']);
    // Still in the global list, now carrying the new project.
    expect(ids(GLOBAL_LIST)).toEqual(['T-1', 'T-2']);
    expect(state().taskListMap[GLOBAL_LIST].items[0].projectId).toBe(projectId);

    update.resolve();
    await pending;

    expect(taskService.update).toHaveBeenCalledWith('T-1', { projectId });
    // Revalidating every list is what fills the list of the project it moved into.
    const listSyncKey = replicaKeys.sync(
      taskListResource.name,
      taskListResource.version,
      cacheScope.get(),
      'any-list',
      {},
    );
    const revalidates = vi
      .mocked(mutate)
      .mock.calls.some(([match]) => typeof match === 'function' && (match as any)(listSyncKey));
    expect(revalidates).toBe(true);
    expect(taskDetailRefreshes('T-1').length).toBeGreaterThan(0);
    expect(ids(OLD_LIST)).toEqual(['T-2']);
  });

  it('restores every list exactly when the server refuses the move', async () => {
    seed();
    const update = holdUpdate();

    const pending = state().updateTask('T-1', { projectId: 'p-foreign' });
    expect(ids(OLD_LIST)).toEqual(['T-2']);

    update.reject(new Error('Project not found'));
    await pending.catch(() => {});

    expect(ids(OLD_LIST)).toEqual(['T-1', 'T-2']);
    expect(state().taskListMap[OLD_LIST].total).toBe(2);
    expect(boardIds()).toEqual(['T-1', 'T-2']);
    expect(state().taskListMap[GLOBAL_LIST].items[0].projectId).toBe('p1');
  });

  it('explains a refused move in the UI language, with no retry that would fail again', async () => {
    seed();
    const refused = Object.assign(new Error('Task dependencies cannot cross project boundaries'), {
      data: { code: 'BAD_REQUEST' },
    });
    vi.mocked(taskService.update).mockRejectedValue(refused);

    await state()
      .updateTask('T-1', { projectId: 'p2' })
      .catch(() => {});

    expect(saveToast).toHaveBeenCalledWith(refused, {
      hideCause: true,
      title: expect.stringContaining("Can't move this task"),
    });
  });

  it('keeps the server cause and retry for any other failed save', async () => {
    seed();
    const failed = Object.assign(new Error('boom'), { data: { code: 'INTERNAL_SERVER_ERROR' } });
    vi.mocked(taskService.update).mockRejectedValue(failed);

    await state()
      .updateTask('T-1', { projectId: 'p2' })
      .catch(() => {});

    expect(saveToast).toHaveBeenCalledWith(failed, { retry: expect.any(Function) });
  });

  it('keeps the row in its project list when the patch does not send a project', async () => {
    seed();
    vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

    await state().updateTask('T-1', { name: 'Renamed' });

    expect(taskService.update).toHaveBeenCalledWith('T-1', { name: 'Renamed' });
    expect(ids(OLD_LIST)).toEqual(['T-1', 'T-2']);
    expect(state().taskDetailMap['T-1'].projectId).toBe('p1');
  });
});

describe('a project-scoped collection remembers its project', () => {
  const syncOf = (name: 'taskGroupList' | 'taskList') => {
    const call = vi
      .mocked(useClientDataSWR)
      .mock.calls.find(
        ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
      );
    return { fetcher: call![1] as () => Promise<any>, options: call![2] as any };
  };

  it('stores the project on a fetched list, so a later move can drop the row', async () => {
    vi.mocked(taskService.list).mockResolvedValue({
      data: [row('T-1', 'p1')],
      total: 1,
    } as any);
    const { result } = renderHook(() =>
      useTaskStore.getState().useFetchTaskList({ complete: false, projectId: 'p1' }),
    );
    const queryKey = result.current.queryKey!;

    const { fetcher, options } = syncOf('taskList');
    await act(async () => {
      const fetched = await fetcher();
      options?.onSuccess?.(fetched);
    });
    await waitFor(() => expect(state().taskListMap[queryKey]?.projectId).toBe('p1'));
  });

  it('stores the project on a fetched board', async () => {
    vi.mocked(taskService.groupList).mockResolvedValue({
      data: [{ key: 'backlog', tasks: [row('T-1', 'p1')], total: 1 }],
    } as any);
    const { result } = renderHook(() =>
      useTaskStore.getState().useFetchTaskGroupList({ projectId: 'p1' }),
    );
    const queryKey = result.current.queryKey!;

    const { fetcher, options } = syncOf('taskGroupList');
    await act(async () => {
      const fetched = await fetcher();
      options?.onSuccess?.(fetched);
    });
    await waitFor(() => expect(state().taskGroupListMap[queryKey]?.projectId).toBe('p1'));
  });
});
