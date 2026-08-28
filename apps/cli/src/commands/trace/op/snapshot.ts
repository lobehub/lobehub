import {
  AmbiguousSnapshotIdError,
  type ExecutionSnapshot,
  loadSnapshot,
  MissingTracingBaseUrlError,
} from '@lobechat/agent-tracing';
import { TRPCClientError } from '@trpc/client';

import { getTrpcClient } from '../../../api/client';
import { log } from '../../../utils/logger';

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
