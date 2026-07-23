// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import {
  consumeSendCredits,
  enqueuePendingPush,
  peekWindow,
  recordInboundToken,
  WECHAT_WINDOW_MAX_SENDS,
  wechatPendingPushKey,
  type WechatWindowRedis,
} from '@/server/services/bot/platforms/wechat/contextWindow';

import {
  flushPendingWechatPushes,
  getWechatPushWindowStatus,
  sendProactiveWechatMessage,
} from './wechatPush';

const { mockFindByPlatform, mockFindByIdWithCredentials, mockSendMessage, redisHolder } =
  vi.hoisted(() => ({
    mockFindByIdWithCredentials: vi.fn(),
    mockFindByPlatform: vi.fn(),
    mockSendMessage: vi.fn(),
    redisHolder: { current: null as unknown },
  }));

vi.mock('@lobechat/chat-adapter-wechat', () => ({
  getWechatTextSendCount: (text: string) => Math.max(1, Math.ceil(text.length / 2000)),
  WechatApiClient: class {
    sendMessage = mockSendMessage;
  },
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: class {
    findByIdWithCredentials = mockFindByIdWithCredentials;
    findByPlatform = mockFindByPlatform;
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisHolder.current,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({ kind: 'gatekeeper' }) },
}));

/** Minimal in-memory Redis covering the commands the window store uses. */
class FakeRedis implements WechatWindowRedis {
  hashes = new Map<string, Record<string, string>>();
  lists = new Map<string, string[]>();
  strings = new Map<string, string>();
  ttls = new Map<string, number>();

  async del(...keys: string[]) {
    for (const key of keys) {
      this.hashes.delete(key);
      this.lists.delete(key);
      this.strings.delete(key);
    }
    return keys.length;
  }

  async expire(key: string, seconds: number) {
    this.ttls.set(key, seconds * 1000);
    return 1;
  }

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }

  async hgetall(key: string) {
    return this.hashes.get(key) ?? {};
  }

  async hincrby(key: string, field: string, increment: number) {
    const hash = this.hashes.get(key) ?? {};
    const next = (Number(hash[field]) || 0) + increment;
    hash[field] = String(next);
    this.hashes.set(key, hash);
    return next;
  }

  async hset(key: string, data: Record<string, string | number>) {
    const hash = this.hashes.get(key) ?? {};
    for (const [field, value] of Object.entries(data)) hash[field] = String(value);
    this.hashes.set(key, hash);
    return Object.keys(data).length;
  }

  async llen(key: string) {
    return this.lists.get(key)?.length ?? 0;
  }

  async lpop(key: string) {
    return this.lists.get(key)?.shift() ?? null;
  }

  async lpush(key: string, value: string) {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];
    const normalizedStop = stop < 0 ? list.length + stop : stop;
    this.lists.set(key, list.slice(start, normalizedStop + 1));
    return 'OK';
  }

  async pttl(key: string) {
    return this.ttls.get(key) ?? -1;
  }

  async rpush(key: string, value: string) {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    if (args.includes('NX') && this.strings.has(key)) return null;
    this.strings.set(key, value);
    const exIndex = args.indexOf('EX');
    if (exIndex !== -1) this.ttls.set(key, Number(args[exIndex + 1]) * 1000);
    return 'OK';
  }

  async ttl(key: string) {
    const ms = this.ttls.get(key);
    return ms === undefined ? -1 : Math.ceil(ms / 1000);
  }
}

const APP = 'bot@im.wechat';
const WECHAT_USER = 'alice@im.wechat';
const LOBE_USER = 'user-1';
const serverDB = { kind: 'db' } as unknown as LobeChatDatabase;

const safeLink = { applicationId: APP, id: 'link-1' };
const decryptedLink = {
  applicationId: APP,
  credentials: { baseUrl: 'https://ilink.example.com', botId: APP, botToken: 'secret' },
  id: 'link-1',
  platformUserId: WECHAT_USER,
};

let redis: FakeRedis;

beforeEach(() => {
  vi.clearAllMocks();
  redis = new FakeRedis();
  redisHolder.current = redis;
  mockFindByPlatform.mockResolvedValue(safeLink);
  mockFindByIdWithCredentials.mockResolvedValue(decryptedLink);
  mockSendMessage.mockResolvedValue({ ret: 0 });
});

