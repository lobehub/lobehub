// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({ enabled: false, nodePlatforms: [] as string[] }));

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

const WECOM = vi.hoisted(() => ({
  connectionMode: 'websocket',
  id: 'wecom',
  name: 'WeCom',
  repliesOverConnection: true,
  schema: [],
}));

vi.mock('@/server/services/bot/platforms', () => ({
  platformRegistry: {
    getPlatform: vi.fn((id: string) => (id === 'wecom' ? WECOM : undefined)),
    listSerializedPlatforms: vi.fn(() => [
      { connectionMode: 'websocket', id: 'qq', name: 'QQ', schema: [] },
      {
        connectionMode: 'websocket',
        id: 'wecom',
        name: 'WeCom',
        repliesOverConnection: true,
        schema: [],
      },
    ]),
  },
}));

vi.mock('@/server/services/gateway', () => ({ GatewayService: vi.fn() }));
vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  isAnyMessageGatewayEnabled: () => gateway.enabled,
  isMessageGatewayHostConfigured: (host: string) =>
    host === 'default' || gateway.nodePlatforms.length > 0,
  resolveMessageGatewayHost: (platform?: string) =>
    platform && gateway.nodePlatforms.includes(platform) ? 'node' : 'default',
}));
vi.mock('@/server/services/bot/BotMessageRouter', () => ({ getBotMessageRouter: vi.fn() }));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({ getBotRuntimeStatus: vi.fn() }));
vi.mock('@/database/models/agentBotProvider', () => ({ AgentBotProviderModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const { agentBotProviderRouter } = await import('../agentBotProvider');

const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: null };

describe('agentBotProviderRouter.listPlatforms', () => {
  beforeEach(() => {
    gateway.enabled = false;
    gateway.nodePlatforms = [];
    vi.stubEnv('VERCEL_ENV', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('offers a platform that replies over its own connection when connections run in-process', async () => {
    const platforms = await agentBotProviderRouter.createCaller(ctx).listPlatforms();
    expect(platforms.map((p) => p.id)).toEqual(['qq', 'wecom']);
  });

  it('marks it unavailable behind the external message gateway, which cannot relay its replies', async () => {
    gateway.enabled = true;
    const platforms = await agentBotProviderRouter.createCaller(ctx).listPlatforms();
    expect(platforms.map((p) => [p.id, !!(p as any).unavailableReason])).toEqual([
      ['qq', false],
      ['wecom', true],
    ]);
  });

  it('offers it behind the gateway when it is routed to the Node gateway, which sends its replies', async () => {
    gateway.enabled = true;
    gateway.nodePlatforms = ['wecom'];
    const platforms = await agentBotProviderRouter.createCaller(ctx).listPlatforms();
    expect(platforms.every((p) => !(p as any).unavailableReason)).toBe(true);
  });

  it('marks it unavailable on serverless, where the socket and the webhook live apart', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const platforms = await agentBotProviderRouter.createCaller(ctx).listPlatforms();
    expect((platforms.find((p) => p.id === 'wecom') as any).unavailableReason).toMatch(
      /cannot hold where it answers messages/,
    );
  });

  it('leaves it available where connections run in-process', async () => {
    const platforms = await agentBotProviderRouter.createCaller(ctx).listPlatforms();
    expect(platforms.every((p) => !(p as any).unavailableReason)).toBe(true);
  });
});

describe('agentBotProviderRouter.create', () => {
  afterEach(() => {
    gateway.enabled = false;
  });

  it('refuses a WeCom bot where it could never connect', async () => {
    gateway.enabled = true;
    await expect(
      agentBotProviderRouter.createCaller(ctx).create({
        agentId: 'agt-1',
        applicationId: 'bot-1',
        credentials: { secret: 'x' },
        platform: 'wecom',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
