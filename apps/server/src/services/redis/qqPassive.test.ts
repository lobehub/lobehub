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

  it('prefers the Redis copy and drops the stale local one', async () => {
    mockedGetClient.mockResolvedValue(null as any);
    await qqPassive.savePending(KEY, 'stale local copy');

    mockedGetClient.mockResolvedValue(createRedis('newer reply from another instance') as any);

    await expect(qqPassive.takePending(KEY)).resolves.toBe('newer reply from another instance');
    await expect(qqPassive.takePending(KEY)).resolves.toBeUndefined();
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
