import type { ChatTopicMetadata, HeteroPermissionMode } from '@lobechat/types';
import { DEFAULT_HETERO_PERMISSION_MODE, isHeteroPermissionMode } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:hetero-dispatch:permission-mode');

/**
 * The Claude Code permission mode a dispatched run starts in, or undefined to
 * allow every action as before the Better Coding Experience lab.
 *
 * Only for Claude Code with the run owner's lab on. The topic carries the mode
 * (the composer's chip writes it, and Claude Code's own switches are written
 * back), defaulting to `bypassPermissions`. A failed preference read keeps the
 * pre-lab behavior rather than starting a run that asks.
 */
export const resolveDispatchPermissionMode = async (
  db: LobeChatDatabase,
  userId: string,
  params: { heteroType: string; topicMetadata: ChatTopicMetadata | null | undefined },
): Promise<HeteroPermissionMode | undefined> => {
  if (params.heteroType !== 'claude-code') return;

  try {
    const preference = await new UserModel(db, userId).getUserPreference();
    if (!preference?.lab?.enableBetterCodingExperience) return;
  } catch (error) {
    log('Reading the lab preference of %s failed: %O', userId, error);
    return;
  }

  const mode = params.topicMetadata?.heteroPermissionMode;
  return isHeteroPermissionMode(mode) ? mode : DEFAULT_HETERO_PERMISSION_MODE;
};
