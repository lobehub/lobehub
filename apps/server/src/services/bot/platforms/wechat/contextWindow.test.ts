// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  consumeSendCredits,
  drainPendingPushes,
  enqueuePendingPush,
  peekWindow,
  pendingPushSendCount,
  recordInboundToken,
  WECHAT_WINDOW_MAX_SENDS,
  wechatLegacyTokenKey,
  type WechatPendingPush,
  wechatPendingPushKey,
  wechatWindowKey,
  type WechatWindowRedis,
} from './contextWindow';

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
      this.ttls.delete(key);
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
    const nx = args.includes('NX');
    if (nx && this.strings.has(key)) return null;
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
const USER = 'alice@im.wechat';

describe('recordInboundToken', () => {
  it('resets the window with a full quota and mirrors the legacy key', async () => {
    const redis = new FakeRedis();
    await redis.hset(wechatWindowKey(APP, USER), { remaining: 1, token: 'old' });

    await recordInboundToken(redis, APP, USER, 'fresh-token');

    const sendWindow = await peekWindow(redis, APP, USER);
    expect(sendWindow).toMatchObject({ remaining: WECHAT_WINDOW_MAX_SENDS, token: 'fresh-token' });
    expect(await redis.get(wechatLegacyTokenKey(APP, USER))).toBe('fresh-token');
  });
});

describe('peekWindow', () => {
  it('returns null when neither window nor legacy token exists', async () => {
    expect(await peekWindow(new FakeRedis(), APP, USER)).toBeNull();
  });

  it('seeds the window from the legacy token key with a full quota', async () => {
    const redis = new FakeRedis();
    await redis.set(wechatLegacyTokenKey(APP, USER), 'legacy-token', 'EX', 3600);

    const sendWindow = await peekWindow(redis, APP, USER);

    expect(sendWindow).toMatchObject({ remaining: WECHAT_WINDOW_MAX_SENDS, token: 'legacy-token' });
    // Seeded window must not outlive the legacy token.
    expect(await redis.pttl(wechatWindowKey(APP, USER))).toBe(3600 * 1000);
  });
});

describe('consumeSendCredits', () => {
  it('decrements the quota and returns the token', async () => {
    const redis = new FakeRedis();
    await recordInboundToken(redis, APP, USER, 'token-1');

    const result = await consumeSendCredits(redis, APP, USER, 3);

    expect(result).toEqual({
      remaining: WECHAT_WINDOW_MAX_SENDS - 3,
      status: 'ok',
      token: 'token-1',
    });
  });

  it('reports missing when there is no window at all', async () => {
    expect(await consumeSendCredits(new FakeRedis(), APP, USER, 1)).toEqual({ status: 'missing' });
  });

  it('refuses to overdraw in strict mode and leaves the counter untouched', async () => {
    const redis = new FakeRedis();
    await recordInboundToken(redis, APP, USER, 'token-1');
    await consumeSendCredits(redis, APP, USER, WECHAT_WINDOW_MAX_SENDS);

    const result = await consumeSendCredits(redis, APP, USER, 1);

    expect(result).toEqual({ remaining: 0, status: 'exhausted', token: 'token-1' });
    expect((await peekWindow(redis, APP, USER))?.remaining).toBe(0);
  });

  it('allows the counter to go negative with allowOverdraft', async () => {
    const redis = new FakeRedis();
    await recordInboundToken(redis, APP, USER, 'token-1');
    await consumeSendCredits(redis, APP, USER, WECHAT_WINDOW_MAX_SENDS);

    const result = await consumeSendCredits(redis, APP, USER, 2, { allowOverdraft: true });

    expect(result).toEqual({ remaining: -2, status: 'ok', token: 'token-1' });
  });
});

describe('pendingPushSendCount', () => {
  it('counts text and attachments as separate sendmessage calls', () => {
    expect(pendingPushSendCount({ content: 'hi' })).toBe(1);
    expect(pendingPushSendCount({ content: 'a'.repeat(4500) })).toBe(3);
    expect(pendingPushSendCount({ attachments: [{ type: 'image' }, { type: 'file' }] })).toBe(2);
    expect(pendingPushSendCount({ attachments: [{ type: 'image' }], content: 'hi' })).toBe(2);
    // A degenerate empty payload still costs one call.
    expect(pendingPushSendCount({ content: '  ' })).toBe(1);
  });
});

describe('pending push queue', () => {
  const payload = (content: string): WechatPendingPush => ({ content, enqueuedAt: 1 });

  it('enqueues FIFO and drains in order', async () => {
    const redis = new FakeRedis();
    await enqueuePendingPush(redis, APP, USER, payload('first'));
    await enqueuePendingPush(redis, APP, USER, payload('second'));

    const drained: string[] = [];
    const sent = await drainPendingPushes(redis, APP, USER, async (p) => {
      drained.push(p.content!);
      return 'sent';
    });

    expect(sent).toBe(2);
    expect(drained).toEqual(['first', 'second']);
    expect(redis.lists.get(wechatPendingPushKey(APP, USER))).toEqual([]);
  });

  it('pushes a stopped payload back to the queue head', async () => {
    const redis = new FakeRedis();
    await enqueuePendingPush(redis, APP, USER, payload('first'));
    await enqueuePendingPush(redis, APP, USER, payload('second'));

    let calls = 0;
    const sent = await drainPendingPushes(redis, APP, USER, async () => {
      calls++;
      return calls === 1 ? 'sent' : 'stop';
    });

    expect(sent).toBe(1);
    const remaining = redis.lists.get(wechatPendingPushKey(APP, USER))!;
    expect(remaining).toHaveLength(1);
    expect(JSON.parse(remaining[0]).content).toBe('second');
  });

  it('skips draining while another flush holds the lock', async () => {
    const redis = new FakeRedis();
    await enqueuePendingPush(redis, APP, USER, payload('first'));
    await redis.set(`wechat:pending-flush:${APP}:${USER}`, '1', 'EX', 30);

    const sent = await drainPendingPushes(redis, APP, USER, async () => 'sent');

    expect(sent).toBe(0);
    expect(redis.lists.get(wechatPendingPushKey(APP, USER))).toHaveLength(1);
  });

  it('drops malformed payloads instead of blocking the queue', async () => {
    const redis = new FakeRedis();
    await redis.rpush(wechatPendingPushKey(APP, USER), 'not-json');
    await enqueuePendingPush(redis, APP, USER, payload('valid'));

    const drained: string[] = [];
    const sent = await drainPendingPushes(redis, APP, USER, async (p) => {
      drained.push(p.content!);
      return 'sent';
    });

    expect(sent).toBe(1);
    expect(drained).toEqual(['valid']);
  });

  it('caps the queue by dropping the oldest entries', async () => {
    const redis = new FakeRedis();
    for (let i = 0; i < 25; i++) {
      await enqueuePendingPush(redis, APP, USER, payload(`msg-${i}`));
    }

    const list = redis.lists.get(wechatPendingPushKey(APP, USER))!;
    expect(list).toHaveLength(20);
    expect(JSON.parse(list[0]).content).toBe('msg-5');
    expect(JSON.parse(list.at(-1)!).content).toBe('msg-24');
  });
});
