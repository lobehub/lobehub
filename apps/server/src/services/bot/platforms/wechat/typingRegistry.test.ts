// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  clearWechatTyping,
  listActiveWechatTyping,
  renewWechatTyping,
  requestWechatTyping,
  WECHAT_TYPING_TTL_MS,
  type WechatTypingRedis,
} from './typingRegistry';

/** In-memory redis covering exactly the registry's command surface. */
const makeRedis = () => {
  const store = new Map<string, { expiresAt: number; value: string }>();
  const alive = (key: string) => {
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return hit;
  };
  const redis: WechatTypingRedis = {
    del: async (...keys) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0),
    get: async (key) => alive(key)?.value ?? null,
    pexpire: async (key, ms) => {
      const hit = alive(key);
      if (!hit) return 0;
      hit.expiresAt = Date.now() + ms;
      return 1;
    },
    scan: async (_cursor, _m, pattern, _c, _n) => {
      const prefix = pattern.replace(/\*$/, '');
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix) && alive(key));
      return ['0', keys];
    },
    set: async (key, value, _px, ms) => {
      store.set(key, { expiresAt: Date.now() + ms, value });
      return 'OK';
    },
  };
  return { redis, store };
};

const entry = { applicationId: 'app-1', wechatUserId: 'wx-user-1' };

describe('wechat typing registry', () => {
  it('start → list → clear round-trips one entry', async () => {
    const { redis } = makeRedis();
    await requestWechatTyping(redis, entry);
    expect(await listActiveWechatTyping(redis)).toEqual([entry]);

    await clearWechatTyping(redis, entry.applicationId, entry.wechatUserId);
    expect(await listActiveWechatTyping(redis)).toEqual([]);
  });

  it('renew resets the TTL of an existing entry but never resurrects a cleared one', async () => {
    const { redis, store } = makeRedis();
    await requestWechatTyping(redis, entry);
    const key = [...store.keys()][0];
    const before = store.get(key)!.expiresAt;

    store.get(key)!.expiresAt = Date.now() + 1000; // nearly expired
    await renewWechatTyping(redis, entry.applicationId, entry.wechatUserId);
    expect(store.get(key)!.expiresAt).toBeGreaterThanOrEqual(before - 5);

    await clearWechatTyping(redis, entry.applicationId, entry.wechatUserId);
    await renewWechatTyping(redis, entry.applicationId, entry.wechatUserId);
    expect(await listActiveWechatTyping(redis)).toEqual([]);
  });

  it('an expired entry disappears from the listing (crash backstop)', async () => {
    const { redis, store } = makeRedis();
    await requestWechatTyping(redis, entry);
    const key = [...store.keys()][0];
    expect(store.get(key)!.expiresAt - Date.now()).toBeLessThanOrEqual(WECHAT_TYPING_TTL_MS);

    store.get(key)!.expiresAt = Date.now() - 1; // simulate TTL elapsed
    expect(await listActiveWechatTyping(redis)).toEqual([]);
  });

  it('keeps entries of different bots for the same user separate', async () => {
    const { redis } = makeRedis();
    await requestWechatTyping(redis, entry);
    await requestWechatTyping(redis, { ...entry, applicationId: 'app-2' });

    const listed = await listActiveWechatTyping(redis);
    expect(listed.map((e) => e.applicationId).sort()).toEqual(['app-1', 'app-2']);

    await clearWechatTyping(redis, 'app-2', entry.wechatUserId);
    expect(await listActiveWechatTyping(redis)).toEqual([entry]);
  });
});
