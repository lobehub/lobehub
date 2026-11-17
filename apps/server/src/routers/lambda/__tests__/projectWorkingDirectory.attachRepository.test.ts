// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachEnvironment: vi.fn(),
  ensureForRepository: vi.fn(),
  findManageableById: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function () {
    return {
      attachEnvironment: mocks.attachEnvironment,
      findManageableById: mocks.findManageableById,
    };
  }),
}));

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return { ensureForRepository: mocks.ensureForRepository };
  }),
}));

vi.mock('@/server/services/aiAgent/pipeline/precreatedTopic', () => ({
  createAgentConfigResolver: vi.fn(),
  resolvePrecreatedTopicSnapshot: vi.fn(),
}));

const { projectWorkingDirectoryRouter } = await import('../projectWorkingDirectory');

const caller = () =>
  projectWorkingDirectoryRouter.createCaller({ userId: 'member', workspaceId: 'ws-1' } as never);
const input = {
  projectId: 'project-1',
  repository: { name: 'lobehub/lobe-tts', url: 'https://github.com/lobehub/lobe-tts' },
};

describe('projectWorkingDirectory.attachRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureForRepository.mockResolvedValue({ id: 'env-repo', name: 'lobehub/lobe-tts' });
  });

  // The composer's "add a repository" used the generic environment dialog,
  // which without a GitHub integration made an environment with no repository
  // at all — linked to the project, and never offered as one.
  it('links an environment that checks the repository out', async () => {
    mocks.findManageableById.mockResolvedValue({ id: 'project-1' });

    const result = await caller().attachRepository(input);

    expect(mocks.ensureForRepository).toHaveBeenCalledWith({
      defaultBranch: undefined,
      name: 'lobehub/lobe-tts',
      repositoryUrl: 'https://github.com/lobehub/lobe-tts',
      visibility: undefined,
    });
    expect(mocks.attachEnvironment).toHaveBeenCalledWith('project-1', 'env-repo');
    expect(result.data).toEqual({ id: 'env-repo', name: 'lobehub/lobe-tts' });
  });

  it('makes nothing for a project the caller cannot manage', async () => {
    mocks.findManageableById.mockResolvedValue(null);

    await expect(caller().attachRepository(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.ensureForRepository).not.toHaveBeenCalled();
  });

  // A workspace-public agent applies published environments only.
  it('publishes the environment when asked to', async () => {
    mocks.findManageableById.mockResolvedValue({ id: 'project-1' });

    await caller().attachRepository({ ...input, visibility: 'public' });

    expect(mocks.ensureForRepository).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });
});
