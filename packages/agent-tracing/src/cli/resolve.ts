import { loadSnapshot } from '../store/loadSnapshot';
import type { ExecutionSnapshot } from '../types';

/**
 * Resolve a single snapshot from a CLI target: a snapshot json path, an operation id
 * (local first, then the `_remote/` download cache), `latest`, or nothing (latest local).
 *
 * Thin wrapper over {@link loadSnapshot} kept for the read-only CLI commands, which
 * never download.
 */
export async function resolveSnapshot(target?: string): Promise<ExecutionSnapshot | undefined> {
  return loadSnapshot(target);
}
