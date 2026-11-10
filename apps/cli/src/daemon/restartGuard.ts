import { x } from 'tinyexec';

const INSPECTION_ERROR =
  'Could not verify whether this command is running inside the daemon. No connector was stopped. Retry from a local terminal or SSH session.';

/** A caller killed by daemon cleanup cannot finish waiting and launch its replacement. */
export async function assertExternalDaemonRestart(daemonPid: number): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await x('ps', ['-axo', 'pid=,ppid='], {
      nodePath: false,
      throwOnError: true,
      timeout: 2000,
    }));
  } catch {
    throw new Error(INSPECTION_ERROR);
  }

  // Read only process relationships, never argv or environment (which may contain credentials).
  const parents = new Map<number, number>();
  for (const line of stdout.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) throw new Error(INSPECTION_ERROR);
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parent)) {
      throw new Error(INSPECTION_ERROR);
    }
    parents.set(pid, parent);
  }

  const visited = new Set<number>();
  let current = process.pid;
  while (current > 0) {
    if (current === daemonPid) {
      throw new Error(
        'Cannot restart this daemon from its own terminal or shell. No connector was stopped. Run lh connect restart from a local terminal or SSH session instead.',
      );
    }
    if (current === 1) return;
    const parent = parents.get(current);
    if (parent === undefined || visited.has(current)) throw new Error(INSPECTION_ERROR);
    visited.add(current);
    current = parent;
  }
}
