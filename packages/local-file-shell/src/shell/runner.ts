import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { RunCommandParams, RunCommandResult } from '../types';
import type { ShellProcess, ShellProcessManager } from './process-manager';
import { getShellConfig, truncateOutput } from './utils';

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
    timeout = 120_000,
  }: RunCommandParams,
  { processManager, logger }: RunCommandOptions,
): Promise<RunCommandResult> {
  const logPrefix = `[runCommand: ${description || command.slice(0, 50)}]`;
  logger?.debug(`${logPrefix} Starting`, { background: run_in_background, cwd, timeout });

  const effectiveTimeout = Math.min(Math.max(timeout, 1000), 600_000);
  const shellConfig = getShellConfig(command);
  const childEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env;

  try {
    if (run_in_background) {
      const shellId = randomUUID();
      const childProcess = spawn(shellConfig.cmd, shellConfig.args, {
        cwd,
        env: childEnv,
        shell: false,
      });

      const shellProcess: ShellProcess = {
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
        logger?.debug(`${logPrefix} Background process exited`, { code, shellId });
      });

      processManager.register(shellId, shellProcess);

      logger?.info?.(`${logPrefix} Started background`, { shellId });
      return { shell_id: shellId, success: true };
    } else {
      return new Promise<RunCommandResult>((resolve) => {
        const childProcess = spawn(shellConfig.cmd, shellConfig.args, {
          cwd,
          env: childEnv,
          shell: false,
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        const timeoutHandle = setTimeout(() => {
          killed = true;
          childProcess.kill();
          resolve({
            error: `Command timed out after ${effectiveTimeout}ms`,
            stderr: truncateOutput(stderr),
            stdout: truncateOutput(stdout),
            success: false,
          });
        }, effectiveTimeout);

        childProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        childProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        childProcess.on('exit', (code) => {
          if (!killed) {
            clearTimeout(timeoutHandle);
            const success = code === 0;
            logger?.info?.(`${logPrefix} Command completed`, { code, success });
            resolve({
              exit_code: code || 0,
              output: truncateOutput(stdout + stderr),
              stderr: truncateOutput(stderr),
              stdout: truncateOutput(stdout),
              success,
            });
          }
        });

        childProcess.on('error', (error) => {
          clearTimeout(timeoutHandle);
          logger?.error(`${logPrefix} Command failed:`, error);
          resolve({
            error: error.message,
            stderr: truncateOutput(stderr),
            stdout: truncateOutput(stdout),
            success: false,
          });
        });
      });
    }
  } catch (error) {
    return { error: (error as Error).message, success: false };
  }
}
