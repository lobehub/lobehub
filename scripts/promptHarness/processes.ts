import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export interface ManagedProcess {
  child: ChildProcess;
  name: string;
  pid: number;
}

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

export const spawnManaged = ({
  args,
  command,
  cwd,
  env,
  logPath,
  name,
}: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
  name: string;
}): ManagedProcess => {
  const log = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.once('exit', () => log.end());

  if (!child.pid) throw new Error(`Failed to start ${name}.`);
  return { child, name, pid: child.pid };
};

const signalGroup = (process: ManagedProcess, signal: NodeJS.Signals) => {
  try {
    process.kill(-process.pid, signal);
  } catch {
    try {
      process.child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
};

export const stopManaged = async (
  process: ManagedProcess,
  { graceMs = 5_000 }: { graceMs?: number } = {},
): Promise<void> => {
  signalGroup(process, 'SIGTERM');
  if (await waitForExit(process.child, graceMs)) return;
  signalGroup(process, 'SIGKILL');
  await waitForExit(process.child, 2_000);
};

export const stopAll = async (processes: readonly ManagedProcess[]): Promise<void> => {
  await Promise.allSettled(processes.map((process) => stopManaged(process)));
};
