import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  useClientDataSWR: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    groupListQueryAutomated: undefined,
    isTaskGroupListInit: false,
    isTaskListInit: false,
    listAgentId: undefined,
    listGroupBy: 'status',
    listGroupExcludeStatuses: undefined,
    listQueryAutomated: undefined,
    listQueryComplete: false,
    listQueryVisibility: 'all',
    listVisibility: 'all',
    taskGroups: [],
    tasks: [],
    tasksTotal: 0,
  });
});

describe('TaskListSliceAction', () => {
  describe('setListAgentId', () => {
    it('should update listAgentId', () => {
      useTaskStore.getState().setListAgentId('agt_1');
      expect(useTaskStore.getState().listAgentId).toBe('agt_1');
    });

    it('should clear listAgentId with undefined', () => {
      useTaskStore.getState().setListAgentId('agt_1');
      useTaskStore.getState().setListAgentId(undefined);
      expect(useTaskStore.getState().listAgentId).toBeUndefined();
    });
  });

  describe('refreshTaskList', () => {
    // An edit can move a task across every list boundary at once — reorder it
    // by `updatedAt`, change its visibility, attach a schedule that flips
    // Home's automation filter — so refresh matches every `task:list` variant
    // by key root instead of enumerating them.
    it('invalidates every cached list variant by key root', async () => {
      const { mutate } = await import('@/libs/swr');
      useTaskStore.setState({
        listAgentId: 'agt_1',
        listQueryVisibility: 'private',
        listVisibility: 'private',
      });

      await useTaskStore.getState().refreshTaskList();

      const matcher = vi
        .mocked(mutate)
        .mock.calls.map(([arg]) => arg)
        .find((arg): arg is (key: unknown) => boolean => typeof arg === 'function');
      expect(matcher).toBeDefined();
      // The Tasks page's entry, Home's activity-ordered filtered entry, and a
      // project-scoped entry all match…
      expect(matcher!(['task:list', 'agt_1', 'private', 'createdAt'])).toBe(true);
      expect(matcher!(['task:list', '__all__', 'all', 'updatedAt', { automated: false }])).toBe(
        true,
      );
      expect(matcher!(['task:list', '__project__:p1', 'all', 'createdAt', 'p1'])).toBe(true);
      // …while other task caches are refreshed through their own keys.
      expect(matcher!(['task:groupList', 'agt_1', 'private'])).toBe(false);
    });
  });

  describe('useFetchTaskGroupList', () => {
    it('keys and requests assignee groups independently from status groups', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchTaskGroupList({
          allAgents: true,
          automated: false,
          excludeStatuses: ['completed', 'canceled'],
          groupBy: 'assignee',
        }),
      );

      expect(useClientDataSWR).toHaveBeenCalledWith(
        [
          'task:groupList',
          '__all__',
          'all',
          'assignee',
          'canceled,completed',
          { automated: false },
        ],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => unknown;
      await fetcher();
      expect(taskService.groupList).toHaveBeenCalledWith({
        assigneeAgentId: undefined,
        automated: false,
        excludeStatuses: ['completed', 'canceled'],
        groupBy: 'assignee',
        projectId: undefined,
        visibility: undefined,
      });
    });

    it('resets a changed group query scope after render and gates stale data meanwhile', () => {
      useTaskStore.setState({
        isTaskGroupListInit: true,
        listAgentId: '__all__',
        listGroupBy: 'status',
        listGroupExcludeStatuses: undefined,
        taskGroups: [{ key: 'backlog', tasks: [{ identifier: 'T-1' }], total: 1 }] as any,
      });
      let groupByObservedDuringRender: string | undefined;

      const { result } = renderHook(() => {
        const swr = useTaskStore
          .getState()
          .useFetchTaskGroupList({ allAgents: true, groupBy: 'assignee' });
        groupByObservedDuringRender = useTaskStore.getState().listGroupBy;
        return swr;
      });

      expect(groupByObservedDuringRender).toBe('status');
      expect(result.current.isQueryScopeCurrent).toBe(false);
      expect(useTaskStore.getState()).toMatchObject({
        isTaskGroupListInit: false,
        listGroupBy: 'assignee',
        taskGroups: [],
      });
    });
  });

  describe('useFetchTaskList', () => {
    it('requests only tasks from the selected project', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      useTaskStore.getState().useFetchTaskList({ projectId: 'project-1', visibility: 'all' });

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:list', '__project__:project-1', 'all', 'createdAt', 'project-1'],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as (key: string[]) => unknown;
      await fetcher(['task:list', '__project__:project-1', 'all', 'project-1']);
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1' }),
      );
      expect(taskService.list).toHaveBeenCalledWith(
        expect.not.objectContaining({ assigneeAgentId: expect.anything() }),
      );
    });

    it('allows embedded overviews to ignore the Task page visibility filter', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      useTaskStore.setState({ listVisibility: 'private' });

      useTaskStore.getState().useFetchTaskList({ allAgents: true, visibility: 'all' });

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:list', '__all__', 'all', 'createdAt'],
        expect.any(Function),
        expect.any(Object),
      );
    });

    // Without the ordering in the key, Home and the Tasks page share one cache
    // entry and whichever mounts first decides the other's order.
    it('keys the cache by ordering so two surfaces cannot serve each other stale order', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');

      useTaskStore
        .getState()
        .useFetchTaskList({ allAgents: true, orderBy: 'updatedAt', visibility: 'all' });

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:list', '__all__', 'all', 'updatedAt'],
        expect.any(Function),
        expect.any(Object),
      );
    });

    // Home's recent block excludes live schedules and finished statuses
    // server-side. Both filters have to reach the request and the cache key, or
    // Home and the Tasks page would serve each other's list from one shared
    // entry.
    it('passes the automation and status filters to the server and keys the cache by them', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      useTaskStore.getState().useFetchTaskList({
        allAgents: true,
        automated: false,
        orderBy: 'updatedAt',
        statuses: ['running', 'backlog'],
        visibility: 'all',
      });

      expect(useClientDataSWR).toHaveBeenCalledWith(
        // The key's status signature is order-insensitive.
        [
          'task:list',
          '__all__',
          'all',
          'updatedAt',
          { automated: false, statuses: 'backlog,running' },
        ],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as (
        key: unknown[],
      ) => Promise<unknown>;
      await fetcher(['task:list', '__all__', 'all', 'updatedAt', {}]);
      expect(taskService.list).toHaveBeenCalledWith(
        expect.objectContaining({ automated: false, statuses: ['running', 'backlog'] }),
      );
    });

    it('resets stale task data when the automation filter changes the query scope', () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listAgentId: '__all__',
        listQueryAutomated: undefined,
        listQueryVisibility: 'all',
        listVisibility: 'all',
        tasks: [{ id: 'cron-task' }] as any,
        tasksTotal: 1,
      });

      useTaskStore
        .getState()
        .useFetchTaskList({ allAgents: true, automated: false, visibility: 'all' });

      const state = useTaskStore.getState();
      expect(state.listQueryAutomated).toBe(false);
      expect(state.tasks).toEqual([]);
      expect(state.tasksTotal).toBe(0);
      expect(state.isTaskListInit).toBe(false);
    });

    // The list view walks every page while the kanban view (which fetches its
    // own server groups) only needs one page for the empty decision. Neither
    // may be served the other's rows from a shared cache entry or the shared
    // store field.
    it('keys the complete walk apart from the single page and resets when it flips', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      useTaskStore.setState({
        isTaskListInit: true,
        listAgentId: '__all__',
        listQueryComplete: false,
        tasks: [{ id: 'first-page-only' }] as any,
        tasksTotal: 230,
      });

      useTaskStore
        .getState()
        .useFetchTaskList({ allAgents: true, complete: true, visibility: 'all' });

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:list', '__all__', 'all', 'createdAt', { complete: true }],
        expect.any(Function),
        expect.any(Object),
      );
      const state = useTaskStore.getState();
      expect(state.listQueryComplete).toBe(true);
      expect(state.tasks).toEqual([]);
      expect(state.isTaskListInit).toBe(false);
    });

    it('resets stale task data when the status filter changes the query scope', () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listAgentId: '__all__',
        listQueryStatuses: undefined,
        listQueryVisibility: 'all',
        listVisibility: 'all',
        tasks: [{ id: 'completed-task' }] as any,
        tasksTotal: 1,
      });

      useTaskStore
        .getState()
        .useFetchTaskList({ allAgents: true, statuses: ['running', 'backlog'], visibility: 'all' });

      const state = useTaskStore.getState();
      expect(state.listQueryStatuses).toBe('backlog,running');
      expect(state.tasks).toEqual([]);
      expect(state.tasksTotal).toBe(0);
      expect(state.isTaskListInit).toBe(false);
    });

    it('resets stale task data when an embedded visibility override changes the query scope', () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listAgentId: '__all__',
        listQueryVisibility: 'private',
        listVisibility: 'private',
        tasks: [{ id: 'private-task' }] as any,
        tasksTotal: 1,
      });

      useTaskStore.getState().useFetchTaskList({ allAgents: true, visibility: 'all' });

      const state = useTaskStore.getState();
      expect(state.listQueryVisibility).toBe('all');
      expect(state.tasks).toEqual([]);
      expect(state.tasksTotal).toBe(0);
      expect(state.isTaskListInit).toBe(false);
    });
  });

  describe('useFetchTaskGroupList', () => {
    it('passes the ordinary-task automation filter through the kanban query', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      renderHook(() =>
        useTaskStore.getState().useFetchTaskGroupList({ allAgents: true, automated: false }),
      );

      expect(useClientDataSWR).toHaveBeenCalledWith(
        ['task:groupList', '__all__', 'all', { automated: false }],
        expect.any(Function),
        expect.any(Object),
      );
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as () => Promise<unknown>;
      await fetcher();
      expect(taskService.groupList).toHaveBeenCalledWith(
        expect.objectContaining({ automated: false }),
      );
    });
  });

  describe('useFetchScheduledTaskList', () => {
    it('keys and requests the selected scheduled-task page', async () => {
      const { useClientDataSWR } = await import('@/libs/swr');
      const { taskService } = await import('@/services/task');

      useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, offset: 50 });

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

      useTaskStore.getState().useFetchScheduledTaskList({ agentId: 'agent-1', limit: 50 });

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

      useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, projectId: 'project-1' });

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

      useTaskStore.getState().useFetchScheduledTaskList({ limit: 5 });
      useTaskStore.getState().useFetchScheduledTaskList({ limit: 50, offset: 50 });

      expect(vi.mocked(useClientDataSWR).mock.calls.map(([key]) => key)).toEqual([
        ['task:scheduledList', '__all__', 'all', { limit: 5, offset: undefined }],
        ['task:scheduledList', '__all__', 'all', { limit: 50, offset: 50 }],
      ]);
    });
  });

  describe('setListVisibility', () => {
    it('should update visibility filter and reset list state', async () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listVisibility: 'private',
        tasks: [{ id: 't1' }] as any,
        tasksTotal: 1,
      });

      useTaskStore.getState().setListVisibility('workspace');

      const state = useTaskStore.getState();
      expect(state.listVisibility).toBe('workspace');
      // Reset clears the previous-filter results so the chip flip doesn't
      // briefly render stale entries from the old filter.
      expect(state.tasks).toEqual([]);
      expect(state.tasksTotal).toBe(0);
      expect(state.isTaskListInit).toBe(false);
    });

    it('should no-op when the filter does not change', async () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listVisibility: 'private',
        tasks: [{ id: 't1' }] as any,
        tasksTotal: 1,
      });

      useTaskStore.getState().setListVisibility('private');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.isTaskListInit).toBe(true);
    });
  });
  // The Tasks page renders every task it receives, grouped client-side, and
  // has no pagination. Without `complete` it only ever saw the first server
  // page (50 newest by creation), so older tasks silently vanished once a
  // workspace grew past that — e.g. a private task assigned to the viewer
  // showing under "Private" (few rows) but not under "All" (LOBE-13779).
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
      const { useClientDataSWR } = await import('@/libs/swr');
      useTaskStore.getState().useFetchTaskList({ allAgents: true, visibility: 'all', ...options });
      const fetcher = vi.mocked(useClientDataSWR).mock.calls[0][1] as (
        key: unknown[],
      ) => Promise<{ data: Row[]; total: number }>;
      return fetcher(['task:list', '__all__', 'all', 'createdAt']);
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
