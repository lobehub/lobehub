import type { ChildProcess } from 'node:child_process';

import type { GetCommandOutputParams, GetCommandOutputResult, KillCommandResult } from '../types';
import { truncateOutput } from './utils';

const DEFAULT_OBSERVATION_TIMEOUT_MS = 30_000;
const MAX_OBSERVATION_TIMEOUT_MS = 120_000;

export interface ShellProcess {
  exitCode: number | null;
  lastReadStderr: number;
  lastReadStdout: number;
  process: ChildProcess;
  stderr: string[];
  stdout: string[];
}

export class ShellProcessManager {
  private nextShellId = 1;

  private processes = new Map<string, ShellProcess>();

  createShellId(): string {
    return `sh-${this.nextShellId++}`;
  }

  register(shellId: string, shellProcess: ShellProcess): void {
    this.processes.set(shellId, shellProcess);
  }

  async getOutput({
    filter,
    shell_id,
    timeout,
  }: GetCommandOutputParams): Promise<GetCommandOutputResult> {
    const shellProcess = this.processes.get(shell_id);
    if (!shellProcess) {
      return {
        error: `Shell ID ${shell_id} not found`,
        output: '',
        stderr: '',
        stdout: '',
        success: false,
      };
    }

    const { lastReadStderr, lastReadStdout, process: childProcess, stderr, stdout } = shellProcess;

    let exitCode = childProcess.exitCode ?? shellProcess.exitCode;
    if (exitCode === null) {
      const waitTimeout =
        typeof timeout === 'number' && Number.isFinite(timeout)
          ? Math.min(Math.max(Math.trunc(timeout), 0), MAX_OBSERVATION_TIMEOUT_MS)
          : DEFAULT_OBSERVATION_TIMEOUT_MS;

      if (waitTimeout > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onError: (() => void) | undefined;
        let onExit: (() => void) | undefined;

        try {
          await Promise.race([
            new Promise<void>((resolve) => {
              onError = resolve;
              childProcess.once('error', onError);
            }),
            new Promise<void>((resolve) => {
              onExit = resolve;
              childProcess.once('exit', onExit);
            }),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, waitTimeout);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          if (onError) childProcess.off('error', onError);
          if (onExit) childProcess.off('exit', onExit);
        }
      }
    }

    exitCode = childProcess.exitCode ?? shellProcess.exitCode;

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

    return {
      exit_code: exitCode ?? undefined,
      output: truncateOutput(output),
      stderr: truncateOutput(newStderr),
      stdout: truncateOutput(newStdout),
      success: true,
    };
  }

  kill(shell_id: string): KillCommandResult {
    const shellProcess = this.processes.get(shell_id);
    if (!shellProcess) {
      return { error: `Shell ID ${shell_id} not found`, success: false };
    }

    try {
      shellProcess.process.kill();
      this.processes.delete(shell_id);
      return { success: true };
    } catch (error) {
      return { error: (error as Error).message, success: false };
    }
  }

  cleanupAll(): void {
    for (const [id, sp] of this.processes) {
      try {
        sp.process.kill();
      } catch {
        // Ignore
      }
      this.processes.delete(id);
    }
  }
}
