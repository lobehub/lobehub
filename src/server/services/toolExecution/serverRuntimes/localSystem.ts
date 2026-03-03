import { LocalSystemIdentifier, LocalSystemManifest } from '@lobechat/builtin-tool-local-system';

import { deviceProxy } from '../deviceProxy';
import { type ServerRuntimeRegistration } from './types';

export const localSystemRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Local System device proxy execution');
    }
    if (!context.activeDeviceId) {
      throw new Error('activeDeviceId is required for Local System device proxy execution');
    }

    const proxy: Record<string, (args: any) => Promise<any>> = {};

    for (const api of LocalSystemManifest.api) {
      proxy[api.name] = async (args: any) => {
        return deviceProxy.executeToolCall(
          { deviceId: context.activeDeviceId!, userId: context.userId! },
          {
            apiName: api.name,
            arguments: JSON.stringify(args),
            identifier: LocalSystemIdentifier,
          },
        );
      };
    }

    return proxy;
  },
  identifier: LocalSystemIdentifier,
};
