import { AuvApiName, AuvIdentifier } from '@lobechat/builtin-tool-auv';
import type { DeviceClient } from '@lobechat/types';

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

const CLI_WITHOUT_COMPUTER_USE =
  'the `lh connect` CLI, which offers Computer Use only when started with `--auv <binary>`';

/**
 * The capability check could not run (the desktop app did not answer it), no
 * `lh connect` on the device offers Computer Use, and the presence list does
 * not show the desktop app as the device's only client — so nothing was sent.
 * Says which of those it was instead of claiming the device lacks the feature.
 */
const buildUnverifiedDeviceResult = (
  deviceId: string,
  { clientKind, reason }: { clientKind: Exclude<DeviceClientKind, 'desktop'>; reason: string },
) => {
  const message =
    clientKind === 'cli-only'
      ? `The active device (${deviceId}) is connected only through ${CLI_WITHOUT_COMPUTER_USE}. ` +
        `Nothing was run. Ask the user to open the LobeHub desktop app on that machine, or to ` +
        `restart \`lh connect\` with \`--auv\`, then retry.`
      : clientKind === 'mixed'
        ? `Could not confirm that the active device (${deviceId}) can run Computer Use: the ` +
          `desktop app did not answer the capability check (${reason}), and the device also runs ` +
          `${CLI_WITHOUT_COMPUTER_USE}. Nothing was run. Retry shortly; if it keeps failing, ask ` +
          `the user to check that the LobeHub desktop app is running and connected.`
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
       * Proxies one typed AUV CLI command to the client on the active device
       * that runs Computer Use: the desktop app, or `lh connect --auv`.
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
       * - {@link deviceGateway.readDeviceSystemInfo}, per client kind
       * - {@link resolveDeviceClientKind} when the desktop app does not answer that read
       * - {@link deviceGateway.executeToolCall}, constrained to the chosen client kind
       */
      runCommand: async (args: unknown) => {
        const workspaceId = await getDeviceWorkspaceId();
        const dispatch = async (clientKinds: DeviceClient[]) =>
          withoutDeviceReplay(
            await executeAuthorizedDeviceToolCall(
              context.serverDB,
              {
                clientKinds,
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
            ),
          );
        // Ask each client separately: one device can hold the desktop app and
        // `lh connect` at once, and only a client that lists the capability can
        // serve the call. A gateway that predates `clientKinds` ignores it.
        const readFrom = (kind: DeviceClient) =>
          deviceGateway.readDeviceSystemInfo(
            context.userId!,
            context.activeDeviceId!,
            workspaceId,
            { clientKinds: [kind] },
          );

        // The desktop app comes first: it owns its daemon and the OS permissions.
        const desktop = await readFrom('desktop');
        if (desktop.ok && desktop.systemInfo.supportedTools?.includes(AuvIdentifier)) {
          return dispatch(['desktop']);
        }
        const cli = await readFrom('cli');
        if (cli.ok && cli.systemInfo.supportedTools?.includes(AuvIdentifier)) {
          return dispatch(['cli']);
        }

        // An answer without the capability is an old desktop app.
        if (desktop.ok) {
          throw new Error(
            'The selected device does not support Computer Use. Update the desktop app and reconnect.',
          );
        }

        // No desktop answer (busy device timing out, a reconnect gap) says
        // nothing about the capability. A device whose only live client is the
        // desktop app is enough to dispatch: the tool call has its own deadline
        // and reconnect recovery, which this read does not.
        const clientKind = await resolveDeviceClientKind(
          context.userId!,
          context.activeDeviceId!,
          workspaceId,
        );
        if (clientKind === 'desktop') return dispatch(['desktop']);

        return buildUnverifiedDeviceResult(context.activeDeviceId!, {
          clientKind,
          reason: desktop.reason,
        });
      },
    };
  },
  identifier: AuvIdentifier,
};
