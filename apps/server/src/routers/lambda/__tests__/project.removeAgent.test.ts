// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  leaveProjectChannels: vi.fn(),
  removeAgent: vi.fn(),
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
  ProjectIdentifierTakenError: class extends Error {},
  ProjectModel: vi.fn(function () {
    return { removeAgent: mocks.removeAgent };
  }),
}));

vi.mock('@/database/repositories/projectCoordinator', () => ({
  ProjectCoordinatorRepository: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/channel/projectMembership', () => ({
  leaveProjectChannels: mocks.leaveProjectChannels,
}));

const { projectRouter } = await import('../project');

const caller = () => projectRouter.createCaller({ userId: 'member', workspaceId: 'ws-1' } as never);

describe('project.removeAgent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('takes the Agent out of the project’s Channels too', async () => {
    mocks.removeAgent.mockResolvedValue(true);

    await caller().removeAgent({ agentId: 'agent-2', id: 'project-1' });

    expect(mocks.removeAgent).toHaveBeenCalledWith('project-1', 'agent-2');
    expect(mocks.leaveProjectChannels).toHaveBeenCalledWith({}, 'project-1', 'agent-2');
  });

  it('leaves Channels alone when the caller could not remove it from the project', async () => {
    mocks.removeAgent.mockResolvedValue(false);

    await expect(
      caller().removeAgent({ agentId: 'agent-2', id: 'project-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.leaveProjectChannels).not.toHaveBeenCalled();
  });
});
