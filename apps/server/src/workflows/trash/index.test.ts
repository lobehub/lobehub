// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { TrashService } from '@/server/services/trash';
import { after } from '@/server/utils/scheduleAfterResponse';

import { runLocalTrashPurge, startLocalTrashPurgeSchedule, triggerTrashPurge } from './index';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://example.com' } }));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: vi.fn() } }));
vi.mock('@/server/services/trash', () => ({ TrashService: { sweepExpired: vi.fn() } }));
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

  it('schedules another bounded burst when the local queue has more roots', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(TrashService.sweepExpired).mockImplementation(async (_db, { cursor }) => ({
      failed: 0,
      nextCursor: { expiresAt: '2026-09-01', id: String(Number(cursor?.id ?? 0) + 1) },
      pruned: 0,
      purged: 25,
      scanned: 25,
    }));

    await triggerTrashPurge();
    await vi.mocked(after).mock.calls[0][0]();

    expect(TrashService.sweepExpired).toHaveBeenCalledTimes(8);
    expect(after).toHaveBeenCalledTimes(2);

    vi.mocked(TrashService.sweepExpired).mockResolvedValue({
      failed: 0,
      nextCursor: null,
      pruned: 0,
      purged: 1,
      scanned: 1,
    });
    await vi.mocked(after).mock.calls[1][0]();

    expect(TrashService.sweepExpired).toHaveBeenLastCalledWith(
      {},
      { cursor: { expiresAt: '2026-09-01', id: '8' }, limit: 25 },
    );
    expect(after).toHaveBeenCalledTimes(2);
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
      cursor: undefined,
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

describe('startLocalTrashPurgeSchedule', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not start without a database connection', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('QSTASH_TOKEN', '');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    startLocalTrashPurgeSchedule();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
