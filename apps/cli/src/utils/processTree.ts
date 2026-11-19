import { execFileSync, spawn } from 'node:child_process';

/** Parse `ps -A -o pid=,ppid=` output into the descendants of `rootPid`, nearest first. */
export const parseDescendantPids = (psOutput: string, rootPid: number): number[] => {
  const childrenOf = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const siblings = childrenOf.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(ppid, [pid]);
  }

  const descendants: number[] = [];
  const visited = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.shift()!) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
};

/**
 * Force-kill a process and everything it started.
 *
 * Windows: `taskkill /T /F` walks the tree. POSIX: the descendants are listed
 * BEFORE the root dies (an orphan is re-parented and no longer findable), then
 * every one is sent SIGKILL. A process group signal would not do here: inside
 * an inherited wrapper group it would kill the wrapper that still has to
 * report the failure.
 */
export const forceKillProcessTree = (
  pid: number,
  {
    platform = process.platform,
    listPs = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }),
  }: { listPs?: () => string; platform?: NodeJS.Platform } = {},
): void => {
  if (platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {});
    } catch {
      // taskkill unavailable; the caller's direct kill is the fallback
    }
    return;
  }

  let descendants: number[] = [];
  try {
    descendants = parseDescendantPids(listPs(), pid);
  } catch {
    // `ps` unavailable: the root kill below is all we can do
  }
  for (const target of [pid, ...descendants]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // already gone
    }
  }
};
