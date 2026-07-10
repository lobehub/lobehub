import {
  type DeviceAttachment,
  RemoteDeviceExecutionRuntime,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';
import debug from 'debug';

import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

// Enable with DEBUG=lobe-server:remote-device (works in prod via the env var).
const log = debug('lobe-server:remote-device');

export const remoteDeviceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Remote Device execution');
    }

    const userId = context.userId;
    const serverDB = context.serverDB;

    return new RemoteDeviceExecutionRuntime({
      // Personal pool (user principal) ∪ the current workspace's shared pool
      // (workspace principal), surfaced the same way the device-settings page
      // (`device.ts` listDevices) does — DB rows merged with the live gateway
      // pool, tagged with `scope` and the user-set `friendlyName` alias so the
      // model can tell the workspace device apart from the personal one.
      queryDeviceList: async (): Promise<DeviceAttachment[]> => {
        // Resolve the workspace scope used to decide which workspace device pool
        // to include. Recovers from the running agent when the run-scoped
        // workspaceId was lost on the way to this tool call — see
        // `resolveRunWorkspaceId`. Otherwise a workspace agent would silently
        // degrade to the personal-only pool.
        const workspaceId = await resolveRunWorkspaceId(context);

        // Without a DB handle we cannot merge aliases / DB rows; fall back to the
        // raw gateway pool for the active scope (workspace runs never include
        // personal devices), still tagged with scope.
        if (!serverDB) {
          const scope = workspaceId ? ('workspace' as const) : ('personal' as const);
          const online = await deviceGateway.queryDeviceList(userId, workspaceId);
          return online.map((d) => ({ ...d, scope }));
        }

        const devices = await getScopedOnlineDevices(serverDB, userId, workspaceId);
        log(
          'listOnlineDevices: workspaceId=%o -> %d device(s): %o',
          workspaceId,
          devices.length,
          devices.map((d) => ({
            id: d.deviceId,
            name: d.friendlyName ?? d.hostname,
            online: d.online,
            scope: d.scope,
          })),
        );
        return devices;
      },
    });
  },
  identifier: RemoteDeviceIdentifier,
};
