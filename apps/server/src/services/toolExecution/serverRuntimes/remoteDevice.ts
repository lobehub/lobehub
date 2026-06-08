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

    return new RemoteDeviceExecutionRuntime({
      queryDeviceList: () => deviceGateway.queryDeviceList(userId),
    });
  },
  identifier: RemoteDeviceIdentifier,
};
