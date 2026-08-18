import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskStore } from '../../store';

// Mock task service
vi.mock('@/services/task', () => ({
  taskService: {
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
    isTaskListInit: false,
    listAgentId: undefined,
    listQueryAutomated: undefined,
    listQueryVisibility: 'all',
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
});
