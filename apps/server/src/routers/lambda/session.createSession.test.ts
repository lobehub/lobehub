// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionRouter } from './session';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createAgentDirectChannel: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn(function () {
    return { createAgent: mocks.createAgent };
  }),
}));
vi.mock('@/server/services/channel/defaultChannel', () => ({
  createAgentDirectChannel: mocks.createAgentDirectChannel,
}));

const caller = (workspaceId?: string) =>
  sessionRouter.createCaller({ userId: 'owner', workspaceId } as never);

const input = {
  config: { title: 'Health Assistant' },
  session: {},
  type: 'agent' as const,
};

describe('session.createSession direct Channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAgent.mockResolvedValue({ agentId: 'agt_new' });
  });

  it("opens the creator's direct Channel to the Agent it creates", async () => {
    await expect(caller('ws-1').createSession(input)).resolves.toBe('agt_new');

    expect(mocks.createAgentDirectChannel).toHaveBeenCalledWith({
      agentId: 'agt_new',
      db: {},
      userId: 'owner',
      workspaceId: 'ws-1',
    });
  });

  it('opens nothing for a refused group session', async () => {
    await expect(caller().createSession({ ...input, type: 'group' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.createAgentDirectChannel).not.toHaveBeenCalled();
  });
});
