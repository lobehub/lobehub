import { spawn } from 'node:child_process';
import fs from 'node:fs';

import type { SandboxPolicy } from '@lobechat/device-sandbox';

import type { RunCommandParams, RunCommandResult } from '../types';
import type { ShellOutputFiles, ShellProcess, ShellProcessManager } from './process-manager';
import { DEFAULT_OBSERVATION_TIMEOUT_MS } from './process-manager';
import {
  detectWindowsShell,
  getShellConfig,
  markWindowsShellUnhealthy,
  normalizeEnvVarRefs,
} from './utils';

export interface RunCommandOptions {
  logger?: {
    debug: (...args: any[]) => void;
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
  };
  /**
   * The sandbox could not be established for this command (unsupported host,
   * missing dependency, a runtime that refused the policy). Fired only for
   * failures raised while building the launch plan — never for a command that
   * ran sandboxed and exited non-zero.
   *
   * Exists because the cheap capability probe is not the whole truth: the
   * backend can report itself available and still fail when the first real
   * process is spawned (the egress fence is only verified then). Callers use
   * this to downgrade what they advertise instead of offering an environment
   * that fails on every command.
   */
  onSandboxUnavailable?: (error: Error) => void;
  processManager: ShellProcessManager;
  sandboxPolicy?: SandboxPolicy;
  /** @internal Prevents a launch fallback from recursively retrying forever. */
  shellFallbackAttempted?: boolean;
}

const WINDOWS_DLL_INIT_FAILED = 0xc000_0142;

const isWindowsShellSpawnFailure = (result: RunCommandResult): boolean =>
  result.error !== undefined && /\b(?:EACCES|ENOENT)\b/.test(result.error);

