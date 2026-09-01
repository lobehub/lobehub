import {
  AmbiguousSnapshotIdError,
  type ExecutionSnapshot,
  loadSnapshot,
  type LoadSnapshotOptions,
  MissingTracingBaseUrlError,
} from '@lobechat/agent-tracing';
import { TRPCClientError } from '@trpc/client';

import { getTrpcClient } from '../../../api/client';
import { log } from '../../../utils/logger';
import { localTraceStoreOptions } from '../../../utils/traceStore';

/** Store locations `lh trace op` reads, in the order a tie is broken. */
export interface LocalSnapshotStores {
  /** `~/.lobehub/traces` — where locally executed agent runs record. */
  cliHome?: LoadSnapshotOptions;
  /** `.agent-tracing` under the cwd — where a dev-mode server writes. */
  cwd?: LoadSnapshotOptions;
}

/**
 * Load a snapshot from either local store.
 *
 * Two stores exist because two producers write them, and for the default
 * target (`latest`) they have to be COMPARED rather than tried in order: each
 * store answers `latest` with its own newest entry, so probing one first would
 * inspect a stale run whenever the other store holds something newer — while
 * `lh trace op list`, which merges and sorts both, correctly shows the newer
 * one first. An explicit id needs no comparison: at most one store has it.
 */
export const loadLocalSnapshot = async (
  target?: string,
  stores: LocalSnapshotStores = {},
): Promise<ExecutionSnapshot | undefined> => {
  const cliHome = stores.cliHome ?? localTraceStoreOptions();
  const cwd = stores.cwd ?? {};

  const isLatest = !target || target === 'latest';
  if (!isLatest) return (await loadSnapshot(target, cliHome)) ?? (await loadSnapshot(target, cwd));

  const [fromCliHome, fromCwd] = await Promise.all([
    loadSnapshot(target, cliHome),
    loadSnapshot(target, cwd),
  ]);

  if (!fromCliHome) return fromCwd;
  if (!fromCwd) return fromCliHome;

  return fromCwd.startedAt > fromCliHome.startedAt ? fromCwd : fromCliHome;
};

/**
 * Resolve the snapshot a `lh trace op` subcommand was pointed at, or exit with
 * a message that says what to do about it.
 *
 * The download path is what `lh` adds over the standalone `agent-tracing` CLI:
 * the object key lives on `agent_operations.trace_s3_key` and the server signs
 * it against the caller's own ownership scope, so inspecting a production run
 * needs a LobeHub login and nothing else — no `TRACING_BASE_URL`, no public
 * bucket domain, and no SQL to turn a topic id into an operation id first.
 */
export const resolveSnapshotOrExit = async (target?: string): Promise<ExecutionSnapshot> => {
  // Why the server declined to sign, kept so the final message can say
  // "no trace recorded" instead of blaming a missing env var.
  let serverReason: string | undefined;

  const resolveDownloadUrl = async (operationId: string): Promise<string | null> => {
    const client = await getTrpcClient();

    try {
      const { data } = await client.agentTrace.getSnapshotUrl.query({ operationId });
      return data.url;
    } catch (error) {
      // NOT_FOUND means the operation is absent, outside the caller's scope, or
      // recorded no trace — all "nothing to download", so fall through to any
      // locally configured TRACING_BASE_URL. Anything else (auth, network, a
      // signing failure) is a real problem and must not be silently swallowed.
      if (error instanceof TRPCClientError && error.data?.code === 'NOT_FOUND') {
        serverReason = error.message;
        return null;
      }
      throw error;
    }
  };

  try {
    // Locally executed runs (`lh hetero exec`) record to the CLI home, so probe
    // it before anything that can reach the network — otherwise inspecting a
    // run this machine just performed would round-trip to the server for a
    // snapshot that is already sitting on disk.
    const localRun = await loadLocalSnapshot(target);
    if (localRun) return localRun;

    const snapshot = await loadSnapshot(target, { allowDownload: true, resolveDownloadUrl });
    if (snapshot) return snapshot;
    log.error(
      target
        ? `No snapshot found for "${target}".`
        : 'No local snapshots found. Run an agent operation first, or pass an operation id.',
    );
  } catch (error) {
    if (error instanceof MissingTracingBaseUrlError) {
      log.error(
        serverReason
          ? `${serverReason}\n` +
              'Run `lh trace op list --topic <topicId>` to see which operations still have a trace.'
          : error.message,
      );
    } else if (error instanceof AmbiguousSnapshotIdError) {
      log.error(error.message);
    } else {
      log.error(error instanceof Error ? error.message : String(error));
    }
  }
  process.exit(1);
};
