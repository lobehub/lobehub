import { isCodexCollaborationMode } from '@lobechat/types';

import { type HeteroControlHandler, registerHeteroControlHandler } from './heteroControl';

/** The control command the server queues when the Codex Plan switch flips mid-run. */
export const HETERO_SET_COLLABORATION_MODE_COMMAND = 'set_collaboration_mode';

/**
 * Switch a running native Codex thread's collaboration mode (the composer's
 * Plan switch). Codex takes it from the next turn: `thread/settings/update`
 * never changes the turn in flight. Reports the mode that was set.
 */
export const setCollaborationModeHandler: HeteroControlHandler = async ({
  params,
  setCollaborationMode,
}) => {
  const mode = (params as { mode?: unknown } | null)?.mode;
  if (!isCodexCollaborationMode(mode)) {
    throw new Error('set_collaboration_mode needs a valid mode');
  }
  if (!setCollaborationMode) throw new Error('This run is not a native Codex thread');
  await setCollaborationMode(mode);
  return { mode };
};

registerHeteroControlHandler(HETERO_SET_COLLABORATION_MODE_COMMAND, setCollaborationModeHandler);
