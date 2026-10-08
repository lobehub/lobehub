import { AuvApiName, AuvIdentifier, AuvManifest } from '@lobechat/builtin-tool-auv';

import { deviceGateway } from '@/server/services/deviceGateway';
import { executeAuthorizedDeviceToolCall } from '@/server/services/deviceGateway/authorizedToolCall';
import {
  type DeviceClientKind,
  resolveDeviceClientKind,
} from '@/server/services/deviceGateway/deviceChannels';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';
import { withoutDeviceReplay } from './withoutDeviceReplay';

export const COMPUTER_USE_DEVICE_UNAVAILABLE_ERROR_CODE = 'COMPUTER_USE_DEVICE_UNAVAILABLE';

/**
 * The capability check could not run (the device did not answer it), and the
 * presence list does not show the desktop app as the device's only client — so
 * nothing was sent.
 * Says which of those it was instead of claiming the device lacks the feature.
 */
const buildUnverifiedDeviceResult = (
  deviceId: string,
  { clientKind, reason }: { clientKind: Exclude<DeviceClientKind, 'desktop'>; reason: string },
) => {
  const message =
    clientKind === 'cli-only'
      ? `The active device (${deviceId}) is connected only through the \`lh connect\` CLI, ` +
        `which cannot run Computer Use. Nothing was run. Ask the user to open the LobeHub ` +
        `desktop app on that machine, then retry.`
      : clientKind === 'mixed'
        ? `Could not confirm that the active device (${deviceId}) can run Computer Use: it did ` +
          `not answer the capability check (${reason}). Nothing was run, because the device is ` +
          `connected through both the LobeHub desktop app and the \`lh connect\` CLI, and the ` +
          `call could be routed to the CLI, which cannot run Computer Use. Retry shortly; if it ` +
          `keeps failing, ask the user to stop \`lh connect\` on that machine.`
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
        // Ask the client that would run the call: with `lh connect` up beside the
        // desktop app, an unconstrained read is answered by the CLI, which reports
        // no `supportedTools`. A gateway that predates `clientKinds` ignores it.
        const read = await deviceGateway.readDeviceSystemInfo(
          context.userId!,
          context.activeDeviceId!,
          workspaceId,
          { clientKinds: AuvManifest.deviceClients },
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
          // the capability. A device whose only live client is the desktop app is
          // enough to dispatch: the tool call has its own deadline and reconnect
          // recovery, which this read does not. A device that also runs
          // `lh connect` stays closed — the gateway would prefer the CLI.
          const clientKind = await resolveDeviceClientKind(
            context.userId!,
            context.activeDeviceId!,
            workspaceId,
          );
          if (clientKind !== 'desktop') {
            return buildUnverifiedDeviceResult(context.activeDeviceId!, {
              clientKind,
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
