import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';

import { deviceGateway } from '@/server/services/deviceGateway';
import { buildDeviceLhEnv } from '@/server/services/toolExecution/preprocessLhCommand';

import { resolveContentWorkspaceId, resolveRunWorkspaceId } from './resolveWorkspaceScope';
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

    // Content scope — which workspace's data a command operates on — is a
    // different question from which gateway pool addresses the device, so it
    // must NOT reuse `getDeviceWorkspaceId` (that one intentionally returns
    // undefined for a personal-scope device).
    let contentWorkspaceIdPromise: Promise<string | undefined> | undefined;
    const getContentWorkspaceId = () =>
      (contentWorkspaceIdPromise ??= resolveContentWorkspaceId(context));

    const proxy: Record<string, (args: any) => Promise<any>> = {};

    for (const api of LocalSystemManifest.api) {
      const workingDirArg = WORKING_DIR_ARG[api.name];
      proxy[api.name] = async (args: any) => {
        // Inject the device-bound cwd/scope when the model didn't supply one
        // or explicitly passed `.` (a relative reference that resolves to
        // process.cwd() on the device side — the LobeHub install directory on
        // packaged desktop instead of the user's actual workspace).
        //
        // `cwd` and `scope` differ in how much the model is trusted:
        // - `scope` IS a manifest field (the model may legitimately point a
        //   search at a subdirectory), and the out-of-scope intervention audit
        //   inspects it. Only fill it in when absent/`.`.
        // - `cwd` is NOT in the manifest for ANY api — the model can never
        //   legitimately set it, and the audit does not inspect it. So it is
        //   stripped from every call before dispatch, and re-added only for the
        //   apis that consume it, with the device-bound value.
        //
        // Stripping has to be unconditional, not limited to the `cwd`-arg apis:
        // downstream, `cwd` also acts as a legacy search-root alias and as the
        // base a relative `scope` resolves against. Left in place on a search
        // call, `globFiles({ pattern: 'passwd', scope: 'etc', cwd: '/' })` would
        // be approved by the audit as a workspace-relative `scope` and then
        // execute against `/etc`. Likewise `readFile({ path: 'passwd', cwd:
        // '/etc' })` — only `path` is audited, and it looks workspace-relative.
        const { cwd: _offContractCwd, ...sanitized } = (args ?? {}) as Record<string, unknown>;
        let finalArgs = sanitized as typeof args;
        if (workingDirArg && context.workingDirectory) {
          const scopeValue: unknown = finalArgs?.[workingDirArg];
          // `cwd` was just stripped, so a `cwd`-arg api always needs it back.
          const needsInjection =
            workingDirArg === 'cwd' || scopeValue == null || scopeValue === '.';
          if (needsInjection) {
            finalArgs = { ...finalArgs, [workingDirArg]: context.workingDirectory };
          }
        }

        // A device shell has its own `lh`, so nothing is rewritten — but the
        // CLI would resolve to the device credentials' PERSONAL scope, which is
        // how a workspace agent ends up unable to find (or edit) itself. Set on
        // every command, so an `lh` reached indirectly (`bash -lc 'lh …'`, a
        // script, a Makefile) inherits the scope too. The model's own `env`
        // wins: it may be deliberately overriding the scope.
        if (api.name === LocalSystemApiName.runCommand && typeof finalArgs?.command === 'string') {
          const lhEnv = buildDeviceLhEnv(await getContentWorkspaceId());
          if (lhEnv) finalArgs = { ...finalArgs, env: { ...lhEnv, ...finalArgs.env } };

          // The sandbox decision belongs to the run's owner, not to the model:
          // it is set here from the resolved execution context, overriding
          // anything that arrived in the LLM args (the manifest doesn't expose
          // the field, but a model that guessed it must not be able to switch
          // its own fence off — or on).
          if (context.localSandbox !== undefined) {
            finalArgs = {
              ...finalArgs,
              sandbox: context.localSandbox,
              // Only meaningful for a fenced run, so don't add noise to the
              // args of an unfenced one.
              ...(context.localSandbox
                ? { sandboxNetwork: context.localSandboxNetwork === true }
                : {}),
            };
          }
        }

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
