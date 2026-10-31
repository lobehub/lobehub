import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduledTaskListLoader } from './scheduledTaskListLoader';

const preHydrateScheduledTaskList = vi.fn(async () => true);
const activeWorkspace = vi.hoisted(() => ({ slug: null as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => activeWorkspace.slug,
}));

vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ preHydrateScheduledTaskList }),
}));

vi.mock('@/store/task/slices/list/action', () => ({ TASK_COLLECTION_PAGE_SIZE: 50 }));

const request = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => {
  preHydrateScheduledTaskList.mockClear();
  activeWorkspace.slug = null;
});

describe('scheduledTaskListLoader', () => {
  it('seeds the first scheduled page of the scope the URL opens', async () => {
    await expect(
      scheduledTaskListLoader({
        params: { aid: 'agt_1' },
        request: request('/agent/agt_1/tasks?collection=scheduled'),
      }),
    ).resolves.toBeNull();

    expect(preHydrateScheduledTaskList).toHaveBeenCalledWith({
      agentId: 'agt_1',
      limit: 50,
      offset: 0,
      projectId: undefined,
    });
  });

  it('passes the project scope through', async () => {
    await scheduledTaskListLoader({
      params: { projectId: 'proj_1' },
      request: request('/project/proj_1/tasks?collection=scheduled'),
    });

    expect(preHydrateScheduledTaskList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj_1' }),
    );
  });

  it('reads nothing for the other tabs', async () => {
    await scheduledTaskListLoader({ params: {}, request: request('/tasks') });
    await scheduledTaskListLoader({ params: {}, request: request('/tasks?collection=mine') });

    expect(preHydrateScheduledTaskList).not.toHaveBeenCalled();
  });

  it('seeds the page when the URL opens the workspace already active', async () => {
    activeWorkspace.slug = 'acme';

    await scheduledTaskListLoader({
      params: { workspaceSlug: 'acme' },
      request: request('/acme/tasks?collection=scheduled'),
    });

    expect(preHydrateScheduledTaskList).toHaveBeenCalledOnce();
  });

  // The workspace switch lands after the route commits, so the active cache
  // scope still belongs to the workspace being left.
  it('reads nothing while the URL switches workspace', async () => {
    await scheduledTaskListLoader({
      params: { workspaceSlug: 'acme' },
      request: request('/acme/tasks?collection=scheduled'),
    });

    activeWorkspace.slug = 'acme';
    await scheduledTaskListLoader({
      params: { workspaceSlug: 'globex' },
      request: request('/globex/tasks?collection=scheduled'),
    });
    await scheduledTaskListLoader({
      params: {},
      request: request('/tasks?collection=scheduled'),
    });

    expect(preHydrateScheduledTaskList).not.toHaveBeenCalled();
  });

  it('never holds the route past the pre-paint deadline', async () => {
    vi.useFakeTimers();
    preHydrateScheduledTaskList.mockReturnValueOnce(new Promise(() => {}));

    const settled = scheduledTaskListLoader({
      params: {},
      request: request('/tasks?collection=scheduled'),
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(settled).resolves.toBeNull();
    vi.useRealTimers();
  });
});
