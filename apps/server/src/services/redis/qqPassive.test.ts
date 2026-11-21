// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRedisServiceClient } from './client';
import { qqPassive } from './qqPassive';

vi.mock('./client', () => ({ getRedisServiceClient: vi.fn() }));

const mockedGetClient = vi.mocked(getRedisServiceClient);

const createRedis = (stored?: string) => {
  const store = new Map<string, string>();
  if (stored) store.set('pending', stored);

  return {
    // Mirrors PENDING_TAKE_SCRIPT (read and delete) and PENDING_RESTORE_SCRIPT (compare-and-set).
    eval: vi.fn(async (script: string, _count: number, _key: string, ...args: unknown[]) => {
      if (script.includes('-- restore')) {
        const [text, older] = args as [string, string];
        const current = store.get('pending');
        if (current && current !== older) return 0;
        store.set('pending', text);

        return 1;
      }

      const text = store.get('pending');
      store.delete('pending');

      return text ?? null;
    }),
    set: vi.fn(async (_key: string, value: string, options?: { nx?: boolean }) => {
      if (options?.nx && store.has('pending')) return null;
      store.set('pending', value);

      return 'OK';
    }),
    store,
  };
};

const KEY = 'qq:group:123';

describe('qqPassive pending replies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drains a reply parked while Redis was down once Redis answers again', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'answer parked during the outage');

    // Redis is back, but this instance's copy never reached it, so the read is empty.
    mockedGetClient.mockResolvedValue(createRedis() as any);

    await expect(qqPassive.takePending(KEY)).resolves.toBe('answer parked during the outage');
    // The drained copy must not come back on the next flush.
    await expect(qqPassive.takePending(KEY)).resolves.toBeUndefined();
  });

  it('sends the newer local reply first and keeps the older Redis one', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'reply parked during the outage');

    const redis = createRedis('reply parked before the outage');
    mockedGetClient.mockResolvedValue(redis as any);

    // The local copy was written later, so it goes out first and the older one is handed back.
    await expect(qqPassive.takePending(KEY)).resolves.toBe('reply parked during the outage');
    expect(redis.store.get('pending')).toBe('reply parked before the outage');
    await expect(qqPassive.takePending(KEY)).resolves.toBe('reply parked before the outage');
    await expect(qqPassive.takePending(KEY)).resolves.toBeUndefined();
  });

  it('keeps a newer local reply when an older claimed one is restored', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'reply parked during the outage');

    const redis = createRedis();
    mockedGetClient.mockResolvedValue(redis as any);
    await qqPassive.restorePending(KEY, 'claimed before the outage');

    // Redis holds the restored copy, but the newer local reply must still go out first.
    expect(redis.store.get('pending')).toBe('claimed before the outage');
    await expect(qqPassive.takePending(KEY)).resolves.toBe('reply parked during the outage');
    await expect(qqPassive.takePending(KEY)).resolves.toBe('claimed before the outage');
  });

  it('keeps the claimed newer reply when its delivery fails after the older one was put back', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'newer local reply');

    const redis = createRedis('older Redis reply');
    mockedGetClient.mockResolvedValue(redis as any);

    // The newer copy goes out first, and the older one is handed back to Redis.
    await expect(qqPassive.takePending(KEY)).resolves.toBe('newer local reply');
    expect(redis.store.get('pending')).toBe('older Redis reply');

    // Its delivery failed. The requeued older reply must not shadow it, or the newer answer is
    // lost for good: it was already removed from this instance when it was claimed.
    await qqPassive.restorePending(KEY, 'newer local reply');
    expect(redis.store.get('pending')).toBe('newer local reply');
    await expect(qqPassive.takePending(KEY)).resolves.toBe('newer local reply');
    await expect(qqPassive.takePending(KEY)).resolves.toBeUndefined();
  });

  it('lets only the claim that requeued the older reply replace it', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'reply B');

    const redis = createRedis('reply R');
    mockedGetClient.mockResolvedValue(redis as any);

    // Delivery B claims the newer local copy and hands `reply R` back to the slot.
    await expect(qqPassive.takePending(KEY)).resolves.toBe('reply B');
    expect(redis.store.get('pending')).toBe('reply R');

    // Redis blips out long enough for a second delivery to park a newer copy, then claims it and
    // records its own permission for the same slot before its send succeeds.
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'reply L');
    mockedGetClient.mockResolvedValue(redis as any);
    await expect(qqPassive.takePending(KEY)).resolves.toBe('reply L');
    expect(redis.store.get('pending')).toBe('reply R');

    // B now fails. L's permission says nothing about B's claim, so `reply R` — parked after B was
    // claimed — must survive instead of being overwritten by B.
    await qqPassive.restorePending(KEY, 'reply B');
    expect(redis.store.get('pending')).toBe('reply R');
  });

  it('drops the local copy once Redis accepts the same reply', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'parked locally');

    const redis = createRedis();
    mockedGetClient.mockResolvedValue(redis as any);
    await qqPassive.savePending(KEY, 'parked locally');

    expect(redis.store.get('pending')).toBe('parked locally');
    // A stale duplicate must not be re-sent after the write succeeded.
    await expect(qqPassive.takePending(KEY)).resolves.toBe('parked locally');
    await expect(qqPassive.takePending(KEY)).resolves.toBeUndefined();
  });
});
