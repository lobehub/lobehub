import { BrowserIdentifier, BrowserManifest } from '@lobechat/builtin-tool-browser';

import { deviceGateway } from '@/server/services/deviceGateway';

import { buildNoActiveDeviceResult, REMOTE_DEVICE_TOOL_IDENTIFIER } from './noActiveDevice';
import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

/**
 * Browser tool server runtime.
 *
 * A cloud agent run can't touch a device's renderer directly, so each browser
 * api call is proxied back to the bound device through `deviceGateway`. The
 * device daemon forwards it to the desktop renderer, which runs the exact same
 * client `browserExecutor` (mount webview / snapshot / click / …) verified for
 * the local runtime — so there is one behavioral source of truth.
 *
 * The browser session on the device is keyed by `topic:<topicId>`. The gateway
 * tool-call envelope only carries `apiName` + `arguments`, so the runtime rides
 * the run's identity in the args (mirroring how localSystem injects `cwd`); the
 * device strips it back out before invoking the executor.
 */
export const browserRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Browser device proxy execution');
    }
    // No active device: `activeDeviceId` is legitimately empty in device-capable
    // runs (never bound yet, or the device dropped offline mid-run and the plan
    // re-resolved to `device-unrouted`). Historically this guard threw a bare
    // error string with no recovery path — the model kept stalling on it (see
    // agent vent reports). Return a structured, actionable result per API call
    // instead: the model is told exactly how to recover (activate a device, or
    // ask the user to reconnect) rather than hitting an opaque failure.
    if (!context.activeDeviceId) {
      const noDevice = buildNoActiveDeviceResult('Browser device proxy', {
        remoteDeviceToolAvailable: context.toolManifestMap
          ? REMOTE_DEVICE_TOOL_IDENTIFIER in context.toolManifestMap
          : true,
      });

      const proxy: Record<string, (args: any) => Promise<any>> = {};
      for (const api of BrowserManifest.api) {
        proxy[api.name] = async () => noDevice;
      }
      return proxy;
    }
    if (!context.agentId) {
      throw new Error('agentId is required for Browser device proxy execution');
    }
    if (!context.topicId) {
      throw new Error('topicId is required for Browser device proxy execution');
    }

    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const getDeviceWorkspaceId = () => (workspaceIdPromise ??= resolveRunWorkspaceId(context));

    const proxy: Record<string, (args: any) => Promise<any>> = {};

    for (const api of BrowserManifest.api) {
      proxy[api.name] = async (args: any) => {
        // Carry the run identity so the device resolves the right browser
        // session (`topic:<topicId>`); the agentId rides along so the device can
        // decide whether revealing the panel would yank the user's view. Both
        // are stripped device-side.
        const finalArgs = { ...args, __agentId: context.agentId, __topicId: context.topicId };

        return deviceGateway.executeToolCall(
          {
            deviceId: context.activeDeviceId!,
            operationId: context.operationId,
            userId: context.userId!,
            workspaceId: await getDeviceWorkspaceId(),
          },
          {
            apiName: api.name,
            arguments: JSON.stringify(finalArgs),
            identifier: BrowserIdentifier,
          },
          context.executionTimeoutMs,
        );
      };
    }

    return proxy;
  },
  identifier: BrowserIdentifier,
};
