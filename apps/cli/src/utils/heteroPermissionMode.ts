import {
  isRunningAsRoot,
  setClaudeCodePermissionMode,
} from '@lobechat/heterogeneous-agents/claudeCodePermission';
import { isHeteroPermissionMode } from '@lobechat/types';

import { type HeteroControlHandler, registerHeteroControlHandler } from './heteroControl';

/** The control command the server queues when the user switches mode mid-run. */
export const HETERO_SET_PERMISSION_MODE_COMMAND = 'set_permission_mode';

/**
 * Switch the running Claude Code session's permission mode (the composer's
 * mode chip). Reports the mode Claude Code took — `acceptEdits` for
 * `bypassPermissions` as root; the mode report on the event stream follows.
 */
export const setPermissionModeHandler: HeteroControlHandler = async ({
  params,
  sendControlRequest,
  signal,
}) => {
  const mode = (params as { mode?: unknown } | null)?.mode;
  if (!isHeteroPermissionMode(mode)) throw new Error('set_permission_mode needs a valid mode');

  return {
    mode: await setClaudeCodePermissionMode(sendControlRequest, mode, {
      isRoot: isRunningAsRoot(),
      signal,
    }),
  };
};

registerHeteroControlHandler(HETERO_SET_PERMISSION_MODE_COMMAND, setPermissionModeHandler);
