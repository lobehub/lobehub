import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';

import { deviceGateway } from '@/server/services/deviceGateway';

import { type ServerRuntimeRegistration } from './types';

/**
 * Which arg carries the working directory for the APIs that actually consume
 * one. The model never picks the working directory — the system prompt's
 * `{{workingDirectory}}` already tells it where it is, so file ops
 * (readFile/writeFile/editFile/moveFiles/listFiles) get absolute paths and need
 * nothing injected. Only two cases need a runtime-supplied default:
 *
 * - `runCommand`: the manifest deliberately hides `cwd`, but the daemon spawns
 *   in `params.cwd` (→ `process.cwd()` = `/` when omitted), so we must inject it.
 * - search ops (`searchFiles`/`globFiles`/`grepContent`): their manifest claims
 *   `scope` "defaults to the working directory", but the daemon falls back to
 *   `process.cwd()`. Inject `scope` so that promise holds and broad searches
 *   don't run from `/`.
 *
 * APIs that act on a command id (getCommandOutput / killCommand) take neither.
 */
const WORKING_DIR_ARG: Partial<Record<string, 'cwd' | 'scope'>> = {
  [LocalSystemApiName.globFiles]: 'scope',
  [LocalSystemApiName.grepContent]: 'scope',
  [LocalSystemApiName.runCommand]: 'cwd',
  [LocalSystemApiName.searchFiles]: 'scope',
};

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
