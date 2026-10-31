// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTurnProjectId } from './topicProject';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  resolveTask: vi.fn(),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.findById };
  }),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(function () {
    return { resolve: mocks.resolveTask };
  }),
}));

const deps = { db: {} as never, userId: 'user-1' };

describe('resolveTurnProjectId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockImplementation(async (id: string) => ({ id }));
    mocks.resolveTask.mockResolvedValue(null);
  });

  it('starts a new topic in the project the home page opened', async () => {
    await expect(
      resolveTurnProjectId(deps, { agentId: 'agt-1', requestedProjectId: 'proj-1' }),
    ).resolves.toBe('proj-1');
    expect(mocks.findById).toHaveBeenCalledWith('proj-1');
  });

  it('rejects a new topic in a project the caller cannot see', async () => {
    mocks.findById.mockResolvedValue(null);

    await expect(
      resolveTurnProjectId(deps, { agentId: 'agt-1', requestedProjectId: 'proj-hidden' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never re-homes an existing topic from the request', async () => {
    await expect(
      resolveTurnProjectId(deps, {
        requestedProjectId: 'proj-1',
        topicProjectId: null,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('prefers the directory and topic bindings over every other source', async () => {
    await expect(
      resolveTurnProjectId(deps, {
        directoryProjectId: 'proj-dir',
        requestedProjectId: 'proj-1',
      }),
    ).resolves.toBe('proj-dir');
    await expect(
      resolveTurnProjectId(deps, { agentId: 'agt-1', topicProjectId: 'proj-topic' }),
    ).resolves.toBe('proj-topic');
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("runs a task's turns inside the task's project", async () => {
    mocks.resolveTask.mockResolvedValue({ id: 'task-1', projectId: 'proj-task' });

    await expect(
      resolveTurnProjectId(deps, { agentId: 'agt-1', taskId: 'task-1', topicProjectId: null }),
    ).resolves.toBe('proj-task');
  });

  it('never infers a project from the agent alone, since main agents are shared', async () => {
    await expect(resolveTurnProjectId(deps, {})).resolves.toBeUndefined();
    await expect(resolveTurnProjectId(deps, { topicProjectId: null })).resolves.toBeUndefined();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('keeps share visitors out of the creator projects', async () => {
    await expect(
      resolveTurnProjectId(deps, {
        requestedProjectId: 'proj-1',
        shareGate: {} as never,
      }),
    ).resolves.toBeUndefined();
  });
});
