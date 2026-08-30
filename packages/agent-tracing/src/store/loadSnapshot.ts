import { readFile } from 'node:fs/promises';

import type { ExecutionSnapshot } from '../types';
import { FileSnapshotStore } from './file-store';
import { buildRemoteUrl, isOperationId, loadBaseUrl, RemoteSnapshotStore } from './remote-store';

export interface LoadSnapshotOptions {
  /**
   * Download the snapshot from `TRACING_BASE_URL` when the target is an
   * operation id that is neither recorded locally nor already in the
   * `_remote/` cache. Off by default so read-only callers never hit network.
   */
  allowDownload?: boolean;
  /**
   * Resolve the download URL for an operation id, instead of building one from
   * `TRACING_BASE_URL`. Lets an authenticated caller (`lh`) reach the object
   * through the LobeHub server — which knows the key from
   * `agent_operations.trace_s3_key` and signs it for the caller's own scope —
   * so no public bucket domain has to be configured. Returning `null` falls
   * back to `TRACING_BASE_URL`.
   */
  resolveDownloadUrl?: (operationId: string) => Promise<string | null>;
  /** Root that `.agent-tracing/` resolves against. Defaults to `process.cwd()`. */
  rootDir?: string;
}

export class AmbiguousSnapshotIdError extends Error {
  constructor(
    readonly prefix: string,
    readonly matches: string[],
  ) {
    super(
      `Ambiguous id prefix "${prefix}" — ${matches.length} cached snapshots match. ` +
        `Re-run with the full operation id.`,
    );
    this.name = 'AmbiguousSnapshotIdError';
  }
}

export class MissingTracingBaseUrlError extends Error {
  constructor(readonly operationId: string) {
    super(
      `Snapshot ${operationId} is not available locally and TRACING_BASE_URL is not configured.\n` +
        'Set it via:\n' +
        '  1. Environment variable: export TRACING_BASE_URL=https://<bucket-domain>/agent-traces\n' +
        '  2. File: .agent-tracing/.env with TRACING_BASE_URL=https://...',
    );
    this.name = 'MissingTracingBaseUrlError';
  }
}

const isUrl = (target: string) => target.startsWith('http://') || target.startsWith('https://');

/**
 * Resolve one snapshot from a CLI-style target, in the order callers expect:
 * a `.json` path, an http(s) URL, a full operation id (local store → `_remote/`
 * cache → optional download), an `op_` prefix matched against the cache, a
 * traceId, `latest`, or nothing (latest local).
 *
 * Shared by the `agent-tracing` CLI and by `lh trace`, which needs the same
 * resolution but reaches the model through the authenticated LobeHub server.
 */
export async function loadSnapshot(
  target?: string,
  options: LoadSnapshotOptions = {},
): Promise<ExecutionSnapshot | undefined> {
  const { allowDownload = false, resolveDownloadUrl, rootDir } = options;

  if (target?.endsWith('.json') && !isUrl(target)) {
    return JSON.parse(await readFile(target, 'utf8')) as ExecutionSnapshot;
  }

  if (target && isUrl(target)) {
    const res = await fetch(target);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch snapshot: ${res.status} ${res.statusText}\n  URL: ${target}`,
      );
    }
    return (await res.json()) as ExecutionSnapshot;
  }

  const local = await new FileSnapshotStore(rootDir).get(target ?? 'latest');
  if (local) return local;

  if (!target) return undefined;

  const remote = new RemoteSnapshotStore(rootDir);

  if (isOperationId(target)) {
    const cached = await remote.getCached(target);
    if (cached) return cached;

    if (!allowDownload) return undefined;

    const signedUrl = await resolveDownloadUrl?.(target);
    if (signedUrl) return remote.fetch(signedUrl, target);

    const baseUrl = await loadBaseUrl(rootDir);
    if (!baseUrl) throw new MissingTracingBaseUrlError(target);

    const url = buildRemoteUrl(baseUrl, target);
    if (!url) throw new Error(`Failed to parse operation ID: ${target}`);

    return remote.fetch(url, target);
  }

  // Partial op id (e.g. `op_<timestamp>`): resolve against the `_remote/` cache
  // so callers don't have to paste the full `op_..._agt_..._tpc_..._<suffix>`.
  if (target.startsWith('op_')) {
    const matches = await remote.findCachedByPrefix(target);
    if (matches.length === 1) return (await remote.getCached(matches[0])) ?? undefined;
    if (matches.length > 1) throw new AmbiguousSnapshotIdError(target, matches);
  }

  return undefined;
}
