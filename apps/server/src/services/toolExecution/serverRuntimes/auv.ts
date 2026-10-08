import { AuvApiName, AuvIdentifier } from '@lobechat/builtin-tool-auv';

import { deviceGateway } from '@/server/services/deviceGateway';
import { executeAuthorizedDeviceToolCall } from '@/server/services/deviceGateway/authorizedToolCall';
import { resolveDeviceClientKind } from '@/server/services/deviceGateway/deviceChannels';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';
import { withoutDeviceReplay } from './withoutDeviceReplay';

export const COMPUTER_USE_DEVICE_UNAVAILABLE_ERROR_CODE = 'COMPUTER_USE_DEVICE_UNAVAILABLE';

/**
 * The capability check could not run (the device did not answer it), and the
 * presence list does not show a desktop app either — so nothing was sent.
 * Says which of those it was instead of claiming the device lacks the feature.
 */
const buildUnverifiedDeviceResult = (
  deviceId: string,
  { cliOnly, reason }: { cliOnly: boolean; reason: string },
) => {
  const message = cliOnly
    ? `The active device (${deviceId}) is connected only through the \`lh connect\` CLI, ` +
      `which cannot run Computer Use. Nothing was run. Ask the user to open the LobeHub ` +
      `desktop app on that machine, then retry.`
    : `Could not confirm that the active device (${deviceId}) can run Computer Use: it did ` +
      `not answer the capability check (${reason}). Nothing was run. The device may be busy ` +
      `or reconnecting — retry shortly, and if it keeps failing, ask the user to check that ` +
      `the LobeHub desktop app is running and connected.`;
  return {
    content: message,
    error: { code: COMPUTER_USE_DEVICE_UNAVAILABLE_ERROR_CODE, message },
    success: false,
  };
};

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
       * - {@link deviceGateway.readDeviceSystemInfo}
       * - {@link resolveDeviceClientKind} when the device does not answer that read
       * - {@link deviceGateway.executeToolCall}
       */
      runCommand: async (args: unknown) => {
        const workspaceId = await getDeviceWorkspaceId();
        const read = await deviceGateway.readDeviceSystemInfo(
          context.userId!,
          context.activeDeviceId!,
          workspaceId,
        );
        if (read.ok) {
          // An answer without the capability is an old client (or `lh connect`):
          // both route by apiName alone and would treat `runCommand` as a shell call.
          if (!read.systemInfo.supportedTools?.includes(AuvIdentifier)) {
            throw new Error(
              'The selected device does not support Computer Use. Update the desktop app and reconnect.',
            );
          }
        } else {
          // No answer (busy device timing out, a reconnect gap) says nothing about
          // the capability. A live desktop app is enough to dispatch: the tool call
          // has its own deadline and reconnect recovery, which this read does not.
          const clientKind = await resolveDeviceClientKind(
            context.userId!,
            context.activeDeviceId!,
            workspaceId,
          );
          if (clientKind !== 'desktop') {
            return buildUnverifiedDeviceResult(context.activeDeviceId!, {
              cliOnly: clientKind === 'cli-only',
              reason: read.reason,
            });
          }
        }

        const result = await executeAuthorizedDeviceToolCall(
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

        return withoutDeviceReplay(result);
      },
    };
  },
  identifier: AuvIdentifier,
};
