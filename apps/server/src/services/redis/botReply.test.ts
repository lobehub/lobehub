import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { botReply } from './botReply';

const store = new Map<string, string>();
const redis = vi.hoisted(() => ({ client: null as any, scope: undefined as string | undefined }));
vi.mock('./client', () => ({
  getRedisServiceClient: async (scope: string) => {
    redis.scope = scope;
    return redis.client;
  },
}));

const memoryClient = {
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
};

const NOW = 1_800_000_000_000;
const KEY = 'dingtalk_session_webhook:v1:ding-app:dingtalk:group:cid==';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  redis.client = memoryClient;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('redisService.botReply DingTalk sessionWebhook', () => {
  it('stores the route under the bot-reply scope until shortly before it expires', async () => {
    const webhook = { expiresAt: NOW + 60 * 60 * 1000, url: 'https://oapi.dingtalk.com/x' };
    await botReply.rememberDingTalkSessionWebhook('ding-app', 'dingtalk:group:cid==', webhook);

    expect(redis.scope).toBe('botReply');
    expect(memoryClient.set).toHaveBeenCalledWith(KEY, JSON.stringify(webhook), {
      px: 60 * 60 * 1000 - 30 * 1000,
    });
    expect(await botReply.getDingTalkSessionWebhook('ding-app', 'dingtalk:group:cid==')).toEqual(
      webhook,
    );
  });

  it('skips a route that is already inside the expiry margin', async () => {
    await botReply.rememberDingTalkSessionWebhook('ding-app', 'dingtalk:group:cid==', {
      expiresAt: NOW + 10_000,
      url: 'https://oapi.dingtalk.com/x',
    });
    expect(memoryClient.set).not.toHaveBeenCalled();
  });

  it('does not hand out a stored route past its expiry margin', async () => {
    store.set(KEY, JSON.stringify({ expiresAt: NOW + 5000, url: 'https://oapi.dingtalk.com/x' }));
    expect(
      await botReply.getDingTalkSessionWebhook('ding-app', 'dingtalk:group:cid=='),
    ).toBeUndefined();
  });

  it('ignores malformed values', async () => {
    store.set(KEY, 'not-json');
    expect(
      await botReply.getDingTalkSessionWebhook('ding-app', 'dingtalk:group:cid=='),
    ).toBeUndefined();
  });

  it('forgets a rejected route', async () => {
    store.set(KEY, JSON.stringify({ expiresAt: NOW + 3_600_000, url: 'https://x' }));
    await botReply.forgetDingTalkSessionWebhook('ding-app', 'dingtalk:group:cid==');
    expect(store.has(KEY)).toBe(false);
  });

  it('degrades to a no-op without Redis', async () => {
    redis.client = null;
    await botReply.rememberDingTalkSessionWebhook('ding-app', 't', {
      expiresAt: NOW + 3_600_000,
      url: 'https://x',
    });
    expect(await botReply.getDingTalkSessionWebhook('ding-app', 't')).toBeUndefined();
    await expect(botReply.forgetDingTalkSessionWebhook('ding-app', 't')).resolves.toBeUndefined();
  });
});
