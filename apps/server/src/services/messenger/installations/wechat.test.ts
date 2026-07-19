// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wechatInstallationKey, WechatInstallationStore } from './wechat';

const { mockFindByPlatformUserWithCredentials, mockGetMessengerWechatConfig, mockRedisSet } =
  vi.hoisted(() => ({
    mockFindByPlatformUserWithCredentials: vi.fn(),
    mockGetMessengerWechatConfig: vi.fn(),
    mockRedisSet: vi.fn(),
  }));

vi.mock('@/config/messenger', () => ({
  getMessengerWechatConfig: mockGetMessengerWechatConfig,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({ kind: 'db' }),
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: {
    findByPlatformUserWithCredentials: mockFindByPlatformUserWithCredentials,
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ set: mockRedisSet }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({ kind: 'gatekeeper' }) },
}));

const accountLink = {
  accessedAt: new Date(),
  activeAgentId: 'agent-1',
  applicationId: 'bot@im.wechat',
  createdAt: new Date(),
  credentials: {
    baseUrl: 'https://ilink.example.com',
    botId: 'bot@im.wechat',
    botToken: 'secret-token',
  },
  id: 'link-1',
  platform: 'wechat',
  platformUserId: 'alice@im.wechat',
  platformUsername: null,
  tenantId: 'alice@im.wechat',
  updatedAt: new Date(),
  userId: 'user-1',
  workspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMessengerWechatConfig.mockResolvedValue({ enabled: true });
  mockFindByPlatformUserWithCredentials.mockResolvedValue(accountLink);
  mockRedisSet.mockResolvedValue('OK');
});

describe('WechatInstallationStore', () => {
  it('resolves by exact sender and bot ids, then persists the inbound context token', async () => {
    const store = new WechatInstallationStore();
    const rawBody = JSON.stringify({
      context_token: 'context-1',
      from_user_id: 'alice@im.wechat',
      to_user_id: 'bot@im.wechat',
    });

    const result = await store.resolveByPayload(new Request('https://example.com'), rawBody);

    expect(mockFindByPlatformUserWithCredentials).toHaveBeenCalledWith(
      { kind: 'db' },
      {
        applicationId: 'bot@im.wechat',
        platform: 'wechat',
        platformUserId: 'alice@im.wechat',
        tenantId: 'alice@im.wechat',
      },
      { kind: 'gatekeeper' },
    );
    expect(result).toMatchObject({
      applicationId: 'bot@im.wechat',
      baseUrl: 'https://ilink.example.com',
      botId: 'bot@im.wechat',
      botToken: 'secret-token',
      installationKey: 'wechat:alice@im.wechat',
      platform: 'wechat',
      tenantId: 'alice@im.wechat',
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'wechat:ctx-token:bot@im.wechat:alice@im.wechat',
      'context-1',
      'EX',
      86_400,
    );
  });

  it('fails closed for an unknown sender without persisting its context token', async () => {
    mockFindByPlatformUserWithCredentials.mockResolvedValueOnce(null);
    const store = new WechatInstallationStore();

    const result = await store.resolveByPayload(
      new Request('https://example.com'),
      JSON.stringify({
        context_token: 'untrusted-context',
        from_user_id: 'mallory@im.wechat',
        to_user_id: 'bot@im.wechat',
      }),
    );

    expect(result).toBeNull();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('fails closed while the deployment-level WeChat switch is disabled', async () => {
    mockGetMessengerWechatConfig.mockResolvedValueOnce(null);
    const store = new WechatInstallationStore();

    expect(await store.resolveByKey('wechat:alice@im.wechat')).toBeNull();
    expect(mockFindByPlatformUserWithCredentials).not.toHaveBeenCalled();
  });

  it('rejects invalid keys and builds stable per-user keys', async () => {
    const store = new WechatInstallationStore();

    expect(wechatInstallationKey('alice@im.wechat')).toBe('wechat:alice@im.wechat');
    expect(await store.resolveByKey('wechat:')).toBeNull();
    expect(await store.resolveByKey('slack:T1')).toBeNull();
  });
});