describe('sendProactiveWechatMessage', () => {
  it('delivers inside an open send window and consumes quota', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');

    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ remaining: WECHAT_WINDOW_MAX_SENDS - 1, status: 'sent' });
    expect(mockSendMessage).toHaveBeenCalledWith(WECHAT_USER, 'hello', 'token-1');
  });

  it('delivers the displayed final send before queueing the next message', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    await consumeSendCredits(redis, APP, WECHAT_USER, WECHAT_WINDOW_MAX_SENDS - 1);

    const finalSend = await sendProactiveWechatMessage({
      content: 'final available send',
      serverDB,
      userId: LOBE_USER,
    });
    const queued = await sendProactiveWechatMessage({
      content: 'wait for next window',
      serverDB,
      userId: LOBE_USER,
    });

    expect(finalSend).toEqual({ remaining: 0, status: 'sent' });
    expect(queued).toEqual({ status: 'queued' });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('queues when there is no send window', async () => {
    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ status: 'queued' });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });

  it('queues when the window quota is exhausted', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    await consumeSendCredits(redis, APP, WECHAT_USER, WECHAT_WINDOW_MAX_SENDS);

    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ status: 'queued' });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('queues for replay when the send itself fails', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    mockSendMessage.mockRejectedValueOnce(new Error('stale token'));

    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ status: 'queued' });
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });

  it('reports unlinked when the user has no WeChat account link', async () => {
    mockFindByPlatform.mockResolvedValueOnce(undefined);

    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ status: 'unlinked' });
  });

  it('reports unavailable when redis is down', async () => {
    redisHolder.current = null;

    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ status: 'unavailable' });
  });
});

describe('getWechatPushWindowStatus', () => {
  it('reports unlinked users with a closed window', async () => {
    mockFindByPlatform.mockResolvedValueOnce(undefined);

    const status = await getWechatPushWindowStatus({ serverDB, userId: LOBE_USER });

    expect(status).toMatchObject({ linked: false, queued: 0, remaining: 0, windowOpen: false });
  });

  it('reports a closed window when no token was ever recorded', async () => {
    mockFindByPlatform.mockResolvedValueOnce({
      ...safeLink,
      platformUserId: WECHAT_USER,
    });

    const status = await getWechatPushWindowStatus({ serverDB, userId: LOBE_USER });

    expect(status).toMatchObject({
      expiresInSeconds: null,
      linked: true,
      remaining: 0,
      windowOpen: false,
    });
  });

  it('reports the open window with remaining quota, expiry and queued backlog', async () => {
    mockFindByPlatform.mockResolvedValueOnce({
      ...safeLink,
      platformUserId: WECHAT_USER,
    });
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    await consumeSendCredits(redis, APP, WECHAT_USER, 3);
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'later', enqueuedAt: 1 });

    const status = await getWechatPushWindowStatus({ serverDB, userId: LOBE_USER });

    expect(status).toMatchObject({
      expiresInSeconds: 86_400,
      linked: true,
      maxSends: WECHAT_WINDOW_MAX_SENDS,
      queued: 1,
      remaining: WECHAT_WINDOW_MAX_SENDS - 3,
      windowOpen: true,
    });
  });
});

describe('flushPendingWechatPushes', () => {
  const flushParams = {
    applicationId: APP,
    baseUrl: 'https://ilink.example.com',
    botId: APP,
    botToken: 'secret',
    platformUserId: WECHAT_USER,
  };

  it('replays queued pushes in order once the window reopens', async () => {
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'first', enqueuedAt: 1 });
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'second', enqueuedAt: 2 });
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-2');

    const sent = await flushPendingWechatPushes({ ...flushParams, redis });

    expect(sent).toBe(2);
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, WECHAT_USER, 'first', 'token-2');
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, WECHAT_USER, 'second', 'token-2');
    expect((await peekWindow(redis, APP, WECHAT_USER))?.remaining).toBe(
      WECHAT_WINDOW_MAX_SENDS - 2,
    );
  });

  it('keeps credits in reserve for the live reply', async () => {
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'first', enqueuedAt: 1 });
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'second', enqueuedAt: 2 });
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-2');
    // Only 3 credits left: one replay is allowed (3-1 >= 2), the second would
    // dip into the reserved reply budget and must stay queued.
    await consumeSendCredits(redis, APP, WECHAT_USER, WECHAT_WINDOW_MAX_SENDS - 3);

    const sent = await flushPendingWechatPushes({ ...flushParams, redis });

    expect(sent).toBe(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });

  it('does nothing when the window never reopened', async () => {
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'first', enqueuedAt: 1 });

    const sent = await flushPendingWechatPushes({ ...flushParams, redis });

    expect(sent).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });
});
