import type { ChildProcess } from 'node:child_process';

import type { GetCommandOutputParams, GetCommandOutputResult, KillCommandResult } from '../types';
import { truncateOutput } from './utils';

export interface ShellProcess {
  lastReadStderr: number;
  lastReadStdout: number;
  process: ChildProcess;
  stderr: string[];
  stdout: string[];
}

export class ShellProcessManager {
  private processes = new Map<string, ShellProcess>();

  register(shellId: string, shellProcess: ShellProcess): void {
    this.processes.set(shellId, shellProcess);
  }

  getOutput({ shell_id, filter }: GetCommandOutputParams): GetCommandOutputResult {
    const shellProcess = this.processes.get(shell_id);
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
