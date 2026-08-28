import {
  AmbiguousSnapshotIdError,
  type ExecutionSnapshot,
  loadSnapshot,
  MissingTracingBaseUrlError,
} from '@lobechat/agent-tracing';

import { log } from '../../../utils/logger';

/**
 * Resolve the snapshot a `lh trace op` subcommand was pointed at, or exit with
 * a message that says what to do about it.
 */
export const resolveSnapshotOrExit = async (target?: string): Promise<ExecutionSnapshot> => {
  try {
    const snapshot = await loadSnapshot(target, { allowDownload: true });
    if (snapshot) return snapshot;
    log.error(
      target
        ? `No snapshot found for "${target}".`
        : 'No local snapshots found. Run an agent operation first, or pass an operation id.',
    );
  } catch (error) {
    if (error instanceof MissingTracingBaseUrlError || error instanceof AmbiguousSnapshotIdError) {
      log.error(error.message);
    } else {
      log.error(error instanceof Error ? error.message : String(error));
    }
  }
  process.exit(1);
};
