// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeLinkToken, issueLinkToken, peekLinkToken } from './linkTokenStore';

vi.mock('@/config/messenger', () => ({
  getMessengerLinkTokenTtl: vi.fn().mockReturnValue(1800),
}));

const fakeRedis = (): {
  client: any;
  store: Map<string, string>;
} => {
  const store = new Map<string, string>();
  return {
    client: {
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    },
    store,
  };
};

let redisRef: ReturnType<typeof fakeRedis>;

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => redisRef.client),
}));

beforeEach(() => {
  redisRef = fakeRedis();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkTokenStore', () => {
  it('round-trips a Slack token with tenantId / tenantName', async () => {
    const token = await issueLinkToken({
      platform: 'slack',
      platformUserId: 'U_ALICE',
      platformUsername: 'alice',
      tenantId: 'T_ACME',
      tenantName: 'Acme Inc',
    });

    const peeked = await peekLinkToken(token);
    expect(peeked).toEqual(
      expect.objectContaining({
        platform: 'slack',
        platformUserId: 'U_ALICE',
        platformUsername: 'alice',
        tenantId: 'T_ACME',
        tenantName: 'Acme Inc',
      }),
    );
  });

  it('round-trips a Telegram token without tenant fields (global bot)', async () => {
    const token = await issueLinkToken({
      platform: 'telegram',
      platformUserId: '12345',
      platformUsername: '@alice',
    });

    const peeked = await peekLinkToken(token);
    expect(peeked?.platform).toBe('telegram');
    expect(peeked?.tenantId).toBeUndefined();
    expect(peeked?.tenantName).toBeUndefined();
  });

  it('reuses an existing token for the same (platform, platformUserId)', async () => {
    const a = await issueLinkToken({
      platform: 'slack',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
    });
    const b = await issueLinkToken({
      platform: 'slack',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
    });
    expect(b).toBe(a);
  });

  it('consumeLinkToken removes the token + reuse map', async () => {
    const token = await issueLinkToken({
      platform: 'slack',
      platformUserId: 'U_X',
      tenantId: 'T_X',
    });

    const consumed = await consumeLinkToken(token);
    expect(consumed?.platformUserId).toBe('U_X');

    expect(await peekLinkToken(token)).toBeNull();
    // A fresh issue for the same identity should NOT return the (now deleted)
    // old token — since both keys are gone, it mints a new one.
    const reissued = await issueLinkToken({
      platform: 'slack',
      platformUserId: 'U_X',
      tenantId: 'T_X',
    });
    expect(reissued).not.toBe(token);
  });
});
