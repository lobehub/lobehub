import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findEnvironmentById: vi.fn(),
  getAgentVisibility: vi.fn(),
  listEnvironments: vi.fn(),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function () {
    return { listEnvironments: mocks.listEnvironments };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentVisibility: mocks.getAgentVisibility };
  }),
}));

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return { findById: mocks.findEnvironmentById };
  }),
}));

const { resolveProjectTopicSandbox } = await import('../projectPlacement');

const db = {} as LobeChatDatabase;
const gitConfiguration = {
  kind: 'code',
  sources: [{ kind: 'git', url: 'https://github.com/lobehub-biz/agent-mail' }],
};
const repository = {
  configuration: gitConfiguration,
  id: 'env-repo',
  name: 'lobehub-biz/agent-mail',
  visibility: 'private',
};

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveProjectTopicSandbox({ db, projectId: 'proj_1', userId: 'user_1', ...overrides });

describe('resolveProjectTopicSandbox', () => {
  beforeEach(() => {
    mocks.listEnvironments.mockReset().mockResolvedValue([repository]);
    mocks.findEnvironmentById.mockReset().mockResolvedValue(repository);
    mocks.getAgentVisibility.mockReset().mockResolvedValue('private');
  });

  it("works in the project's repository, checked out in the project's folder", async () => {
    await expect(resolve()).resolves.toEqual({
      sandboxEnvironmentId: 'env-repo',
      sandboxWorkingDirectory: 'projects/proj_1/env-repo',
    });
  });

  // The public drive is every member's; a private checkout stays on the member's own.
  it('puts a private repository on the personal drive in a workspace', async () => {
    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toMatchObject({
      sandboxDrive: 'personal',
    });
  });

  it('puts a published repository on the public drive', async () => {
    mocks.findEnvironmentById.mockResolvedValue({ ...repository, visibility: 'public' });

    await expect(resolve({ workspaceId: 'ws-1' })).resolves.toMatchObject({
      sandboxDrive: 'public',
    });
  });

  it('skips linked environments that have no repository', async () => {
    mocks.listEnvironments.mockResolvedValue([
      { configuration: {}, id: 'env-empty', name: 'Cloud device (node)' },
      repository,
    ]);

    await expect(resolve()).resolves.toMatchObject({ sandboxEnvironmentId: 'env-repo' });
    expect(mocks.findEnvironmentById).toHaveBeenCalledWith('env-repo');
  });

  it('uses the repository the composer picked', async () => {
    const other = { ...repository, id: 'env-other', name: 'lobehub/lobe-tts' };
    mocks.listEnvironments.mockResolvedValue([repository, other]);
    mocks.findEnvironmentById.mockResolvedValue(other);

    await expect(resolve({ environmentId: 'env-other' })).resolves.toEqual({
      sandboxEnvironmentId: 'env-other',
      sandboxWorkingDirectory: 'projects/proj_1/env-other',
    });
  });

  // A workspace-public agent applies published environments only; picking a
  // private one would show a repository the run then never clones.
  it('never gives a workspace-public agent a private repository', async () => {
    mocks.getAgentVisibility.mockResolvedValue('public');

    await expect(resolve({ agentId: 'agt-shared', workspaceId: 'ws-1' })).resolves.toEqual({});
    await expect(
      resolve({ agentId: 'agt-shared', environmentId: 'env-repo', workspaceId: 'ws-1' }),
    ).resolves.toEqual({});
    expect(mocks.findEnvironmentById).not.toHaveBeenCalled();
  });

  it('gives a workspace-public agent the published repository', async () => {
    const published = { ...repository, id: 'env-pub', visibility: 'public' };
    mocks.getAgentVisibility.mockResolvedValue('public');
    mocks.listEnvironments.mockResolvedValue([repository, published]);
    mocks.findEnvironmentById.mockResolvedValue(published);

    await expect(resolve({ agentId: 'agt-shared', workspaceId: 'ws-1' })).resolves.toMatchObject({
      sandboxDrive: 'public',
      sandboxEnvironmentId: 'env-pub',
    });
  });

  it('ignores a pick that is not linked to the project', async () => {
    await expect(resolve({ environmentId: 'env-elsewhere' })).resolves.toEqual({});
    expect(mocks.findEnvironmentById).not.toHaveBeenCalled();
  });

  it('starts anywhere when the project has no repository', async () => {
    mocks.listEnvironments.mockResolvedValue([]);

    await expect(resolve()).resolves.toEqual({});
  });

  it('never throws', async () => {
    mocks.listEnvironments.mockRejectedValue(new Error('db down'));

    await expect(resolve()).resolves.toEqual({});
  });
});
