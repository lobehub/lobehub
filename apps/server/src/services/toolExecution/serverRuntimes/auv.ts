import { AuvApiName, AuvIdentifier } from '@lobechat/builtin-tool-auv';

import { deviceGateway } from '@/server/services/deviceGateway';
import { executeAuthorizedDeviceToolCall } from '@/server/services/deviceGateway/authorizedToolCall';

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

    return {
      /**
       * Proxies one typed AUV CLI command to the active desktop device.
       *
       * Triggering workflow:
       *
       * `BuiltinToolsExecutor.execute`
       *   -> `lobe-computer-use/runCommand`
       *     -> {@link deviceGateway.executeToolCall}
       *
       * Upstream:
       * - Server-side builtin tool execution for `lobe-computer-use/runCommand`
       *
       * Downstream:
       * - {@link deviceGateway.queryDeviceSystemInfo}
       * - {@link deviceGateway.executeToolCall}
       */
      runCommand: async (args: unknown) => {
        const workspaceId = await getDeviceWorkspaceId();
        const systemInfo = await deviceGateway.queryDeviceSystemInfo(
          context.userId!,
          context.activeDeviceId!,
          workspaceId,
        );
        if (!systemInfo?.supportedTools?.includes(AuvIdentifier)) {
          throw new Error(
            'The selected device does not support Computer Use. Update the desktop app and reconnect.',
          );
        }
        return executeAuthorizedDeviceToolCall(
          context.serverDB,
          {
            deviceId: context.activeDeviceId!,
            operationId: context.operationId,
            userId: context.userId!,
            workspaceId,
          },
          {
            apiName: AuvApiName.runCommand,
            arguments: JSON.stringify(args ?? {}),
            identifier: AuvIdentifier,
          },
          context.executionTimeoutMs,
        );
      },
    };
  },
  identifier: AuvIdentifier,
};
