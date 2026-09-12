import {
  type DeviceAttachment,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';
import { RemoteDeviceExecutionRuntime } from '@lobechat/builtin-tool-remote-device/executionRuntime';
import debug from 'debug';

import { deviceGateway } from '@/server/services/deviceGateway';
import { DevicePoolAccessService } from '@/server/services/deviceGateway/poolAccess';
import {
  filterAuthorizedDevicePresence,
  isGatewayOnlyDevicePresenceAllowed,
} from '@/server/services/deviceGateway/scopedDevicePresence';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

// Enable with DEBUG=lobe-server:remote-device (works in prod via the env var).
const log = debug('lobe-server:remote-device');

/**
 * Registers remote-device discovery for a server-side agent tool execution.
 *
 * Use when:
 * - The tools engine activates the remote-device builtin runtime
 *
 * Expects:
 * - Workspace discovery has a server database handle for registry authorization
 *
 * Returns:
 * - A runtime whose device list is scoped to one authorized principal
 *
 * Call stack:
 *
 * ToolExecutionService
 *   -> {@link remoteDeviceRuntime.factory}
 *     -> getScopedOnlineDevices
 *       -> RemoteDeviceExecutionRuntime
 */
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

        // Without a DB handle, personal scope may retain the auto-registration
        // transient fallback. Workspace scope cannot: its registry row is the
        // authorization boundary, and a raw Gateway socket may be a stale
        // process that missed Unshare.
        if (!serverDB) {
          const scope = workspaceId ? ('workspace' as const) : ('personal' as const);
          if (!isGatewayOnlyDevicePresenceAllowed(scope)) return [];
          const online = await deviceGateway.queryDeviceList(userId, workspaceId);
          return filterAuthorizedDevicePresence(new Set(), online, scope).map((d) => ({
            ...d,
            scope,
          }));
        }

        const poolContext = context.operationId
          ? await new DevicePoolAccessService(serverDB, userId, workspaceId).loadContext(
              context.operationId,
            )
          : {
              actorUserId: userId,
              agentId: context.agentId ?? '',
              blocked: true,
              trigger: 'chat' as const,
              workspaceId,
            };
        const devices = await getScopedOnlineDevices(serverDB, userId, workspaceId, poolContext);
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
