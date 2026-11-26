import debug from 'debug';

import type { DeviceModel } from '@/database/models/device';

const log = debug('lobe-server:device-last-seen');

/**
 * How stale `devices.lastSeenAt` may get while the gateway reports the device
 * online. Bounds both the write rate (one UPDATE per device per window while
 * someone reads the list) and how far an offline device's "last connected"
 * can lag the moment it actually dropped.
 */
export const DEVICE_LAST_SEEN_REFRESH_MS = 5 * 60_000;

interface SeenRow {
  deviceId: string;
  id: string;
  lastSeenAt: Date;
}

/** Rows the gateway reports online whose `lastSeenAt` is older than the refresh window. */
export const staleOnlineRowIds = (
  rows: readonly SeenRow[],
  onlineDeviceIds: ReadonlySet<string>,
  now: Date,
): string[] =>
  rows
    .filter(
      (row) =>
        onlineDeviceIds.has(row.deviceId) &&
        now.getTime() - row.lastSeenAt.getTime() >= DEVICE_LAST_SEEN_REFRESH_MS,
    )
    .map((row) => row.id);

/**
 * Keep `lastSeenAt` current for devices seen online, so an offline device's
 * "last connected" is when it was last alive rather than when it last
 * registered. The gateway has no disconnect callback to the server, so every
 * read that already merges registry rows with live presence records it here.
 *
 * Best effort: a failed write must not fail the read that observed presence.
 */
export const recordDevicesSeen = async (
  deviceModel: Pick<DeviceModel, 'markSeen'>,
  rows: readonly SeenRow[],
  onlineDeviceIds: ReadonlySet<string>,
  now = new Date(),
): Promise<void> => {
  const rowIds = staleOnlineRowIds(rows, onlineDeviceIds, now);
  if (rowIds.length === 0) return;

  try {
    // The same cutoff guards the write, so concurrent reads of one stale row
    // stamp it once per window rather than once per read.
    await deviceModel.markSeen(rowIds, now, new Date(now.getTime() - DEVICE_LAST_SEEN_REFRESH_MS));
  } catch (error) {
    log('Failed to record %d device(s) as seen: %O', rowIds.length, error);
  }
};
