// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lifecycleRouter } from './lifecycle';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createAgentDirectChannel: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/chatGroup', () => ({ ChatGroupModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/models/session', () => ({ SessionModel: vi.fn() }));
vi.mock('@/server/services/editLock', () => ({ EditLockService: vi.fn() }));
vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn(function () {
    return { createAgent: mocks.createAgent };
  }),
}));
vi.mock('@/server/services/channel/defaultChannel', () => ({
  createAgentDirectChannel: mocks.createAgentDirectChannel,
}));

const caller = (workspaceId?: string) =>
  lifecycleRouter.createCaller({ userId: 'owner', workspaceId } as never);

describe('agent.createAgent direct Channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAgent.mockResolvedValue({ agentId: 'agt_new' });
  });

  it.each([undefined, 'ws-1'])(
    "opens the creator's direct Channel to the new Agent in scope %s",
    async (workspaceId) => {
      const config = { name: '小满', title: 'Health Assistant' };
      await expect(
        caller(workspaceId).createAgent({ config, localDeviceId: 'desktop' }),
      ).resolves.toEqual({ agentId: 'agt_new' });

      // The device hint is for the Channel only; the Agent itself is created without it.
      expect(mocks.createAgent).toHaveBeenCalledWith({ config });
      expect(mocks.createAgentDirectChannel).toHaveBeenCalledWith({
        agentId: 'agt_new',
        db: {},
        localDeviceId: 'desktop',
        userId: 'owner',
        workspaceId,
      });
    },
  );

  it('opens nothing when the Agent was not created', async () => {
    mocks.createAgent.mockRejectedValue(new Error('A private agent cannot be created here'));

    await expect(caller('ws-1').createAgent({})).rejects.toThrow();
    expect(mocks.createAgentDirectChannel).not.toHaveBeenCalled();
  });
});
