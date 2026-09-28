import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { type LobeChatDatabase } from '@lobechat/database';
import { sortDevicesByActivity } from '@lobechat/types';
import debug from 'debug';

import { DeviceModel } from '@/database/models/device';

import { deviceGateway } from './index';
import { filterAuthorizedDevicePresence } from './scopedDevicePresence';

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
 * The **gateway is authoritative** for liveness, while the database is
 * authoritative for workspace enrollment and visibility. Personal lookups may
 * degrade to Gateway-only transient devices during auto-registration; workspace
 * lookups fail closed when their registry query is unavailable.
 *
 * Use when:
 * - Agent planning or a server runtime needs devices eligible in one principal
 * - Device metadata must combine persistent registration with current presence
 *
 * Expects:
 * - `workspaceId`, when present, has already passed an authorized workspace scope
 *
 * Returns:
 * - Registered devices with scoped liveness, plus personal-only transient devices
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
        log(
          'DB device lookup failed (scope=%s); %s: %O',
          scope,
          workspaceId ? 'failing closed' : 'using gateway only',
          error,
        );
        return [] as Awaited<ReturnType<typeof deviceModel.queryPersonal>>;
      },
    ),
    deviceGateway.queryDeviceList(userId, workspaceId),
  ]);

  const registeredDeviceIds = new Set(rows.map((device) => device.deviceId));
  const authorizedOnline = filterAuthorizedDevicePresence(registeredDeviceIds, online, scope);
  const liveById = new Map(authorizedOnline.map((d) => [d.deviceId, d]));
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
  // Personal clients register immediately before opening their socket, but a
  // short race can still expose the live connection first. Preserve that
  // compatibility only for personal scope. Workspace rows are authorization:
  // a Gateway-only connection may be a stale process that missed Unshare and
  // must never become visible or executable again.
  const transient = authorizedOnline
    .filter((d) => !seen.has(d.deviceId))
    .map((d): DeviceAttachment => ({ ...d, friendlyName: null, scope }));

  // Online first, then most recently active — the same order the settings list
  // and the run-target picker render, so "the first device" means the same
  // thing to the model as it does to the user reading the picker.
  return sortDevicesByActivity([...fromDb, ...transient]);
};
