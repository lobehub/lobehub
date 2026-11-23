import type { CodexCollaborationMode } from '@lobechat/types';

import { sendHeteroControl } from './heteroControl';
import { type HeteroStopTaskResult, toHeteroStopTaskResult } from './heteroStopTask';

/** Command name the `lh` steer loop registers its Codex Plan handler under. */
export const HETERO_SET_COLLABORATION_MODE_COMMAND = 'set_collaboration_mode';

/** One local RPC on the device; the rest covers the steer poll. */
export const HETERO_SET_COLLABORATION_MODE_TIMEOUT_MS = 15_000;

/**
 * Switch the collaboration mode of a native Codex run hosted by `lh hetero
 * exec` (the composer's Plan switch, mid-run). Codex takes it from the next
 * turn. An `lh` without the handler answers `unsupported`; one that predates
 * control messages leaves it `unreachable`. Either way the topic keeps the
 * pick, and the next run sends it. The caller owns authorization.
 */
export const setHeteroCollaborationMode = async (
  operationId: string,
  mode: CodexCollaborationMode,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<HeteroStopTaskResult> => {
  const { state } = await sendHeteroControl(
    operationId,
    HETERO_SET_COLLABORATION_MODE_COMMAND,
    { mode },
    {
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs ?? HETERO_SET_COLLABORATION_MODE_TIMEOUT_MS,
    },
  );
  return toHeteroStopTaskResult(state);
};
