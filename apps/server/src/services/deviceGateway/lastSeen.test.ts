import { describe, expect, it, vi } from 'vitest';

import { DEVICE_LAST_SEEN_REFRESH_MS, recordDevicesSeen, staleOnlineRowIds } from './lastSeen';

const now = new Date('2026-11-26T12:00:00.000Z');
const row = (deviceId: string, ageMs: number) => ({
  deviceId,
  id: `row-${deviceId}`,
  lastSeenAt: new Date(now.getTime() - ageMs),
});

describe('staleOnlineRowIds', () => {
  it('picks online rows older than the refresh window only', () => {
    const rows = [
      row('stale-online', DEVICE_LAST_SEEN_REFRESH_MS),
      row('fresh-online', DEVICE_LAST_SEEN_REFRESH_MS - 1),
      row('stale-offline', 60 * 24 * 60 * 60_000),
    ];

    expect(staleOnlineRowIds(rows, new Set(['stale-online', 'fresh-online']), now)).toEqual([
      'row-stale-online',
    ]);
  });
});

describe('recordDevicesSeen', () => {
  it('writes nothing when every online row is fresh', async () => {
    const markSeen = vi.fn();

    await recordDevicesSeen({ markSeen }, [row('a', 1000)], new Set(['a']), now);

    expect(markSeen).not.toHaveBeenCalled();
  });

  it('stamps stale online rows with the observation time', async () => {
    const markSeen = vi.fn().mockResolvedValue(undefined);

    await recordDevicesSeen(
      { markSeen },
      [row('a', DEVICE_LAST_SEEN_REFRESH_MS)],
      new Set(['a']),
      now,
    );

    expect(markSeen).toHaveBeenCalledWith(
      ['row-a'],
      now,
      new Date(now.getTime() - DEVICE_LAST_SEEN_REFRESH_MS),
    );
  });

  it('does not fail the read when the write fails', async () => {
    const markSeen = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(
      recordDevicesSeen({ markSeen }, [row('a', DEVICE_LAST_SEEN_REFRESH_MS)], new Set(['a']), now),
    ).resolves.toBeUndefined();
  });
});
