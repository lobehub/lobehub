import type { ChildProcess } from 'node:child_process';
import { spawn as spawnChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import treeKill from 'tree-kill';

import type {
  ShellBackend,
  ShellBackendCapabilities,
  ShellHandle,
  ShellLaunchCommand,
  ShellSpawnOptions,
} from './backend';

const KILL_SIGNAL: NodeJS.Signals = 'SIGKILL';

/**
 * Non-interactive backend: a plain `child_process` with stdin left as an
 * unused pipe and stdout/stderr inherited straight into the output files.
 */
export class ChildProcessBackend implements ShellBackend {
  readonly capabilities: ShellBackendCapabilities = {
    interactive: false,
    persistent: false,
    streaming: false,
  };

  readonly name = 'child-process';

  private processes = new Map<string, ChildProcess>();
  private exited = new Set<string>();

  private groupExited(child: ChildProcess): boolean {
    if (!child.pid) return child.exitCode !== null || child.signalCode !== null;
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }

  /**
   * @param spawnProcess - spawn implementation; a caller can pass one that
   *   registers each process with a tracker. Defaults to `child_process.spawn`.
   */
  constructor(private readonly spawnProcess: typeof spawnChildProcess = spawnChildProcess) {}

  spawn(
    { cmd, args }: ShellLaunchCommand,
    { cwd, env, outputFiles, shellId }: ShellSpawnOptions,
  ): ShellHandle {
    const childProcess = this.spawnProcess(cmd, args, {
      cwd,
      detached: process.platform !== 'win32',
      env: env as NodeJS.ProcessEnv,
      shell: false,
      stdio: ['pipe', outputFiles.stdout.fd, outputFiles.stderr.fd],
      // The Electron main process is a GUI process without a console, so on
      // Windows spawning a console program (powershell.exe / cmd.exe) allocates
      // a new console window that flashes up for every command. windowsHide
      // defaults to false in Node, so it must be set explicitly.
      windowsHide: true,
    });
    this.processes.set(shellId, childProcess);
    childProcess.once('close', () => {
      // POSIX can probe the whole group after the parent exits. Windows cannot
      // infer descendant exit from the parent alone; require taskkill's acknowledgement.
      if (process.platform !== 'win32' && this.groupExited(childProcess)) this.exited.add(shellId);
    });

    return childProcess;
  }

  kill(shellId: string): void {
    const childProcess = this.processes.get(shellId);
    if (!childProcess) throw new Error(`Shell ID ${shellId} not found`);

    if (childProcess.pid) {
      treeKill(childProcess.pid, KILL_SIGNAL);
      return;
    }

    childProcess.kill(KILL_SIGNAL);
  }

  release(shellId: string): void {
    this.processes.delete(shellId);
    this.exited.delete(shellId);
  }

  async terminate(shellId: string): Promise<boolean> {
    if (this.exited.has(shellId)) return true;
    const child = this.processes.get(shellId);
    if (!child) return false;
    if (process.platform === 'win32') {
      // A missing parent alone cannot prove that its descendants have exited.
      if (!child.pid || this.groupExited(child)) return false;
      const killed = await new Promise<boolean>((resolve) =>
        treeKill(child.pid!, KILL_SIGNAL, (error) => resolve(!error)),
      );
      if (!killed) return false;
    } else {
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        if (this.groupExited(child)) break;
        if (!child.pid) return false;
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
        const deadline = Date.now() + 1000;
        while (!this.groupExited(child) && Date.now() < deadline) await delay(25);
      }
    }
    if (!this.groupExited(child)) return false;
    this.exited.add(shellId);
    return true;
  }
}
