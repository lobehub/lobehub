// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTurnProjectId, withProjectSandbox } from './topicProject';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  resolveProjectTopicSandbox: vi.fn(),
  resolveTask: vi.fn(),
}));

vi.mock('@/server/services/sandbox/projectPlacement', () => ({
  resolveProjectTopicSandbox: mocks.resolveProjectTopicSandbox,
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

describe('withProjectSandbox', () => {
  const sandbox = {
    sandboxEnvironmentId: 'env-repo',
    sandboxWorkingDirectory: 'projects/atlas/repo',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectTopicSandbox.mockResolvedValue(sandbox);
  });

  // The sidebar's new topic is created by the run, not by the project home, so
  // the repository has to be applied here too.
  it("puts a new project conversation in the project's checkout", async () => {
    await expect(
      withProjectSandbox(deps, {
        agentId: 'agt-1',
        hasDirectory: false,
        metadata: { reasoningConfig: { effort: 'high' } } as never,
        projectId: 'proj-1',
      }),
    ).resolves.toEqual({ reasoningConfig: { effort: 'high' }, ...sandbox });
    expect(mocks.resolveProjectTopicSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt-1', projectId: 'proj-1', userId: 'user-1' }),
    );
  });

  it('keeps a pick the composer already made', async () => {
    const metadata = { sandboxWorkingDirectory: 'notes' };

    await expect(
      withProjectSandbox(deps, { hasDirectory: false, metadata, projectId: 'proj-1' }),
    ).resolves.toBe(metadata);
    expect(mocks.resolveProjectTopicSandbox).not.toHaveBeenCalled();
  });

  // An explicit temporary-sandbox pick used to arrive as no pick at all and
  // was given the project's persistent checkout.
  it('keeps an explicit temporary sandbox, and does not store the marker', async () => {
    await expect(
      withProjectSandbox(deps, {
        hasDirectory: false,
        metadata: { sandboxTemporary: true },
        projectId: 'proj-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      withProjectSandbox(deps, {
        hasDirectory: false,
        metadata: { reasoningConfig: { effort: 'high' }, sandboxTemporary: true } as never,
        projectId: 'proj-1',
      }),
    ).resolves.toEqual({ reasoningConfig: { effort: 'high' } });
    expect(mocks.resolveProjectTopicSandbox).not.toHaveBeenCalled();
  });

  // A drive-entitled composer seeds the drive root before anyone picks; taking
  // that as a pick kept project conversations out of the project's repository.
  it("puts the project's checkout in place of a default nobody picked", async () => {
    await expect(
      withProjectSandbox(deps, {
        hasDirectory: false,
        metadata: { sandboxDrive: 'personal', sandboxSeeded: true, sandboxWorkingDirectory: '.' },
        projectId: 'proj-1',
      }),
    ).resolves.toEqual(sandbox);
  });

  it('keeps the default when the project has no repository, without the marker', async () => {
    mocks.resolveProjectTopicSandbox.mockResolvedValue({});

    await expect(
      withProjectSandbox(deps, {
        hasDirectory: false,
        metadata: { sandboxSeeded: true, sandboxWorkingDirectory: '.' },
        projectId: 'proj-1',
      }),
    ).resolves.toEqual({ sandboxWorkingDirectory: '.' });
  });

  it('drops the marker outside a project too', async () => {
    await expect(
      withProjectSandbox(deps, {
        hasDirectory: false,
        metadata: { sandboxTemporary: true },
        projectId: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it('leaves a device directory conversation alone', async () => {
    await expect(
      withProjectSandbox(deps, { hasDirectory: true, metadata: undefined, projectId: 'proj-1' }),
    ).resolves.toBeUndefined();
  });

  it('leaves a conversation outside any project alone', async () => {
    await expect(
      withProjectSandbox(deps, { hasDirectory: false, metadata: undefined, projectId: undefined }),
    ).resolves.toBeUndefined();
  });

  it('keeps the metadata unchanged when the project has no repository', async () => {
    mocks.resolveProjectTopicSandbox.mockResolvedValue({});

    await expect(
      withProjectSandbox(deps, { hasDirectory: false, metadata: undefined, projectId: 'proj-1' }),
    ).resolves.toBeUndefined();
  });
});
