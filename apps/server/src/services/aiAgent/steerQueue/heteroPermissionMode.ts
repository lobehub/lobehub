import type { HeteroPermissionMode } from '@lobechat/types';
import { isHeteroPermissionMode } from '@lobechat/types';

import { sendHeteroControl } from './heteroControl';
import { type HeteroStopTaskResult, toHeteroStopTaskResult } from './heteroStopTask';

/** Command name the `lh` steer loop registers its mode handler under. */
export const HETERO_SET_PERMISSION_MODE_COMMAND = 'set_permission_mode';

/** The `lh` handler gives Claude Code 10 s to confirm; the rest covers the steer poll. */
export const HETERO_SET_PERMISSION_MODE_TIMEOUT_MS = 20_000;

/**
 * Switch the permission mode of a Claude Code run hosted by `lh hetero exec`
 * (the composer's mode chip, mid-run). `accepted` means Claude Code confirmed;
 * its mode report then reaches the topic through the run's own stream. An `lh`
 * without the handler answers `unsupported`; one that predates control
 * messages leaves it `unreachable`. The caller owns authorization.
 *
 * An accepted switch also says which mode the session took, which differs from
 * the pick when the device runs as root (`bypassPermissions` → `acceptEdits`).
 */
export const setHeteroPermissionMode = async (
  operationId: string,
  mode: HeteroPermissionMode,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<HeteroStopTaskResult | { mode?: HeteroPermissionMode; status: 'accepted' }> => {
  const { state } = await sendHeteroControl(
    operationId,
    HETERO_SET_PERMISSION_MODE_COMMAND,
    { mode },
    {
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs ?? HETERO_SET_PERMISSION_MODE_TIMEOUT_MS,
    },
  );
  const result = toHeteroStopTaskResult(state);
  const taken =
    state?.status === 'ok' ? (state.data as { mode?: unknown } | undefined)?.mode : undefined;
  return result.status === 'accepted' && isHeteroPermissionMode(taken)
    ? { mode: taken, status: 'accepted' }
    : result;
};
