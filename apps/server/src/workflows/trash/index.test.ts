// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { qstashClient } from '@/libs/qstash';
import { after } from '@/server/utils/scheduleAfterResponse';

import { runLocalTrashPurge, triggerTrashPurge } from './index';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://example.com' } }));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: vi.fn() } }));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

describe('triggerTrashPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('schedules an in-process bounded sweep when QStash is not configured', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');

    await expect(triggerTrashPurge()).resolves.toBe(true);
    expect(qstashClient.publishJSON).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
  });

  it('propagates a rejected publish', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.mocked(qstashClient.publishJSON).mockRejectedValue(new Error('publish rejected'));

    await expect(triggerTrashPurge()).rejects.toThrow('publish rejected');
  });
});

describe('runLocalTrashPurge', () => {
  it('continues from cursors but stops as soon as a bounded batch is not full', async () => {
    const getDb = vi.fn().mockResolvedValue({ kind: 'db' });
    const sweepExpired = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: { expiresAt: '2026-09-01', id: '25' }, scanned: 25 })
      .mockResolvedValueOnce({ nextCursor: null, scanned: 4 });

    await expect(runLocalTrashPurge({}, { getDb, sweepExpired } as never)).resolves.toEqual({
      batches: 2,
      cursor: { expiresAt: '2026-09-01', id: '25' },
    });
    expect(sweepExpired).toHaveBeenNthCalledWith(
      1,
      { kind: 'db' },
      { cursor: undefined, limit: 25 },
    );
    expect(sweepExpired).toHaveBeenNthCalledWith(
      2,
      { kind: 'db' },
      { cursor: { expiresAt: '2026-09-01', id: '25' }, limit: 25 },
    );
  });

  it('caps a local burst at eight batches of at most fifty roots', async () => {
    const sweepExpired = vi.fn().mockImplementation(async (_db, { cursor }) => ({
      nextCursor: { expiresAt: '2026-09-01', id: String(Number(cursor?.id ?? 0) + 1) },
      scanned: 50,
    }));

    await runLocalTrashPurge({ limit: 10_000, remainingBatches: 10_000 }, {
      getDb: vi.fn().mockResolvedValue({}),
      sweepExpired,
    } as never);

    expect(sweepExpired).toHaveBeenCalledTimes(8);
    expect(sweepExpired).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({ cursor: { expiresAt: '2026-09-01', id: '7' }, limit: 50 }),
    );
  });
});
