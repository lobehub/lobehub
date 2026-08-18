import { readFile } from 'node:fs/promises';

import { FileSnapshotStore } from '../store/file-store';
import { isOperationId, RemoteSnapshotStore } from '../store/remote-store';
import type { ExecutionSnapshot } from '../types';

/**
 * Resolve a single snapshot from a CLI target: a snapshot json path, an operation id
 * (local first, then the `_remote` download cache), `latest`, or nothing (latest local).
 */
export async function resolveSnapshot(target?: string): Promise<ExecutionSnapshot | undefined> {
  if (target?.endsWith('.json')) return JSON.parse(await readFile(target, 'utf8'));

  const local = await new FileSnapshotStore().get(target ?? 'latest');
  if (local) return local;

  if (target && isOperationId(target)) {
    return (await new RemoteSnapshotStore().getCached(target)) ?? undefined;
  }
  return undefined;
}
