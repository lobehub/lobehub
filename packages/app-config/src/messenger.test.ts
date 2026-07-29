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
});
