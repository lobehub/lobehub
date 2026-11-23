// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addRepositories: vi.fn(),
  findById: vi.fn(),
  get: vi.fn(),
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

vi.mock('@/database/repositories/projectEnvironment', () => ({
  ProjectEnvironmentRepository: vi.fn(function () {
    return { addRepositories: mocks.addRepositories, get: mocks.get };
  }),
}));

vi.mock('@/database/models/environment', () => ({
  EnvironmentModel: vi.fn(function () {
    return { findById: mocks.findById };
  }),
}));

const { projectWorkingDirectoryRouter } = await import('../projectWorkingDirectory');

const caller = () =>
  projectWorkingDirectoryRouter.createCaller({ userId: 'user-1', workspaceId: null } as never);

/**
 * Clients built before a project had one environment still call these; each
 * maps onto the single environment instead of failing as an unknown procedure.
 */
describe('projectWorkingDirectory compatibility procedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addRepositories.mockResolvedValue({ id: 'env-1' });
    mocks.get.mockResolvedValue({ id: 'env-1' });
  });

  it('attachRepository adds the repository to the project environment', async () => {
    await expect(
      caller().attachRepository({
        projectId: 'project-1',
        repository: {
          defaultBranch: 'main',
          name: 'a/one',
          url: 'https://github.com/a/one',
        },
      }),
    ).resolves.toEqual({ data: { id: 'env-1' }, success: true });
    expect(mocks.addRepositories).toHaveBeenCalledWith('project-1', [
      { sources: [{ kind: 'git', ref: 'main', url: 'https://github.com/a/one' }] },
    ]);
  });

  it('attachRepository refuses a URL the environment cannot clone', async () => {
    await expect(
      caller().attachRepository({
        projectId: 'project-1',
        repository: { name: 'x', url: 'http://example.com/x' },
      }),
    ).rejects.toThrow('Unsupported repository URL');
    expect(mocks.addRepositories).not.toHaveBeenCalled();
  });

  it("attachEnvironment adds the environment's repositories", async () => {
    const configuration = { sources: [{ kind: 'git', url: 'https://github.com/a/two' }] };
    mocks.findById.mockResolvedValue({ configuration, id: 'standalone' });

    await caller().attachEnvironment({
      environmentId: '6f1c1b2e-6c8a-4b8e-9a52-6e7b8f1d2c3a',
      projectId: 'project-1',
    });
    expect(mocks.addRepositories).toHaveBeenCalledWith('project-1', [configuration]);
  });

  it('detachEnvironment changes nothing and returns the environment', async () => {
    await expect(
      caller().detachEnvironment({
        environmentId: '6f1c1b2e-6c8a-4b8e-9a52-6e7b8f1d2c3a',
        projectId: 'project-1',
      }),
    ).resolves.toEqual({ data: { id: 'env-1' }, success: true });
    expect(mocks.addRepositories).not.toHaveBeenCalled();
  });
});
