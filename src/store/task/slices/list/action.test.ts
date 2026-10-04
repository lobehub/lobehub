import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';

import { useTaskStore } from '../../store';

// Mock task service
vi.mock('@/services/task', () => ({
  taskService: {
    groupList: vi.fn(),
    list: vi.fn(),
  },
}));

// Mock SWR
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    listVisibility: 'all',
    taskGroupListMap: {},
    taskGroupListReplica: createReplicaState(),
    taskListMap: {},
    taskListReplica: createReplicaState(),
  });
});

/** The replica network sync of a resource, as registered with the SWR driver. */
const syncCalls = async (name: 'taskGroupList' | 'taskList') => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, fetcher]) => ({ fetcher: fetcher as () => Promise<any>, key: key as unknown[] }));
};

describe('TaskListSliceAction', () => {
  describe('refreshTaskList', () => {
    // An edit can move a task across every list boundary at once — reorder it
    // by `updatedAt`, change its visibility, attach a schedule that flips
    // Home's automation filter — so refresh revalidates every list and board.
    it('revalidates every task list and board, plus the scheduled and mine roll-ups', async () => {
      const { mutate } = await import('@/libs/swr');

      await useTaskStore.getState().refreshTaskList();

      const matchers = vi
        .mocked(mutate)
        .mock.calls.map(([arg]) => arg)
        .filter((arg): arg is (key: unknown) => boolean => typeof arg === 'function');
      const matches = (key: unknown[]) => matchers.some((matcher) => matcher(key));
      const scope = (await import('@/libs/replica')).cacheScope.get();
      expect(matches(['replica:sync', 'taskList', 1, scope, 'any-list', {}])).toBe(true);
      expect(matches(['replica:sync', 'taskGroupList', 1, scope, 'any-board', {}])).toBe(true);
      expect(matches(['task:scheduledList', '__all__', 'all'])).toBe(true);
      expect(matches(['task:myList', 'assigned', 'all'])).toBe(true);
    });
  });

  describe('useFetchTaskGroupList', () => {
    it('keys and requests assignee groups independently from status groups', async () => {
      const { taskService } = await import('@/services/task');

      const { result } = renderHook(() => [
        useTaskStore.getState().useFetchTaskGroupList({
          allAgents: true,
          automated: false,
          excludeStatuses: ['completed', 'canceled'],
          groupBy: 'assignee',
        }),
        useTaskStore.getState().useFetchTaskGroupList({ allAgents: true, automated: false }),
      ]);

      expect(result.current[0].queryKey).not.toBe(result.current[1].queryKey);
      const [assignee] = await syncCalls('taskGroupList');
      await assignee.fetcher();
      expect(taskService.groupList).toHaveBeenCalledWith({
        assigneeAgentId: undefined,
        automated: false,
        excludeStatuses: ['canceled', 'completed'],
        groupBy: 'assignee',
        projectId: undefined,
        scope: undefined,
        visibility: undefined,
      });
    });

    it('keys and requests the "My tasks" board apart from the all-agents board', async () => {
      const { taskService } = await import('@/services/task');

      const { result } = renderHook(() => [
        useTaskStore.getState().useFetchTaskGroupList({ automated: false, scope: 'assigned' }),
        useTaskStore.getState().useFetchTaskGroupList({ automated: false, scope: 'created' }),
        useTaskStore.getState().useFetchTaskGroupList({ allAgents: true, automated: false }),
      ]);

      // The `assigned` / `created` sub-views and the all-agents board can never
      // serve each other's groups.
      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(3);
      const [assigned] = await syncCalls('taskGroupList');
      await assigned.fetcher();
      expect(taskService.groupList).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeAgentId: undefined, scope: 'assigned' }),
      );
    });

    it('ignores the visibility chip on the "My tasks" board, like its list view does', async () => {
      const { taskService } = await import('@/services/task');
      // The chip is not offered inside "My tasks"; a value left over from the
      // ordinary tab must not narrow the board, or the list ↔ board switch
      // would silently change the row set.
      useTaskStore.setState({ listVisibility: 'private' });

      renderHook(() => useTaskStore.getState().useFetchTaskGroupList({ scope: 'created' }));

      const [board] = await syncCalls('taskGroupList');
      await board.fetcher();
      expect(taskService.groupList).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'created', visibility: undefined }),
      );
    });

    it('passes the ordinary-task automation filter through the kanban query', async () => {
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchTaskGroupList({ allAgents: true, automated: false }),
      );

      const [board] = await syncCalls('taskGroupList');
      await board.fetcher();
      expect(taskService.groupList).toHaveBeenCalledWith(
        expect.objectContaining({ automated: false }),
      );
    });

    it("never shows another board query's groups while its own loads", () => {
      const { result } = renderHook(() =>
        useTaskStore.getState().useFetchTaskGroupList({ allAgents: true, groupBy: 'status' }),
      );
      act(() => {
        useTaskStore.setState({
          taskGroupListMap: {
            [result.current.queryKey!]: {
              groupBy: 'status',
              groups: [{ key: 'backlog', tasks: [{ identifier: 'T-1' }], total: 1 }] as any,
            },
          },
        });
      });

      const assignee = renderHook(() =>
        useTaskStore.getState().useFetchTaskGroupList({ allAgents: true, groupBy: 'assignee' }),
      );

      const { taskGroupListMap } = useTaskStore.getState();
      expect(taskGroupListMap[assignee.result.current.queryKey!]).toBeUndefined();
      // Switching back paints the status board from memory at once.
      expect(taskGroupListMap[result.current.queryKey!].groups).toHaveLength(1);
    });
  });

  describe('useFetchTaskList', () => {
    const listKey = (
      options: Parameters<ReturnType<typeof useTaskStore.getState>['useFetchTaskList']>[0],
    ) =>
      renderHook(() => useTaskStore.getState().useFetchTaskList(options)).result.current.queryKey;

    it('requests only tasks from the selected project', async () => {
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchTaskList({ projectId: 'project-1', visibility: 'all' }),
      );

      const [list] = await syncCalls('taskList');
      await list.fetcher();
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1' }),
      );
      expect(taskService.list).toHaveBeenCalledWith(
        expect.not.objectContaining({ assigneeAgentId: expect.anything() }),
      );
    });

    it('allows embedded overviews to ignore the Task page visibility filter', async () => {
      const { taskService } = await import('@/services/task');
      useTaskStore.setState({ listVisibility: 'private' });

      renderHook(() =>
        useTaskStore.getState().useFetchTaskList({ allAgents: true, visibility: 'all' }),
      );

      const [list] = await syncCalls('taskList');
      await list.fetcher();
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: undefined }),
      );
    });

    // Home's recent block excludes live schedules and finished statuses
    // server-side, ordered by activity; the Tasks page walks everything by
    // creation. Every one of those has to be part of the list identity, or the
    // two surfaces would serve each other's rows.
    it('gives every ordering, filter and walk mode its own list entry', () => {
      const base = { allAgents: true, visibility: 'all' } as const;
      const keys = [
        listKey(base),
        listKey({ ...base, orderBy: 'updatedAt' }),
        listKey({ ...base, automated: false }),
        listKey({ ...base, statuses: ['running', 'backlog'] }),
        listKey({ ...base, complete: true }),
        listKey({ ...base, visibility: 'private' }),
        listKey({ agentId: 'agent-1', visibility: 'all' }),
        listKey({ projectId: 'project-1', visibility: 'all' }),
      ];
      expect(new Set(keys).size).toBe(keys.length);
      // The status set is order-insensitive.
      expect(listKey({ ...base, statuses: ['backlog', 'running'] })).toBe(keys[3]);
    });

    it('passes the automation and status filters to the server', async () => {
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchTaskList({
          allAgents: true,
          automated: false,
          orderBy: 'updatedAt',
          statuses: ['running', 'backlog'],
          visibility: 'all',
        }),
      );

      const [list] = await syncCalls('taskList');
      await list.fetcher();
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          automated: false,
          orderBy: 'updatedAt',
          statuses: ['backlog', 'running'],
        }),
      );
    });

    it('has no query key while disabled, so it claims no rows', () => {
      const { result } = renderHook(() =>
        useTaskStore.getState().useFetchTaskList({ allAgents: true, enabled: false }),
      );
      expect(result.current.queryKey).toBeUndefined();
    });
  });

  describe('useFetchScheduledTaskList', () => {
    it('keys and requests the selected scheduled-task page', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, offset: 50 }),
      );

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:scheduledList', '__all__', 'all', { limit: 50, offset: 50 }],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => Promise<unknown>;
      await fetcher();
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ automated: true, limit: 50, offset: 50 }),
      );
    });

    it('scopes the scheduled roll-up to one agent, key included', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchScheduledTaskList({ agentId: 'agent-1', limit: 50 }),
      );

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:scheduledList', 'agent-1', 'all', { limit: 50, offset: undefined }],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => Promise<unknown>;
      await fetcher();
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeAgentId: 'agent-1', automated: true }),
      );
    });

    it('scopes the scheduled roll-up to one project, key included', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, projectId: 'project-1' }),
      );

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:scheduledList', '__project__:project-1', 'all', { limit: 50, offset: undefined }],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => Promise<unknown>;
      await fetcher();
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ automated: true, projectId: 'project-1' }),
      );
    });

    it('keeps concurrent consumers isolated by their SWR keys', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');

      renderHook(() => useTaskStore.getState().useFetchScheduledTaskList({ limit: 5 }));
      renderHook(() =>
        useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, offset: 50 }),
      );

      expect(vi.mocked(useClientDataSWR).mock.calls.map(([key]) => key)).toEqual([
        ['task:scheduledList', '__all__', 'all', { limit: 5, offset: undefined }],
        ['task:scheduledList', '__all__', 'all', { limit: 50, offset: 50 }],
      ]);
    });
  });

  describe('setListVisibility', () => {
    it('updates the filter; each visibility reads its own list entry', () => {
      useTaskStore.getState().setListVisibility('workspace');
      expect(useTaskStore.getState().listVisibility).toBe('workspace');

      const { result } = renderHook(() =>
        useTaskStore.getState().useFetchTaskList({ allAgents: true }),
      );
      const workspaceKey = result.current.queryKey;
      act(() => useTaskStore.getState().setListVisibility('private'));
      const { result: privateList } = renderHook(() =>
        useTaskStore.getState().useFetchTaskList({ allAgents: true }),
      );
      expect(privateList.current.queryKey).not.toBe(workspaceKey);
    });
  });

  // The Tasks page renders every task it receives, grouped client-side, and
  // has no pagination. Without `complete` it only ever saw the first server
  // page (50 newest by creation), so older tasks silently vanished once a
  // workspace grew past that — e.g. a private task assigned to the viewer
  // showing under "Private" (few rows) but not under "All".
  describe('useFetchTaskList complete mode', () => {
    interface Row {
      createdAt: Date;
      id: string;
      seq: number;
    }
    // Newest-first, like the server: seq N is the newest row.
    const dataset = (size: number): Row[] =>
      Array.from({ length: size }, (_, i) => ({
        createdAt: new Date(2026, 0, 1, 0, 0, 0, size - i),
        id: `t${size - i}`,
        seq: size - i,
      }));
    // A keyset server: rows strictly after the `(createdAt, seq)` cursor.
    const serve = (rows: () => Row[]) =>
      vi.mocked(taskServiceList).mockImplementation(async ({ after, limit = 50 }: any) => {
        const all = rows();
        const start = after ? all.findIndex((r) => r.seq === after.seq) + 1 : 0;
        return { data: all.slice(start, start + limit), success: true, total: all.length } as any;
      });
    let taskServiceList: (...args: any[]) => any;
    const runFetcher = async (options: Record<string, unknown>) => {
      renderHook(() =>
        useTaskStore
          .getState()
          .useFetchTaskList({ allAgents: true, visibility: 'all', ...options }),
      );
      const [list] = await syncCalls('taskList');
      return list.fetcher() as Promise<{ data: Row[]; total: number }>;
    };

    beforeEach(async () => {
      taskServiceList = (await import('@/services/task')).taskService.list;
    });

    it('walks every page with a keyset cursor and merges them', async () => {
      const rows = dataset(230);
      serve(() => rows);

      const result = await runFetcher({ complete: true });

      expect(taskServiceList).toHaveBeenCalledTimes(3);
      expect(taskServiceList).toHaveBeenNthCalledWith(
        1,
        expect.not.objectContaining({ after: expect.anything() }),
      );
      expect(taskServiceList).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          after: { at: rows[99].createdAt, seq: rows[99].seq },
          limit: 100,
        }),
      );
      expect(taskServiceList).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ after: { at: rows[199].createdAt, seq: rows[199].seq } }),
      );
      expect(result.data).toHaveLength(230);
      expect(result.total).toBe(230);
    });

    it('issues a single request when the first page already holds everything', async () => {
      serve(() => dataset(12));

      const result = await runFetcher({ complete: true });

      expect(taskServiceList).toHaveBeenCalledTimes(1);
      expect(result.data).toHaveLength(12);
    });

    // An offset walk would re-read the row that slid into page one's slot and
    // never see the last live row; the cursor keeps walking from the last row
    // it holds, so nothing live is skipped.
    it('does not skip a row when a task is deleted between two pages', async () => {
      let rows = dataset(101);
      serve(() => rows);
      vi.mocked(taskServiceList).mockImplementationOnce(async (params: any) => {
        const page = rows.slice(0, params.limit);
        rows = rows.filter((r) => r.seq !== 50); // deleted after page one was read
        return { data: page, success: true, total: 101 } as any;
      });

      const result = await runFetcher({ complete: true });

      const ids = result.data.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain('t1'); // the last live row, which an offset walk drops
      expect(result.total).toBe(101);
    });

    it('stops at the row ceiling and keeps the real total so the UI can say so', async () => {
      serve(() => dataset(1500));

      const result = await runFetcher({ complete: true });

      expect(taskServiceList).toHaveBeenCalledTimes(10);
      expect(result.data).toHaveLength(1000);
      expect(result.total).toBe(1500);
    });

    it('keeps the single-page request for callers that do not opt in', async () => {
      serve(() => dataset(230));

      await runFetcher({});

      expect(taskServiceList).toHaveBeenCalledTimes(1);
      expect(taskServiceList).toHaveBeenCalledWith(
        expect.not.objectContaining({ limit: expect.anything() }),
      );
    });
  });
});
