import { spawn } from 'node:child_process';

import type { RunCommandParams, RunCommandResult } from '../types';
import type { ShellProcess, ShellProcessManager } from './process-manager';
import { getShellConfig } from './utils';

export interface RunCommandOptions {
  logger?: {
    debug: (...args: any[]) => void;
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
  };
  processManager: ShellProcessManager;
}

export async function runCommand(
  {
    command,
    cwd,
    description,
    env: extraEnv,
    run_in_background,
    timeout = 30_000,
  }: RunCommandParams,
  { processManager, logger }: RunCommandOptions,
): Promise<RunCommandResult> {
  if (!command) {
    return { error: 'command is required', success: false };
  }

  const logPrefix = `[runCommand: ${description || command.slice(0, 50)}]`;
  logger?.debug(`${logPrefix} Starting`, { background: run_in_background, cwd, timeout });

  const shellConfig = getShellConfig(command);
  const childEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env;

  try {
    const shellId = processManager.createShellId();
    const childProcess = spawn(shellConfig.cmd, shellConfig.args, {
      cwd,
      env: childEnv,
      shell: false,
    });

    const shellProcess: ShellProcess = {
      exitCode: null,
      lastReadStderr: 0,
      lastReadStdout: 0,
      process: childProcess,
      stderr: [],
      stdout: [],
    };

    childProcess.stdout?.on('data', (data) => {
      shellProcess.stdout.push(data.toString());
    });

    childProcess.stderr?.on('data', (data) => {
      shellProcess.stderr.push(data.toString());
    });

    childProcess.on('exit', (code) => {
      logger?.debug(`${logPrefix} Process exited`, { code, shellId });
      shellProcess.exitCode = code ?? 0;
    });

    childProcess.on('error', (error) => {
      logger?.error(`${logPrefix} Command failed:`, error);
      shellProcess.stderr.push(error.message);
      shellProcess.exitCode = 1;
    });

    processManager.register(shellId, shellProcess);
    logger?.info?.(`${logPrefix} Started session`, { background: run_in_background, shellId });

    if (run_in_background) {
      return { shell_id: shellId, success: true };
    }

    const observation = await processManager.getOutput({
      shell_id: shellId,
      timeout,
    });

    return {
      ...observation,
      shell_id: shellId,
    };
  } catch (error) {
    return { error: (error as Error).message, success: false };
  }
}
