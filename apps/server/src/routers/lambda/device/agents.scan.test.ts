// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentsRouter } from './agents';

const mocks = vi.hoisted(() => ({ executeToolCall: vi.fn() }));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRole: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
    wsProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB: {} } }),
}));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { executeToolCall: mocks.executeToolCall },
}));

const caller = () => agentsRouter.createCaller({ userId: 'user-1' } as never);

describe('device.scanAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeToolCall.mockResolvedValue({
      content: JSON.stringify({ agents: { codex: { available: true } } }),
      success: true,
    });
  });

  it('forwards the agent-type filter to the device scan tool', async () => {
    await expect(
      caller().scanAgents({ agentTypes: ['codex'], deviceId: 'device-1' }),
    ).resolves.toEqual({ agents: { codex: { available: true } } });

    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      { deviceId: 'device-1', userId: 'user-1', workspaceId: undefined },
      {
        apiName: 'scanHeterogeneousAgents',
        arguments: JSON.stringify({ agentTypes: ['codex'] }),
        identifier: 'local',
      },
      expect.any(Number),
    );
  });

  it('asks for a full scan when no filter is given', async () => {
    await caller().scanAgents({ deviceId: 'device-1' });

    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ arguments: '{}' }),
      expect.any(Number),
    );
  });
});
