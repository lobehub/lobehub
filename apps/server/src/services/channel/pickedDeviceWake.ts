import type { LobeChatDatabase } from '@lobechat/database';
import pMap from 'p-map';

import {
  findWakeableManagedDevices,
  waitForManagedDeviceOnline,
  wakeManagedDevice,
} from '@/server/services/deviceGateway/managedDeviceWake';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { wakeChannel } from './queue';

export interface PickedOfflineDevice {
  deviceId: string;
  /** The member who picked the device in the Channel; its device calls route by this user. */
  ownerId?: string;
}

/** Channels already waiting in this process for a woken device, by channel, owner and device. */
const waiting = new Set<string>();

/**
 * Start the managed cloud devices picked in a Channel that its queued replies wait for. A
 * managed cloud device sleeps until woken, so without this a reply waiting for one would wait
 * forever. An ordinary connected device is left alone: only its owner can bring it online.
 *
 * The wake request is awaited (bounded by the provider timeout), so it is made even when the
 * host ends the work with the response. Waiting for the device to connect is not: once it is
 * online the Channel advances at once, and the Channel's reconcile pass claims the reply anyway
 * if that wait is cut short.
 */
export const wakePickedDevices = async (
  db: LobeChatDatabase,
  {
    channelId,
    devices,
    onlineDeviceIds,
    workspaceId,
  }: {
    channelId: string;
    devices: PickedOfflineDevice[];
    onlineDeviceIds: string[];
    workspaceId: string | null;
  },
) => {
  const unique = new Map<string, { deviceId: string; ownerId: string }>();
  for (const { deviceId, ownerId } of devices)
    if (ownerId) unique.set(`${ownerId}\0${deviceId}`, { deviceId, ownerId });

  await pMap(
    unique.values(),
    async ({ deviceId, ownerId }) => {
      try {
        const [target] = await findWakeableManagedDevices(
          { db, userId: ownerId, workspaceId: workspaceId ?? undefined },
          [deviceId],
          onlineDeviceIds,
        );
        if (!target) return;
        if (!(await wakeManagedDevice(ownerId, target))) return;

        const key = `${channelId}\0${ownerId}\0${deviceId}`;
        if (waiting.has(key)) return;
        waiting.add(key);
        afterUnscoped(async () => {
          try {
            if (await waitForManagedDeviceOnline(ownerId, target)) await wakeChannel(channelId);
          } finally {
            waiting.delete(key);
          }
        });
      } catch (error) {
        // One device failing to wake must not fail the Channel advance or the other wakes.
        console.error('[channel:wakePickedDevices]', channelId, deviceId, error);
      }
    },
    { concurrency: 3 },
  );
};
