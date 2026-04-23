import { spawn } from 'node:child_process';

/**
 * Signal the whole process tree rooted at `pid`.
 *
 * Unix: the caller should have spawned with `detached: true` so a pgid exists.
 * We send the signal to `-pid` which reaches every descendant in the group.
 * Falls back to a direct signal if the group kill raises (ESRCH when the
 * leader already exited).
 *
 * Windows: shell out to `taskkill /T /F` which walks the descendant tree.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already exited
    }
  }
}
