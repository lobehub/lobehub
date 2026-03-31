import {
  RemoteDeviceExecutionRuntime,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';

import { deviceProxy } from '../deviceProxy';
import { type ServerRuntimeRegistration } from './types';

export const remoteDeviceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Remote Device execution');
    }

    const userId = context.userId;

    return new RemoteDeviceExecutionRuntime({
      queryDeviceList: () => deviceProxy.queryDeviceList(userId),
    });
  },
  identifier: RemoteDeviceIdentifier,
};
