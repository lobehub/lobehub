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
    // Mirrors PENDING_TAKE_SCRIPT: read and delete in one step.
    eval: vi.fn(async () => {
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
