import {
  RemoteDeviceExecutionRuntime,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';
import debug from 'debug';

import { DeviceModel } from '@/database/models/device';
import { deviceGateway } from '@/server/services/deviceGateway';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

// Enable with DEBUG=lobe-server:remote-device (works in prod via the env var).
// Traces how the remote-device tool resolves its workspace scope and which
// device pools it reads, so a "lists personal devices instead of workspace"
// report can be pinned to a concrete layer (missing scope vs empty gateway pool).
const log = debug('lobe-server:remote-device');

export const remoteDeviceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Remote Device execution');
    }

    const userId = context.userId;
    const serverDB = context.serverDB;
    const agentId = context.agentId;
    const contextWorkspaceId = context.workspaceId;

    return new RemoteDeviceExecutionRuntime({
      // Personal pool (user principal) ∪ the current workspace's shared pool
      // (workspace principal), surfaced the same way the device-settings page
      // (`device.ts` listDevices) does: the DB-registered workspace rows merged
      // with the live gateway pool. Returning only the raw gateway pool meant a
      // workspace device the DB knows about could silently drop out — diverging
      // from the settings page and from `list_document`, which are DB-backed.
      queryDeviceList: async () => {
        // Resolve the workspace scope used to decide which workspace device pool
        // to include. Recovers from the running agent when the run-scoped
        // workspaceId was lost on the way to this tool call — see
        // `resolveRunWorkspaceId`. Otherwise a workspace agent would silently
        // degrade to the personal-only pool.
        const workspaceId = await resolveRunWorkspaceId(context);

        const deviceModel = serverDB ? new DeviceModel(serverDB, userId, workspaceId) : undefined;

        const [personal, workspaceOnline, workspaceRows] = await Promise.all([
          deviceGateway.queryDeviceList(userId),
          workspaceId ? deviceGateway.queryDeviceList(userId, workspaceId) : Promise.resolve([]),
          workspaceId && deviceModel ? deviceModel.queryWorkspaceDevices() : Promise.resolve([]),
        ]);

        // DB rows ⊕ gateway online: `online` is driven by the gateway's live
        // channels (the DB does not track liveness), but a workspace device the
        // gateway pool momentarily omits is still surfaced (offline) rather than
        // vanishing entirely.
        const onlineById = new Map(workspaceOnline.map((d) => [d.deviceId, d]));
        const seen = new Set<string>();
        const workspaceMerged = workspaceRows.map((row) => {
          seen.add(row.deviceId);
          const live = onlineById.get(row.deviceId);
          return {
            channels: live?.channels,
            deviceId: row.deviceId,
            hostname: live?.hostname ?? row.hostname ?? '',
            lastSeen: live?.lastSeen ?? row.lastSeenAt.toISOString(),
            online: !!live,
            platform: live?.platform ?? row.platform ?? '',
          };
        });
        // Gateway-reported workspace devices not yet auto-registered in the DB.
        const workspaceTransient = workspaceOnline.filter((d) => !seen.has(d.deviceId));

        log(
          'scope: contextWorkspaceId=%o resolvedWorkspaceId=%o agentId=%o | gateway personal=%d workspace=%d | db workspace rows=%d',
          contextWorkspaceId,
          workspaceId,
          agentId,
          personal.length,
          workspaceOnline.length,
          workspaceRows.length,
        );
        log(
          '  deviceIds: gatewayPersonal=%o gatewayWorkspace=%o dbWorkspace=%o',
          personal.map((d) => d.deviceId),
          workspaceOnline.map((d) => d.deviceId),
          workspaceRows.map((d) => d.deviceId),
        );

        return [...personal, ...workspaceMerged, ...workspaceTransient];
      },
    });
  },
  identifier: RemoteDeviceIdentifier,
};
