import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduledTaskListLoader } from './scheduledTaskListLoader';

const preHydrateScheduledTaskList = vi.fn(async () => true);

vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ preHydrateScheduledTaskList }),
}));

vi.mock('@/store/task/slices/list/action', () => ({ TASK_COLLECTION_PAGE_SIZE: 50 }));

const request = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => {
  preHydrateScheduledTaskList.mockClear();
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
