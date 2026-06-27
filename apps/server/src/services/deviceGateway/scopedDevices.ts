import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { DeviceModel } from '@/database/models/device';

import { deviceGateway } from './index';

const log = debug('lobe-server:device-scope');

/**
 * Online devices an agent run may reach, scoped to a SINGLE principal and built
 * the way the device-settings page (`device.ts` listDevices) does — the
 * DB-registered rows merged with the live gateway pool.
 *
 * Scope is strict / mutually exclusive (mirrors `buildWorkspaceWhere`):
 * - workspace run (`workspaceId` set) → ONLY that workspace's devices. Personal
 *   devices are never exposed to a workspace conversation.
 * - personal run (no `workspaceId`) → ONLY the user's personal devices.
 *
 * Each device carries:
 * - `scope` (`personal` | `workspace`): which pool it came from.
 * - `friendlyName`: the user-set alias from the DB. The gateway only knows the
 *   raw hostname, so without this merge the device shows up as e.g.
 *   `VM-6-209-ubuntu` and the user can't recognise which machine it is.
 *
 * Rows include offline DB devices (`online: false`); callers that only want live
 * devices filter on `online` (both `listOnlineDevices` and the systemRole
 * snapshot already do).
 *
 * The **gateway is authoritative** for which devices are online (and enforces the
 * scope via the principal); the DB lookup is best-effort enrichment (aliases +
 * offline rows). A DB hiccup must NOT blank the device list / disable
 * auto-activation, so it degrades to gateway-only on failure.
 */
export const getScopedOnlineDevices = async (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<DeviceAttachment[]> => {
  const deviceModel = new DeviceModel(serverDB, userId, workspaceId);
  const scope: 'personal' | 'workspace' = workspaceId ? 'workspace' : 'personal';

  const [rows, online] = await Promise.all([
    (workspaceId ? deviceModel.queryWorkspaceDevices() : deviceModel.queryPersonal()).catch(
      (error) => {
        log('DB device lookup failed (scope=%s); using gateway only: %O', scope, error);
        return [] as Awaited<ReturnType<typeof deviceModel.queryPersonal>>;
      },
    ),
    deviceGateway.queryDeviceList(userId, workspaceId),
  ]);

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
