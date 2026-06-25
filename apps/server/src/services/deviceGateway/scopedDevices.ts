import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { type LobeChatDatabase } from '@lobechat/database';

import { DeviceModel } from '@/database/models/device';

import { deviceGateway } from './index';

/**
 * Online devices the agent can reach: the personal pool (user principal) ∪ the
 * workspace pool (`workspace:<id>` principal), each built the way the
 * device-settings page (`device.ts` listDevices) does — the DB-registered rows
 * merged with the live gateway pool.
 *
 * Beyond the raw gateway shape, each device carries:
 * - `scope` (`personal` | `workspace`): so the model and the user can tell an
 *   otherwise-identical machine apart — the same hardware connected both
 *   personally and via `lh connect --workspace` yields two distinct ids.
 * - `friendlyName`: the user-set alias from the DB. The gateway only knows the
 *   raw hostname, so without this merge the device shows up as e.g.
 *   `VM-6-209-ubuntu` and the user can't recognise which machine it is.
 *
 * Rows include offline DB devices (`online: false`); callers that only want live
 * devices filter on `online` (both `listOnlineDevices` and the systemRole
 * snapshot already do).
 */
export const getScopedOnlineDevices = async (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<DeviceAttachment[]> => {
  const deviceModel = new DeviceModel(serverDB, userId, workspaceId);

  const [personalRows, workspaceRows, personalOnline, workspaceOnline] = await Promise.all([
    deviceModel.queryPersonal(),
    workspaceId ? deviceModel.queryWorkspaceDevices() : Promise.resolve([]),
    deviceGateway.queryDeviceList(userId),
    workspaceId ? deviceGateway.queryDeviceList(userId, workspaceId) : Promise.resolve([]),
  ]);

  const build = (
    rows: Awaited<ReturnType<typeof deviceModel.queryPersonal>>,
    online: DeviceAttachment[],
    scope: 'personal' | 'workspace',
  ): DeviceAttachment[] => {
    const liveById = new Map(online.map((d) => [d.deviceId, d]));
    const seen = new Set<string>();
    const fromDb = rows.map((row): DeviceAttachment => {
      seen.add(row.deviceId);
      const live = liveById.get(row.deviceId);
      return {
        channels: live?.channels,
        deviceId: row.deviceId,
        friendlyName: row.friendlyName ?? null,
        hostname: live?.hostname ?? row.hostname ?? '',
        lastSeen: live?.lastSeen ?? row.lastSeenAt.toISOString(),
        online: !!live,
        platform: live?.platform ?? row.platform ?? '',
        scope,
      };
    });
    // Online in the gateway but not yet auto-registered in the DB (no alias yet).
    const transient = online
      .filter((d) => !seen.has(d.deviceId))
      .map((d): DeviceAttachment => ({ ...d, friendlyName: null, scope }));
    return [...fromDb, ...transient];
  };

  return [
    ...build(personalRows, personalOnline, 'personal'),
    ...build(workspaceRows, workspaceOnline, 'workspace'),
  ];
};