export async function runCommand(
  {
    command,
    cwd,
    description,
    env: extraEnv,
    run_in_background,
    timeout = DEFAULT_OBSERVATION_TIMEOUT_MS,
  }: RunCommandParams,
  {
    processManager,
    logger,
    onSandboxUnavailable,
    sandboxPolicy,
    shellFallbackAttempted = false,
  }: RunCommandOptions,
): Promise<RunCommandResult> {
  if (!command) {
    return { error: 'command is required', success: false };
  }

  // Node reports a missing working directory as a spawn ENOENT for the shell
  // executable, which sends users looking for a PowerShell installation issue
  // that does not exist. Fail before shell detection with the actual cause.
  if (cwd) {
    try {
      const cwdStat = await fs.promises.stat(cwd);
      if (!cwdStat.isDirectory()) {
        return { error: `Working directory is not a directory: ${cwd}`, success: false };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const suffix = code ? ` (${code})` : '';
      return { error: `Working directory is not accessible: ${cwd}${suffix}`, success: false };
    }
  }

  const logPrefix = `[runCommand: ${description || command.slice(0, 50)}]`;
  logger?.debug(`${logPrefix} Starting`, { background: run_in_background, cwd, timeout });

  const requestedEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env;

  // On Windows, rewrite env-var references the target shell cannot resolve
  // natively into its own syntax (see normalizeEnvVarRefs), so a command
  // authored in another shell dialect still resolves against the actual env.
  // We do NOT rewrite on macOS/Linux: /bin/sh handles its own variable syntax,
  // and rewriting here would break shell-local variables (e.g. `for x; do echo $x`).
  const effectiveCommand =
    process.platform === 'win32'
      ? normalizeEnvVarRefs(command, requestedEnv, (await detectWindowsShell()).type)
      : command;
  const shellConfig = await getShellConfig(effectiveCommand);
  let outputFiles: ShellOutputFiles | undefined;
  let releaseSandbox: (() => void) | undefined;
  // What actually happened, reported back so nothing downstream has to infer a
  // security property from the request that asked for it.
  let sandboxed: boolean | undefined;

  try {
    let launchCommand = shellConfig;
    let launchEnv: NodeJS.ProcessEnv = requestedEnv;

    // The device sandbox is an opt-in PoC. Keep the existing runner path untouched unless a caller
    // explicitly supplies a policy, and avoid loading the experimental runtime on the default path.
    if (sandboxPolicy) {
      const { createSandboxLaunchPlan } = await import('@lobechat/device-sandbox');
      // Narrow try/catch: only a failure to BUILD the sandbox counts as the
      // sandbox being unavailable. Everything after this — spawn errors, a
      // non-zero exit — is the command's own failure and must not make the
      // caller think the environment is broken.
      let launchPlan;
      try {
        launchPlan = await createSandboxLaunchPlan({
          command: shellConfig,
          cwd,
          env: requestedEnv,
          policy: sandboxPolicy,
        });
      } catch (error) {
        onSandboxUnavailable?.(error as Error);
        throw error;
      }
      launchCommand = launchPlan;
      launchEnv = launchPlan.env as NodeJS.ProcessEnv;
      releaseSandbox = launchPlan.release;
      sandboxed = launchPlan.sandboxed;
    }
    const shellId = processManager.createShellId();
    const shellOutputFiles = processManager.createOutputFiles(shellId);
    outputFiles = shellOutputFiles;
    const childProcess = spawn(launchCommand.cmd, launchCommand.args, {
      cwd,
      detached: process.platform !== 'win32',
      env: launchEnv,
      shell: false,
      stdio: ['pipe', shellOutputFiles.stdout.fd, shellOutputFiles.stderr.fd],
      // The Electron main process is a GUI process without a console, so on
      // Windows spawning a console program (powershell.exe / cmd.exe) allocates
      // a new console window that flashes up for every command. windowsHide
      // defaults to false in Node, so it must be set explicitly.
      windowsHide: true,
    });

    const shellProcess: ShellProcess = {
      exitCode: null,
      outputFiles: shellOutputFiles,
      process: childProcess,
    };

    childProcess.on('exit', (code) => {
      logger?.debug(`${logPrefix} Process exited`, { code, shellId });
      shellProcess.exitCode = code ?? 0;
    });

    childProcess.on('error', (error) => {
      logger?.error(`${logPrefix} Command failed:`, error);
      if (
        process.platform === 'win32' &&
        !sandboxPolicy &&
        /\b(?:EACCES|ENOENT)\b/.test(error.message)
      ) {
        markWindowsShellUnhealthy(shellConfig.cmd);
      }
      const cwdContext = cwd ? ` (working directory: ${cwd})` : '';
      shellProcess.spawnError = new Error(
        `Failed to start command${cwdContext}: ${error.message}`,
        {
          cause: error,
        },
      );
      shellProcess.exitCode = 1;
    });
    childProcess.once('close', () => releaseSandbox?.());

    processManager.register(shellId, shellProcess);
    // Close our fd copy only after error/close listeners are registered; spawn errors are asynchronous.
    processManager.closeOutputFiles(shellOutputFiles);
    logger?.info?.(`${logPrefix} Started session`, { background: run_in_background, shellId });

    if (run_in_background) {
      return {
        output: '',
        output_files: processManager.getOutputFilesInfo(shellOutputFiles),
        sandboxed,
        shell_id: shellId,
        success: true,
      };
    }

    const observation = await processManager.getRunCommandOutput({
      shell_id: shellId,
      timeout,
    });

    const result: RunCommandResult = {
      ...observation,
      sandboxed,
      shell_id: shellId,
    };

    // A stale Store alias or removed PowerShell installation fails at spawn, so
    // the user script definitely did not start. Quarantine that executable and
    // retry exactly once with the next shell in the detection chain.
    if (
      process.platform === 'win32' &&
      !run_in_background &&
      !sandboxPolicy &&
      !shellFallbackAttempted &&
      isWindowsShellSpawnFailure(result)
    ) {
      markWindowsShellUnhealthy(shellConfig.cmd);
      logger?.info?.(`${logPrefix} Retrying with the next available Windows shell`, {
        failedShell: shellConfig.cmd,
      });
      return runCommand(
        { command, cwd, description, env: extraEnv, run_in_background, timeout },
        {
          logger,
          onSandboxUnavailable,
          processManager,
          sandboxPolicy,
          shellFallbackAttempted: true,
        },
      );
    }

    // 0xC0000142 normally means PowerShell itself could not initialise its
    // DLLs. Do not replay the current command, though: a user program can also
    // return that native status after earlier statements produced side effects.
    // Quarantining the shell makes the *next* agent retry use the fallback.
    if (
      process.platform === 'win32' &&
      !sandboxPolicy &&
      result.exit_code === WINDOWS_DLL_INIT_FAILED
    ) {
      markWindowsShellUnhealthy(shellConfig.cmd);
    }

    return result;
  } catch (error) {
    releaseSandbox?.();
    if (outputFiles) processManager.closeOutputFiles(outputFiles);
    return { error: (error as Error).message, success: false };
  }
}
