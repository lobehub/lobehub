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

  it('degrades an over-budget attachment to a download-link message at deliver time', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');

    const result = await sendProactiveWechatMessage({
      attachments: [
        {
          fetchUrl: 'https://example.com/f/big.mp4',
          name: 'big.mp4',
          size: 100 * 1024 * 1024,
          type: 'video',
        },
      ],
      content: 'here is the video',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result.status).toBe('sent');
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, WECHAT_USER, 'here is the video', 'token-1');
    expect(mockSendMessage).toHaveBeenNthCalledWith(
      2,
      WECHAT_USER,
      expect.stringContaining('https://example.com/f/big.mp4'),
      'token-1',
    );
  });

  it('degrades an in-budget attachment whose upload failed to a download link and reports sent', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');

    // Within budget, so it goes down the upload path — which fails (the mocked
    // client has no uploadCdnMedia). Regression: this used to requeue forever
    // (each replay failed the same way) and the caller was told "queued".
    const result = await sendProactiveWechatMessage({
      attachments: [
        {
          data: Buffer.alloc(1024, 1).toString('base64'),
          fetchUrl: 'https://example.com/f/video.mp4',
          name: 'video.mp4',
          size: 1024,
          type: 'video',
        },
      ],
      content: 'here is the video',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result.status).toBe('sent');
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, WECHAT_USER, 'here is the video', 'token-1');
    expect(mockSendMessage).toHaveBeenNthCalledWith(
      2,
      WECHAT_USER,
      expect.stringContaining('https://example.com/f/video.mp4'),
      'token-1',
    );
    // Nothing left to replay — the link IS the delivery.
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER)) ?? []).toHaveLength(0);
  });

  it('reports quota_exhausted when the open window has fewer sends left than the delivery needs', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    // 1 credit left, but text + attachment needs 2. Regression: the UI showed
    // "1 send left", the user hit send, and got "the window is closed".
    await consumeSendCredits(redis, APP, WECHAT_USER, WECHAT_WINDOW_MAX_SENDS - 1);

    const result = await sendProactiveWechatMessage({
      attachments: [
        { data: Buffer.alloc(1024, 1).toString('base64'), name: 'small.png', type: 'image' },
      ],
      content: 'text plus attachment',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'quota_exhausted', status: 'queued' });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });

  it('drains the queued backlog before sending a new push into an open window', async () => {
    // Backlog accumulated while the window was closed…
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'queued first', enqueuedAt: 1 });
    // …then the window reopened without the inbound flush having run.
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');

    const result = await sendProactiveWechatMessage({
      content: 'fresh push',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result.status).toBe('sent');
    // FIFO: the backlog lands before the new message.
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, WECHAT_USER, 'queued first', 'token-1');
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, WECHAT_USER, 'fresh push', 'token-1');
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER)) ?? []).toHaveLength(0);
  });

  it('queues a fresh push behind a backlog the drain could not finish', async () => {
    // Regression (P2): the drain stops once the backlog would eat into the
    // credits reserved for the live reply. The fresh push used to sail past the
    // still-queued older message, breaking the FIFO the drain exists to keep.
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    await consumeSendCredits(redis, APP, WECHAT_USER, WECHAT_WINDOW_MAX_SENDS - 2);
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'queued first', enqueuedAt: 1 });

    const result = await sendProactiveWechatMessage({
      content: 'fresh push',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'quota_exhausted', status: 'queued' });
    // The fresh message never jumped the queue.
    expect(mockSendMessage).not.toHaveBeenCalledWith(WECHAT_USER, 'fresh push', 'token-1');
    const queued = redis.lists
      .get(wechatPendingPushKey(APP, WECHAT_USER))!
      .map((raw) => JSON.parse(raw).content);
    expect(queued).toEqual(['queued first', 'fresh push']);
  });

  it('queues behind an in-flight drain instead of reading the queue as empty', async () => {
    // Regression (P2, round 2): a concurrent drain holds the lock with its
    // current item already LPOP'd, so the list looks empty from here. Sending
    // now would overtake a message that is still being delivered.
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    // Someone else's drain is in flight; the queue is transiently empty.
    await redis.set(`wechat:pending-flush:${APP}:${WECHAT_USER}`, '1', 'EX', 30);

    const result = await sendProactiveWechatMessage({
      content: 'fresh push',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'delivery_in_progress', status: 'queued' });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
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
    expect(queued).toEqual({ reason: 'window_closed', status: 'queued' });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('queues when there is no send window', async () => {
    const result = await sendProactiveWechatMessage({
      content: 'hello',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'window_closed', status: 'queued' });
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

    expect(result).toEqual({ reason: 'window_closed', status: 'queued' });
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

    expect(result).toEqual({ reason: 'send_failed', status: 'queued' });
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });

  it('requeues only the undelivered leg when the link follow-up fails', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    // First call is the text leg (succeeds), second is the download-link
    // follow-up for the over-budget attachment (fails).
    mockSendMessage.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('iLink down'));

    const result = await sendProactiveWechatMessage({
      attachments: [
        {
          fetchUrl: 'https://example.com/f/big.mp4',
          name: 'big.mp4',
          size: 100 * 1024 * 1024,
          type: 'video',
        },
      ],
      content: 'here is the video',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'send_failed', status: 'queued' });
    const queued = redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))!;
    expect(queued).toHaveLength(1);
    // The text already arrived — replaying it would show it twice.
    expect(JSON.parse(queued[0]).content).toBeUndefined();
    expect(JSON.parse(queued[0]).attachments).toHaveLength(1);
  });

  it('requeues an attachment whose upload failed alongside the degraded one', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    // Text lands; the in-budget upload fails inside sendWechatAttachments (the
    // mocked client has no uploadCdnMedia) and is swallowed; the link
    // follow-up then fails too.
    mockSendMessage.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('iLink down'));

    const result = await sendProactiveWechatMessage({
      attachments: [
        { data: Buffer.alloc(1024, 1).toString('base64'), name: 'small.png', type: 'image' },
        {
          fetchUrl: 'https://example.com/f/big.mp4',
          name: 'big.mp4',
          size: 100 * 1024 * 1024,
          type: 'video',
        },
      ],
      content: 'here you go',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'send_failed', status: 'queued' });
    const queued = JSON.parse(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))![0]);
    expect(queued.content).toBeUndefined();
    // Neither attachment reached the user, so both must survive the replay.
    expect(queued.attachments.map((a: { name: string }) => a.name)).toEqual([
      'small.png',
      'big.mp4',
    ]);
  });

  it('queues an upload failure for retry even when nothing else fails', async () => {
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-1');
    // Text lands; the upload fails inside sendWechatAttachments (the mocked
    // client has no uploadCdnMedia) and there is no link leg at all.
    const result = await sendProactiveWechatMessage({
      attachments: [
        { data: Buffer.alloc(1024, 1).toString('base64'), name: 'small.png', type: 'image' },
      ],
      content: 'here you go',
      serverDB,
      userId: LOBE_USER,
    });

    expect(result).toEqual({ reason: 'send_failed', status: 'queued' });
    const queued = JSON.parse(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))![0]);
    expect(queued.content).toBeUndefined();
    expect(queued.attachments).toHaveLength(1);
    expect(queued.attachments[0].name).toBe('small.png');
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

  it('replays a backlog of oversized attachments that collapse into one link message', async () => {
    // 9 over-budget attachments would need 9 credits counted raw, so with a
    // 10-credit window and 2 reserved for replies the item could never pass
    // its own quota check and would sit queued until it expired. Degradation
    // collapses them into a single download-link message — 1 credit.
    await enqueuePendingPush(redis, APP, WECHAT_USER, {
      attachments: Array.from({ length: 9 }, (_, index) => ({
        fetchUrl: `https://example.com/f/big-${index}.mp4`,
        name: `big-${index}.mp4`,
        size: 100 * 1024 * 1024,
        type: 'video' as const,
      })),
      enqueuedAt: 1,
    });
    await recordInboundToken(redis, APP, WECHAT_USER, 'token-2');

    const sent = await flushPendingWechatPushes({ ...flushParams, redis });

    expect(sent).toBe(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toContain('big-8.mp4');
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(0);
    expect((await peekWindow(redis, APP, WECHAT_USER))?.remaining).toBe(
      WECHAT_WINDOW_MAX_SENDS - 1,
    );
  });

  it('does nothing when the window never reopened', async () => {
    await enqueuePendingPush(redis, APP, WECHAT_USER, { content: 'first', enqueuedAt: 1 });

    const sent = await flushPendingWechatPushes({ ...flushParams, redis });

    expect(sent).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(redis.lists.get(wechatPendingPushKey(APP, WECHAT_USER))).toHaveLength(1);
  });
});
