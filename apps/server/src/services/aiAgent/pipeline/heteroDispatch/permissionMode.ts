import type { ChatTopicMetadata, HeteroPermissionMode } from '@lobechat/types';
import { DEFAULT_HETERO_PERMISSION_MODE, isHeteroPermissionMode } from '@lobechat/types';

/**
 * The Claude Code permission mode a dispatched run starts in; undefined for
 * other agents.
 *
 * The topic carries the mode (the composer's chip writes it, and Claude Code's
 * own switches are written back), defaulting to `bypassPermissions`.
 */
export const resolveDispatchPermissionMode = (params: {
  heteroType: string;
  topicMetadata: ChatTopicMetadata | null | undefined;
}): HeteroPermissionMode | undefined => {
  if (params.heteroType !== 'claude-code') return;

  const mode = params.topicMetadata?.heteroPermissionMode;
  return isHeteroPermissionMode(mode) ? mode : DEFAULT_HETERO_PERMISSION_MODE;
};
