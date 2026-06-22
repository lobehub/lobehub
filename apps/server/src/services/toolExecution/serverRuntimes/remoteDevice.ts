import {
  RemoteDeviceExecutionRuntime,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';

import { deviceGateway } from '@/server/services/deviceGateway';

import { type ServerRuntimeRegistration } from './types';

export const remoteDeviceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Remote Device execution');
    }

    const userId = context.userId;
    const workspaceId = context.workspaceId;

    return new RemoteDeviceExecutionRuntime({
      // Personal pool (user principal) ∪ the current workspace's shared pool
      // (workspace principal). Mirrors execAgent's onlineDevices fetch so the
      // tool refresh stays consistent with the systemRole snapshot — otherwise
      // a workspace-bound chat would see its workspace device in the system
      // prompt but lose it the moment the model calls listOnlineDevices.
      queryDeviceList: async () => {
        const [personal, workspace] = await Promise.all([
          deviceGateway.queryDeviceList(userId),
          workspaceId ? deviceGateway.queryDeviceList(userId, workspaceId) : Promise.resolve([]),
        ]);
        return [...personal, ...workspace];
      },
    });
  },
  identifier: RemoteDeviceIdentifier,
};
