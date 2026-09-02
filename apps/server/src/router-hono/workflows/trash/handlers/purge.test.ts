// @vitest-environment node
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/server';
import { TrashService } from '@/server/services/trash';
import { triggerTrashPurge } from '@/server/workflows/trash';

import { purge } from './purge';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/trash', () => ({ TrashService: { sweepExpired: vi.fn() } }));
vi.mock('@/server/workflows/trash', () => ({ triggerTrashPurge: vi.fn() }));

const context = (body: Record<string, unknown> = {}) =>
  ({
    json: vi.fn((value) => value),
    req: { json: vi.fn(async () => body) },
  }) as unknown as Context;

describe('trash purge workflow handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(triggerTrashPurge).mockResolvedValue(true);
  });

  it('processes one bounded batch and queues the next batch', async () => {
    vi.mocked(TrashService.sweepExpired).mockResolvedValue({
      failed: 1,
      nextCursor: { expiresAt: '2026-09-01T00:00:00.000Z', id: 'root-25' },
      pruned: 0,
      purged: 24,
      scanned: 25,
    });

    await expect(purge(context())).resolves.toMatchObject({ continued: true, success: true });
    expect(TrashService.sweepExpired).toHaveBeenCalledWith({}, { cursor: undefined, limit: 25 });
    expect(triggerTrashPurge).toHaveBeenCalledWith({
      cursor: { expiresAt: '2026-09-01T00:00:00.000Z', id: 'root-25' },
      limit: 25,
      remainingBatches: 7,
    });
  });

  it('stops the chain when a partial batch drains the queue', async () => {
    vi.mocked(TrashService.sweepExpired).mockResolvedValue({
      failed: 1,
      nextCursor: { expiresAt: '2026-09-01T00:00:00.000Z', id: 'root-3' },
      pruned: 0,
      purged: 2,
      scanned: 3,
    });

    await expect(purge(context({ limit: 999 }))).resolves.toMatchObject({
      continued: false,
      success: true,
    });
    expect(TrashService.sweepExpired).toHaveBeenCalledWith({}, { cursor: undefined, limit: 50 });
    expect(triggerTrashPurge).not.toHaveBeenCalled();
  });

  it('preserves the cursor in a delayed continuation when the burst budget rolls over', async () => {
    const nextCursor = { expiresAt: '2026-09-01T00:00:00.000Z', id: 'root-50' };
    vi.mocked(TrashService.sweepExpired).mockResolvedValue({
      failed: 50,
      nextCursor,
      pruned: 0,
      purged: 0,
      scanned: 50,
    });

    await expect(
      purge(
        context({
          cursor: { expiresAt: '2026-08-31T00:00:00.000Z', id: 'root-0' },
          limit: 50,
          remainingBatches: 1,
        }),
      ),
    ).resolves.toMatchObject({ continued: true, success: true });
    expect(TrashService.sweepExpired).toHaveBeenCalledWith(
      {},
      {
        cursor: { expiresAt: '2026-08-31T00:00:00.000Z', id: 'root-0' },
        limit: 50,
      },
    );
    expect(triggerTrashPurge).toHaveBeenCalledWith(
      { cursor: nextCursor, limit: 50, remainingBatches: 8 },
      { delay: 60 },
    );
  });
});
