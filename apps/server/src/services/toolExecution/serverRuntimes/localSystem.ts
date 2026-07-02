import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';

import { deviceGateway } from '@/server/services/deviceGateway';

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

/**
 * Which arg carries the working directory for the APIs that consume one. The
 * model never picks the working directory — the system prompt's
 * `{{workingDirectory}}` tells it where it is — so the runtime injects it as the
 * tool call's cwd/scope. `executeToolCall` only forwards `arguments`, so it must
 * ride in the args; the daemon otherwise falls back to `process.cwd()` (= `/`
 * for a Finder/Dock-launched app):
 *
 * - `runCommand → cwd`: the manifest deliberately hides `cwd`, but the daemon
 *   spawns in `params.cwd`.
 * - file ops (`readFile`/`writeFile`/`editFile`/`moveFiles`) → `cwd`:
 *   the daemon resolves a relative `path`/`file_path`/move item against
 *   `params.cwd` (see `resolveAgainstCwd`), so a model-supplied relative path
 *   lands in the bound directory instead of `/`. Absolute paths ignore it.
 * - search ops (`searchFiles`/`globFiles`/`grepContent`) → `scope`: their
 *   manifest claims `scope` "defaults to the working directory", but the daemon
 *   falls back to `process.cwd()`. Inject `scope` so that promise holds.
 *
 * APIs that act on a command id (getCommandOutput / killCommand) take neither.
 */
const WORKING_DIR_ARG: Partial<Record<string, 'cwd' | 'scope'>> = {
  [LocalSystemApiName.editFile]: 'cwd',
  [LocalSystemApiName.globFiles]: 'scope',
  [LocalSystemApiName.grepContent]: 'scope',
  [LocalSystemApiName.moveFiles]: 'cwd',
  [LocalSystemApiName.readFile]: 'cwd',
  [LocalSystemApiName.runCommand]: 'cwd',
  [LocalSystemApiName.searchFiles]: 'scope',
  [LocalSystemApiName.writeFile]: 'cwd',
};

export const localSystemRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Local System device proxy execution');
    }
    if (!context.activeDeviceId) {
      throw new Error('activeDeviceId is required for Local System device proxy execution');
    }

    // Resolve the workspace scope the same way `remote-device` does, recovering
    // it from the running agent when the run-scoped `context.workspaceId` was
    // lost (see `resolveRunWorkspaceId`). Without this, a workspace device the
    // model just activated via listOnlineDevices would be addressed under the
    // personal principal and every filesystem/shell call against it would miss.
    // Resolved once, shared by every api call in this step.
    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const getDeviceWorkspaceId = () => (workspaceIdPromise ??= resolveRunWorkspaceId(context));

    const proxy: Record<string, (args: any) => Promise<any>> = {};

    for (const api of LocalSystemManifest.api) {
      const workingDirArg = WORKING_DIR_ARG[api.name];
      proxy[api.name] = async (args: any) => {
        // Inject the device-bound cwd/scope when the model didn't supply one.
        // `??=` leaves an explicit per-call override possible for the future.
        const finalArgs =
          workingDirArg && context.workingDirectory && args?.[workingDirArg] == null
            ? { ...args, [workingDirArg]: context.workingDirectory }
            : args;

        return deviceGateway.executeToolCall(
          {
            deviceId: context.activeDeviceId!,
            operationId: context.operationId,
            userId: context.userId!,
            // Workspace devices live under the `workspace:<id>` principal in
            // the gateway, so the relay needs the workspaceId to address the
            // right DO pool. Personal device runs resolve to undefined.
            workspaceId: await getDeviceWorkspaceId(),
          },
          {
            apiName: api.name,
            arguments: JSON.stringify(finalArgs),
            identifier: LocalSystemIdentifier,
          },
          context.executionTimeoutMs,
        );
      };
    }

    return proxy;
  },
  identifier: LocalSystemIdentifier,
};
