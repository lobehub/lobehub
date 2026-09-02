import { AuvApiName, AuvIdentifier } from '@lobechat/builtin-tool-auv';

import { deviceGateway } from '@/server/services/deviceGateway';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const auvRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) throw new Error('userId is required for AUV device proxy execution');
    if (!context.activeDeviceId) {
      throw new Error('activeDeviceId is required for AUV device proxy execution');
    }

    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const getDeviceWorkspaceId = () => (workspaceIdPromise ??= resolveRunWorkspaceId(context));
    const execute = async (apiName: string, args: unknown) =>
      deviceGateway.executeToolCall(
        {
          deviceId: context.activeDeviceId!,
          operationId: context.operationId,
          userId: context.userId!,
          workspaceId: await getDeviceWorkspaceId(),
        },
        {
          apiName,
          arguments: JSON.stringify(args ?? {}),
          identifier: AuvIdentifier,
        },
        context.executionTimeoutMs,
      );

    return {
      /**
       * Proxies one typed AUV CLI command to the active desktop device.
       *
       * Triggering workflow:
       *
       * `BuiltinToolsExecutor.execute`
       *   -> `lobe-auv/runCommand`
       *     -> {@link deviceGateway.executeToolCall}
       *
       * Upstream:
       * - Server-side builtin tool execution for `lobe-auv/runCommand`
       *
       * Downstream:
       * - {@link deviceGateway.executeToolCall}
       */
      runCommand: (args: unknown) => execute(AuvApiName.runCommand, args),
    };
  },
  identifier: AuvIdentifier,
};
