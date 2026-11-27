// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteProject: vi.fn(),
  deleteProjectKeepingChannels: vi.fn(),
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

vi.mock('@/database/repositories/project', () => ({
  ProjectRepository: vi.fn(function () {
    return { delete: mocks.deleteProject };
  }),
}));

vi.mock('@/database/repositories/projectCoordinator', () => ({
  ProjectCoordinatorRepository: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/channel/projectMembership', () => ({
  deleteProjectKeepingChannels: mocks.deleteProjectKeepingChannels,
  leaveProjectChannels: vi.fn(),
}));

const { projectRouter } = await import('../project');

const caller = () => projectRouter.createCaller({ userId: 'owner', workspaceId: 'ws-1' } as never);

describe('project.delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteProjectKeepingChannels.mockImplementation(
      (_db: unknown, _id: string, remove: () => Promise<unknown>) => remove(),
    );
  });

  it("deletes through the helper that tells the project's Channel members", async () => {
    mocks.deleteProject.mockResolvedValue({ id: 'project-1' });

    await expect(caller().delete({ id: 'project-1' })).resolves.toMatchObject({
      data: { id: 'project-1' },
      success: true,
    });
    expect(mocks.deleteProjectKeepingChannels).toHaveBeenCalledWith(
      {},
      'project-1',
      expect.any(Function),
    );
    expect(mocks.deleteProject).toHaveBeenCalledWith('project-1');
  });

  it('reports a project the caller cannot delete as not found', async () => {
    mocks.deleteProject.mockResolvedValue(null);

    await expect(caller().delete({ id: 'project-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
