import {
  type GetCommandOutputParams,
  type KillCommandParams,
  runCommand as runCommandCore,
  type RunCommandParams,
  type RunCommandResult,
  ShellProcessManager,
} from '@lobechat/local-file-shell';

import { resolveCommandMode, resolveSandboxNetwork } from '../settings';
import { decideSandbox } from '../settings/commandMode';
import {
  resolveExecutionPolicyOverlay,
  resolvePushedCommandMode,
} from '../settings/executionPolicy';
import { log } from '../utils/logger';
import { ensureSandboxWorkspace } from './sandboxWorkspace';
import { applySandboxHostPaths } from './srtWin';

const processManager = new ShellProcessManager();

export function cleanupAllProcesses() {
  processManager.cleanupAll();
}

/**
 * Probe once per process.
 *
 * Loading the sandbox backend is not free, and the answer cannot change while
 * the daemon runs — the things it checks (OS support, helper binary, sandbox
 * user, WFP filters) are provisioned out of band, and a connect restart is the
 * documented way to pick up a change.
 */
let sandboxCapability: Promise<{ available: boolean; reason?: string }> | undefined;

export const probeSandbox = () =>
  (sandboxCapability ??= (async () => {
    try {
      // Before the probe, not after: the probe's whole job is to answer whether
      // the helper is present, so it has to be told where this build put it.
      applySandboxHostPaths();
      const { probeSandboxCapability } = await import('@lobechat/device-sandbox');
      return await probeSandboxCapability();
    } catch (error) {
      // A probe that throws means "no sandbox here", not "crash the daemon".
      return { available: false, reason: (error as Error).message };
    }
  })());

/** Reset the memoised probe. Test seam only. */
export const resetSandboxCapabilityCache = () => {
  sandboxCapability = undefined;
};

/**
 * Run a command, fenced or not, according to the run's request and this
 * device's `command-mode`.
 *
 * The whole point of the ordering below is that there is no path from "a fence
 * was called for" to "ran without one". Every branch that cannot deliver the
 * fence returns an error instead: an unsupported host, a probe that failed, a
 * policy that could not be built. `createLocalSandboxPolicy` carries
 * `onUnavailable: 'deny'` for the same reason one layer further down.
 */
export async function runCommand(params: RunCommandParams): Promise<RunCommandResult> {
  const pushedCommandMode = await resolvePushedCommandMode();

  const decision = decideSandbox({
    deviceNetwork: resolveSandboxNetwork(),
    mode: resolveCommandMode(pushedCommandMode),
    requested: params.sandbox,
    requestedNetwork: params.sandboxNetwork,
  });

  if (decision.kind === 'refused') {
    return { error: decision.reason, success: false };
  }

  if (decision.kind === 'host') {
    return runCommandCore(params, { logger: log, processManager });
  }

  const capability = await probeSandbox();
  if (!capability.available) {
    // Named and actionable. The raw backend reason ("Sandbox Runtime
    // dependencies are unavailable: …") reads like a crash rather than "this
    // machine cannot do this", and the agent surfaces it verbatim to the user.
    return {
      error: `This device cannot run sandboxed commands: ${capability.reason ?? 'unsupported host'}. Run 'connect' again after provisioning the sandbox, or change this device's command mode.`,
      success: false,
    };
  }

  let cwd = params.cwd;
  if (!cwd) {
    try {
      cwd = ensureSandboxWorkspace();
      log.debug(`Sandboxed run has no working directory; using ${cwd}`);
    } catch (error) {
      return {
        error: `Could not prepare a sandbox working directory: ${(error as Error).message}`,
        success: false,
      };
    }
  }

  const { createLocalSandboxPolicy } = await import('@lobechat/device-sandbox');
  const overlay = await resolveExecutionPolicyOverlay();

  return runCommandCore(
    { ...params, cwd },
    {
      logger: log,
      processManager,
      sandboxPolicy: createLocalSandboxPolicy(cwd, {
        allowNetwork: decision.allowNetwork,
        overlay,
      }),
    },
  );
}

export async function getCommandOutput(params: GetCommandOutputParams) {
  return processManager.getOutput(params);
}

export async function killCommand(params: KillCommandParams) {
  return processManager.kill(params.shell_id);
}
