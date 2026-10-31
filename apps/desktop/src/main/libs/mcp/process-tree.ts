import { type ChildProcess, execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** execFile with a narrowed promise shape (the (file, args[, options]) overload only). */
const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Max descendant pids listed per direct taskkill invocation. */
const TASKKILL_BATCH_SIZE = 20;

/** One CIM snapshot query returns every process id with its parent id. */
const WINDOWS_PROCESS_SNAPSHOT_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
];

type WindowsProcessRow = { ProcessId: number; ParentProcessId: number };

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but we cannot probe it — treat as alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Enumerate the descendant pids of `rootPid` from a single CIM snapshot
 * (one PowerShell round trip) and a BFS over the parent→children map. The
 * visited set keeps self-referencing rows from looping the walk. Returns []
 * when the snapshot is unavailable (CIM service down, malformed output), so
 * callers degrade to the pre-existing behavior instead of throwing.
 */
const collectWindowsDescendantPids = async (rootPid: number): Promise<number[]> => {
  let rows: WindowsProcessRow[];
  try {
    const { stdout } = await execFileAsync('powershell', [...WINDOWS_PROCESS_SNAPSHOT_ARGS], {
      timeout: 5_000,
    });
    const parsed = JSON.parse(stdout) as WindowsProcessRow | WindowsProcessRow[];
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  const childrenOf = new Map<number, number[]>();
  for (const row of rows) {
    if (typeof row?.ProcessId !== 'number' || typeof row?.ParentProcessId !== 'number') continue;
    const siblings = childrenOf.get(row.ParentProcessId);
    if (siblings) siblings.push(row.ProcessId);
    else childrenOf.set(row.ParentProcessId, [row.ProcessId]);
  }

  const descendants: number[] = [];
  const visited = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift();
    if (parent === undefined) break;
    for (const child of childrenOf.get(parent) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
};

const killWindowsDescendants = async (descendantPids: number[]): Promise<void> => {
  for (let i = 0; i < descendantPids.length; i += TASKKILL_BATCH_SIZE) {
    const batch = descendantPids.slice(i, i + TASKKILL_BATCH_SIZE);
    const args = batch.flatMap((pid) => ['/pid', String(pid)]);
    args.push('/F');
    try {
      await execFileAsync('taskkill', args);
    } catch {
      // already exited between the snapshot and the kill
    }
  }
};

/**
 * Windows fallback for the launcher pre-exit gap (P2 4307489808): `taskkill
 * /T` walks the tree from the given pid, so it cannot recover descendants
 * whose root (the launcher) has already exited — the swallowed failure
 * would leak the worker across reconnects. Probe whether any descendant
 * survived the failed root kill and force-terminate them directly.
 */
const killSurvivingWindowsDescendants = async (rootPid: number): Promise<void> => {
  const descendants = await collectWindowsDescendantPids(rootPid);
  const survivors = descendants.filter(isPidAlive);
  if (survivors.length === 0) return;
  await killWindowsDescendants(survivors);
};

/**
 * Signal a pre-check child and its whole process tree.
 *
 * A configured command can be a launcher (`.cmd` shim, wrapper script,
 * `npx`, ...) that spawns a persistent MCP worker as a separate process.
 * Signaling only the direct child PID leaves that worker orphaned — the
 * launcher exits, `settle` reports cleanup done, and every repeated failed
 * connection accumulates another live MCP server. On POSIX the pre-check
 * child is spawned `detached`, making it a process-group leader, so a
 * negative PID signals the whole group in one call. Windows has no process
 * groups, so `taskkill /T /F` walks and force-kills the tree instead. The
 * direct-kill fallback keeps this correct for mocked children in tests and
 * for detached=false callers.
 */
export async function signalProcessTree(
  child: Pick<ChildProcess, 'kill' | 'pid'>,
  signal: NodeJS.Signals,
  options: { retryDelayMs?: number } = {},
): Promise<void> {
  const { retryDelayMs = 100 } = options;

  if (child.pid === undefined) {
    // Never spawned (or already reaped) — the direct kill keeps mocked
    // children in unit tests working without a real pid.
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
    return;
  }

  const pid = child.pid;

  if (process.platform === 'win32') {
    // Windows: /T walks the child tree, /F force-terminates. taskkill can
    // exit nonzero when the tree already exited — not an error for us.
    try {
      await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F']);
      return;
    } catch {
      // The tree may already be gone — but a launcher that exited BEFORE
      // this call leaves /T nothing to walk (its descendants are no longer
      // its children), so probe for surviving descendants directly
      // (P2 4307489808) instead of swallowing the failure.
    }
    await killSurvivingWindowsDescendants(pid);
    return;
  }

  // POSIX: the child is spawned detached → it leads its own process group,
  // so -pid signals every member (launcher + worker descendants) atomically.
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: group already gone — fall through to the direct child kill.
  }

  // Belt-and-braces: if the group signal raced with an exit and the direct
  // child somehow survived (group leader replaced / signal delivered between
  // membership checks), ensure it gets the signal directly.
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  try {
    child.kill(signal);
  } catch {
    // already dead
  }
}

/**
 * After the pre-check child exits on its own (launcher self-exit path),
 * the launcher's descendants can still be alive in the process group —
 * repeated failed connections would accumulate one orphaned MCP worker
 * each time. Probe the group for survivors and SIGKILL them.
 *
 * Runs detached in the background (not awaited): the pre-check promise
 * must not wait on cleanup, and a failed probe is a no-op. A daemonized
 * (setsid) server deliberately leaves its group; killing it would be
 * surprising behavior, so survivors there are logged and left alone.
 */
export function reapOrphanedProcessGroup(
  pid: number,
  signal: NodeJS.Signals = 'SIGKILL',
  options: { recheckDelayMs?: number } = {},
): void {
  const { recheckDelayMs = 500 } = options;

  if (process.platform === 'win32') {
    // No POSIX process groups on Windows; the zero-code classification path
    // here is best-effort cleanup. A launcher that exited before this call
    // leaves /T nothing to walk (its descendants are no longer its children),
    // so after the root kill, probe for surviving descendants directly
    // (P2 4307489808). Detached best-effort sweep — this function is
    // intentionally not awaited.
    void (async () => {
      try {
        await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F']);
      } catch {
        // root already gone or tree already exited
      }
      await killSurvivingWindowsDescendants(pid);
    })();
    return;
  }

  const killGroup = (groupSignal: NodeJS.Signals): boolean => {
    try {
      process.kill(-pid, groupSignal);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // EPERM means the group exists but we lack permission (e.g. a
      // setsid daemon whose group we cannot signal) — report and leave.
      // ESRCH means the group is already gone — normal case.
      if (err.code === 'EPERM') {
        console.warn(
          `[mcp-precheck] orphaned process group -${pid} survives (EPERM, possibly setsid daemon); leaving it alone`,
        );
      }
      return false;
    }
  };

  if (!killGroup(signal)) return;

  // Re-check after a grace period: a signal can be delivered while a
  // descendant is between fork and signal-handler install. A second kill of
  // the same group is a no-op if everything died.
  setTimeout(() => {
    killGroup(signal);
  }, recheckDelayMs);
}

/**
 * Tear down a pre-check child that outlived its 5s window. The whole
 * process tree is signaled (see `signalProcessTree` — POSIX process-group
 * signal or Windows `taskkill /T`), escalating from SIGTERM to SIGKILL
 * after a short grace period, and settling once the exit event confirms
 * the process is gone (with a hard fallback so the pre-check promise can
 * never hang). The SIGKILL escalation is NOT cancelled by the launcher's
 * exit (P2 4306440127): a launcher that dies on the group SIGTERM while a
 * worker descendant ignores the signal would otherwise settle the teardown
 * and leak that worker across repeated failed connections. When the group
 * is already gone the escalation is a harmless ESRCH no-op. Without the
 * exit confirmation a server that ignores SIGTERM would survive with its
 * pipe listeners attached, leaking processes across repeated failed
 * connections.
 */
export function terminatePrecheckProcess(
  child: ChildProcess,
  onSettled: () => void,
  options: { fallbackMs?: number; graceMs?: number } = {},
): void {
  const { fallbackMs = 1500, graceMs = 500 } = options;

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(fallbackTimer);
    onSettled();
  };

  // The SIGKILL escalation is intentionally NOT tracked/cancelled: settle()
  // fires when the launcher exits, but a worker descendant may ignore the
  // group SIGTERM — the escalation must still land to kill the group
  // (P2 4306440127). When everything already exited it is an ESRCH no-op.
  setTimeout(() => {
    void signalProcessTree(child, 'SIGKILL');
  }, graceMs);

  const fallbackTimer = setTimeout(settle, fallbackMs);

  child.once('exit', settle);
  void signalProcessTree(child, 'SIGTERM');
}
