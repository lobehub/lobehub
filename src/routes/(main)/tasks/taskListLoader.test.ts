import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeTaskListViewOptions } from '@/features/AgentTasks/AgentTaskList/listViewOptions';
import { getMyTaskListOptions } from '@/features/AgentTasks/AgentTaskList/myTaskListOptions';
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';

import { taskListLoader } from './taskListLoader';

const preHydrateScheduledTaskList = vi.fn(async () => true);
const preHydrateMyTaskList = vi.fn(async () => true);
const activeWorkspace = vi.hoisted(() => ({
  id: null as string | null,
  slug: null as string | null,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => activeWorkspace.slug,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => activeWorkspace.id,
}));

vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ preHydrateMyTaskList, preHydrateScheduledTaskList }),
}));

vi.mock('@/store/task/slices/list/action', () => ({
  SCHEDULED_TASK_RECENT_RUNS: 5,
  TASK_COLLECTION_PAGE_SIZE: 50,
}));

const request = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => {
  preHydrateScheduledTaskList.mockClear();
  preHydrateMyTaskList.mockClear();
  activeWorkspace.id = null;
  activeWorkspace.slug = null;
  useGlobalStore.setState({ status: { ...INITIAL_STATUS } });
});

describe('taskListLoader', () => {
  it('seeds the first scheduled page of the scope the URL opens', async () => {
    await expect(
      taskListLoader({
        params: { aid: 'agt_1' },
        request: request('/agent/agt_1/tasks?collection=scheduled'),
      }),
    ).resolves.toBeNull();

    expect(preHydrateScheduledTaskList).toHaveBeenCalledWith({
      agentId: 'agt_1',
      limit: 50,
      offset: 0,
      projectId: undefined,
      // The page asks for the same rows; a different key would miss the seed.
      recentRuns: 5,
    });
  });

  it('passes the project scope through', async () => {
    await taskListLoader({
      params: { projectId: 'proj_1' },
      request: request('/project/proj_1/tasks?collection=scheduled'),
    });

    expect(preHydrateScheduledTaskList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj_1' }),
    );
  });

  it('reads nothing for the ordinary list', async () => {
    // Personal mode has no "My tasks" tab, so the bare URL is the ordinary list.
    await taskListLoader({ params: {}, request: request('/tasks') });
    await taskListLoader({ params: {}, request: request('/tasks?collection=mine') });
    activeWorkspace.id = 'ws_1';
    await taskListLoader({ params: {}, request: request('/tasks?collection=all') });

    expect(preHydrateScheduledTaskList).not.toHaveBeenCalled();
    expect(preHydrateMyTaskList).not.toHaveBeenCalled();
  });

  describe('"My tasks"', () => {
    beforeEach(() => {
      activeWorkspace.id = 'ws_1';
    });

    // Regression: the workspace's landing tab painted its skeleton until the
    // page's own post-commit IndexedDB read landed.
    it('seeds the first page the landing tab syncs', async () => {
      await taskListLoader({ params: {}, request: request('/tasks') });

      expect(preHydrateMyTaskList).toHaveBeenCalledWith(
        getMyTaskListOptions({
          page: 1,
          scope: 'assigned',
          viewOptions: normalizeTaskListViewOptions(INITIAL_STATUS.taskListViewOptions),
        }),
      );
    });

    it('reads the sub-tab, display options and stored filter the page reads', async () => {
      const filter = { priority: { operator: 'is', values: [1] } } as const;
      useGlobalStore.setState({
        status: {
          ...INITIAL_STATUS,
          taskListFilters: [{ filter, scope: 'ws_1:global' }],
          taskListViewOptions: {
            ...INITIAL_STATUS.taskListViewOptions,
            completedTasks: 'none',
            showArchived: true,
          } as never,
        },
      });

      await taskListLoader({ params: {}, request: request('/tasks?scope=created') });

      expect(preHydrateMyTaskList).toHaveBeenCalledWith(
        expect.objectContaining({
          filter,
          includeArchived: true,
          offset: 0,
          scope: 'created',
          statuses: expect.not.arrayContaining(['completed']),
        }),
      );
    });

    it('reads nothing when the tab shows a board', async () => {
      useGlobalStore.setState({ status: { ...INITIAL_STATUS, taskListViewMode: 'kanban' } });

      await taskListLoader({ params: {}, request: request('/tasks') });

      expect(preHydrateMyTaskList).not.toHaveBeenCalled();
    });

    it('reads nothing on agent and project pages, which have no "My tasks" tab', async () => {
      await taskListLoader({ params: { aid: 'agt_1' }, request: request('/agent/agt_1/tasks') });
      await taskListLoader({
        params: { projectId: 'proj_1' },
        request: request('/project/proj_1/tasks'),
      });

      expect(preHydrateMyTaskList).not.toHaveBeenCalled();
    });
  });

  it('seeds the page when the URL opens the workspace already active', async () => {
    activeWorkspace.slug = 'acme';

    await taskListLoader({
      params: { workspaceSlug: 'acme' },
      request: request('/acme/tasks?collection=scheduled'),
    });

    expect(preHydrateScheduledTaskList).toHaveBeenCalledOnce();
  });

  // The workspace switch lands after the route commits, so the active cache
  // scope still belongs to the workspace being left.
  it('reads nothing while the URL switches workspace', async () => {
    await taskListLoader({
      params: { workspaceSlug: 'acme' },
      request: request('/acme/tasks?collection=scheduled'),
    });

    activeWorkspace.slug = 'acme';
    await taskListLoader({
      params: { workspaceSlug: 'globex' },
      request: request('/globex/tasks?collection=scheduled'),
    });
    await taskListLoader({
      params: {},
      request: request('/tasks?collection=scheduled'),
    });

    expect(preHydrateScheduledTaskList).not.toHaveBeenCalled();
  });

  it('never holds the route past the pre-paint deadline', async () => {
    vi.useFakeTimers();
    preHydrateScheduledTaskList.mockReturnValueOnce(new Promise(() => {}));

    const settled = taskListLoader({
      params: {},
      request: request('/tasks?collection=scheduled'),
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(settled).resolves.toBeNull();
    vi.useRealTimers();
  });
});
