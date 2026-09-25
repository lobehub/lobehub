import type { ChildProcess } from 'node:child_process';
import { spawn as spawnChildProcess } from 'node:child_process';

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

  spawn(
    { cmd, args }: ShellLaunchCommand,
    { cwd, env, outputFiles, shellId }: ShellSpawnOptions,
  ): ShellHandle {
    const childProcess = spawnChildProcess(cmd, args, {
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
  }
}
