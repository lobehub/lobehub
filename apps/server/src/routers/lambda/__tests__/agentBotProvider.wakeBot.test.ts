// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/business/server/bot/featureAccess', () => ({
  assertBotFeatureAccess: vi.fn(async () => {}),
  withBotPlatformAccessMeta: vi.fn((meta: any) => meta),
}));

const mockStartClient = vi.fn(async () => 'started');
vi.mock('@/server/services/gateway', () => ({
  GatewayService: vi.fn(function () {
    return { startClient: mockStartClient };
  }),
}));

const mockGetBotRuntimeStatus = vi.fn();
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: { connected: 'connected', sleeping: 'sleeping' },
  getBotRuntimeStatus: mockGetBotRuntimeStatus,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const mockMarkActive = vi.fn();
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn(function () {
    return { markActive: mockMarkActive };
  }),
}));

const { agentBotProviderRouter } = await import('../agentBotProvider');

const ctx: any = { serverDB: {}, userId: 'user-1' };
const input = { applicationId: 'app-1', platform: 'discord' };

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkActive.mockResolvedValue({ id: 'bot-1', previousLastActiveAt: new Date(0) });
});

describe('agentBotProviderRouter.wakeBot', () => {
  it('restarts the idle clock and reconnects a sleeping bot', async () => {
    mockGetBotRuntimeStatus.mockResolvedValue({ status: 'sleeping' });

    const result = await agentBotProviderRouter.createCaller(ctx).wakeBot(input);

    expect(result).toEqual({ woke: true });
    expect(mockMarkActive).toHaveBeenCalledWith('discord', 'app-1');
    expect(mockStartClient).toHaveBeenCalledWith('discord', 'app-1', 'user-1');
  });

  it('only restarts the clock of a bot that is not asleep', async () => {
    mockGetBotRuntimeStatus.mockResolvedValue({ status: 'connected' });

    const result = await agentBotProviderRouter.createCaller(ctx).wakeBot(input);

    expect(result).toEqual({ woke: false });
    expect(mockMarkActive).toHaveBeenCalled();
    expect(mockStartClient).not.toHaveBeenCalled();
  });

  it("refuses a bot the caller doesn't own", async () => {
    mockMarkActive.mockResolvedValue(undefined);

    await expect(agentBotProviderRouter.createCaller(ctx).wakeBot(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mockStartClient).not.toHaveBeenCalled();
  });
});
