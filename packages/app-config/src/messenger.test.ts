import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessengerWechatConfig, invalidateMessengerConfigCache } from './messenger';

const {
  gatewayEnvState,
  mockFindEnabledByPlatform,
  mockGetServerDB,
  mockInitWithEnvKey,
  redisEnvState,
} = vi.hoisted(() => ({
  gatewayEnvState: {
    MESSAGE_GATEWAY_ENABLED: '1' as string | undefined,
    MESSAGE_GATEWAY_NODE_PLATFORMS: undefined as string | undefined,
    MESSAGE_GATEWAY_NODE_URL: undefined as string | undefined,
    MESSAGE_GATEWAY_SERVICE_TOKEN: 'gateway-token' as string | undefined,
    MESSAGE_GATEWAY_URL: 'https://gateway.example.com' as string | undefined,
  },
  mockFindEnabledByPlatform: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  redisEnvState: { REDIS_URL: 'redis://localhost:6379' as string | undefined },
}));

vi.mock('@/envs/gateway', () => ({ gatewayEnv: gatewayEnvState }));
vi.mock('@/envs/redis', () => ({ redisEnv: redisEnvState }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mockGetServerDB }));
vi.mock('@/database/models/systemBotProvider', () => ({
  SystemBotProviderModel: { findEnabledByPlatform: mockFindEnabledByPlatform },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: mockInitWithEnvKey },
}));

describe('getMessengerWechatConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    invalidateMessengerConfigCache();
    gatewayEnvState.MESSAGE_GATEWAY_ENABLED = '1';
    gatewayEnvState.MESSAGE_GATEWAY_URL = 'https://gateway.example.com';
    gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = 'gateway-token';
    gatewayEnvState.MESSAGE_GATEWAY_NODE_URL = undefined;
    gatewayEnvState.MESSAGE_GATEWAY_NODE_PLATFORMS = undefined;
    redisEnvState.REDIS_URL = 'redis://localhost:6379';
    mockGetServerDB.mockResolvedValue({});
    mockInitWithEnvKey.mockResolvedValue({});
    mockFindEnabledByPlatform.mockResolvedValue({ platform: 'wechat' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the enabled provider when all polling prerequisites are configured', async () => {
    await expect(getMessengerWechatConfig()).resolves.toEqual({ enabled: true });
    expect(mockFindEnabledByPlatform).toHaveBeenCalledWith({}, 'wechat', {});
  });

  it.each([
    ['gateway disabled', () => (gatewayEnvState.MESSAGE_GATEWAY_ENABLED = '0')],
    ['gateway URL missing', () => (gatewayEnvState.MESSAGE_GATEWAY_URL = undefined)],
    ['gateway token missing', () => (gatewayEnvState.MESSAGE_GATEWAY_SERVICE_TOKEN = undefined)],
    ['Redis URL missing', () => (redisEnvState.REDIS_URL = undefined)],
    ['Redis explicitly disabled', () => vi.stubEnv('DISABLE_REDIS', '1')],
  ])('does not advertise WeChat when %s', async (_case, arrange) => {
    arrange();

    await expect(getMessengerWechatConfig()).resolves.toBeNull();
    expect(mockFindEnabledByPlatform).not.toHaveBeenCalled();
  });

  it('advertises WeChat when it is routed to the node host and the default host is live', async () => {
    // The cutover shape. WeChat's connection lives on the Node gateway while
    // the default host still carries every other platform.
    gatewayEnvState.MESSAGE_GATEWAY_NODE_URL = 'https://node-gateway.example.com';
    gatewayEnvState.MESSAGE_GATEWAY_NODE_PLATFORMS = 'wechat';

    await expect(getMessengerWechatConfig()).resolves.toEqual({ enabled: true });
  });

  it('does not advertise WeChat on a node-only deployment', async () => {
    // The runtime only enters gateway mode with a configured default host, so
    // here nothing would ever serve these links — advertising WeChat would
    // offer users a channel that silently never connects.
    gatewayEnvState.MESSAGE_GATEWAY_URL = undefined;
    gatewayEnvState.MESSAGE_GATEWAY_NODE_URL = 'https://node-gateway.example.com';
    gatewayEnvState.MESSAGE_GATEWAY_NODE_PLATFORMS = 'wechat';

    await expect(getMessengerWechatConfig()).resolves.toBeNull();
    expect(mockFindEnabledByPlatform).not.toHaveBeenCalled();
  });
});
