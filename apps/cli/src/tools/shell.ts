import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { log } from '../utils/logger';

// Maximum output length to prevent context explosion
const MAX_OUTPUT_LENGTH = 80_000;

const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /\u001B(?:[\u0040-\u005A\u005C-\u005F]|\[[\u0030-\u003F]*[\u0020-\u002F]*[\u0040-\u007E])/g;
const stripAnsi = (str: string): string => str.replaceAll(ANSI_REGEX, '');

const truncateOutput = (str: string, maxLength: number = MAX_OUTPUT_LENGTH): string => {
  const cleaned = stripAnsi(str);
  if (cleaned.length <= maxLength) return cleaned;
  return (
    cleaned.slice(0, maxLength) +
    '\n... [truncated, ' +
    (cleaned.length - maxLength) +
    ' more characters]'
  );
};

interface ShellProcess {
  lastReadStderr: number;
  lastReadStdout: number;
  process: ChildProcess;
  stderr: string[];
  stdout: string[];
}

const shellProcesses = new Map<string, ShellProcess>();

export function cleanupAllProcesses() {
  for (const [id, sp] of shellProcesses) {
    try {
      sp.process.kill();
    } catch {
      // Ignore
    }
    shellProcesses.delete(id);
  }
}

// ─── runCommand ───

interface RunCommandParams {
  command: string;
  description?: string;
  run_in_background?: boolean;
  timeout?: number;
}

export async function runCommand({
  command,
  description,
  run_in_background,
  timeout = 120_000,
}: RunCommandParams) {
  const logPrefix = `[runCommand: ${description || command.slice(0, 50)}]`;
  log.debug(`${logPrefix} Starting`, { background: run_in_background, timeout });

  const effectiveTimeout = Math.min(Math.max(timeout, 1000), 600_000);

  const shellConfig =
    process.platform === 'win32'
      ? { args: ['/c', command], cmd: 'cmd.exe' }
      : { args: ['-c', command], cmd: '/bin/sh' };

  try {
    if (run_in_background) {
      const shellId = randomUUID();
      const childProcess = spawn(shellConfig.cmd, shellConfig.args, {
        env: process.env,
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
        log.debug(`${logPrefix} Background process exited`, { code, shellId });
      });

      shellProcesses.set(shellId, shellProcess);

      log.debug(`${logPrefix} Started background`, { shellId });
      return { shell_id: shellId, success: true };
    } else {
      return new Promise<any>((resolve) => {
        const childProcess = spawn(shellConfig.cmd, shellConfig.args, {
          env: process.env,
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

// ─── getCommandOutput ───

interface GetCommandOutputParams {
  filter?: string;
  shell_id: string;
}

export async function getCommandOutput({ shell_id, filter }: GetCommandOutputParams) {
  const shellProcess = shellProcesses.get(shell_id);
  if (!shellProcess) {
    return {
      error: `Shell ID ${shell_id} not found`,
      output: '',
      running: false,
      stderr: '',
      stdout: '',
      success: false,
    };
  }

  const { lastReadStderr, lastReadStdout, process: childProcess, stderr, stdout } = shellProcess;

  const newStdout = stdout.slice(lastReadStdout).join('');
  const newStderr = stderr.slice(lastReadStderr).join('');
  let output = newStdout + newStderr;

  if (filter) {
    try {
      const regex = new RegExp(filter, 'gm');
      const lines = output.split('\n');
      output = lines.filter((line) => regex.test(line)).join('\n');
    } catch {
      // Invalid filter regex, use unfiltered output
    }
  }

  shellProcess.lastReadStdout = stdout.length;
  shellProcess.lastReadStderr = stderr.length;

  const running = childProcess.exitCode === null;

  return {
    output: truncateOutput(output),
    running,
    stderr: truncateOutput(newStderr),
    stdout: truncateOutput(newStdout),
    success: true,
  };
}

// ─── killCommand ───

interface KillCommandParams {
  shell_id: string;
}

export async function killCommand({ shell_id }: KillCommandParams) {
  const shellProcess = shellProcesses.get(shell_id);
  if (!shellProcess) {
    return { error: `Shell ID ${shell_id} not found`, success: false };
  }

  try {
    shellProcess.process.kill();
    shellProcesses.delete(shell_id);
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message, success: false };
  }
}
