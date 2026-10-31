import type { LobeChatDatabase } from '@lobechat/database';

import { ChannelService } from './ChannelService';
import { isChannelEnabled } from './featureGate';

/** Title of the Channel a new workspace or project starts with; members can rename it. */
export const DEFAULT_CHANNEL_TITLE = 'General';

export interface DefaultChannelParams {
  /** The scope's main Agent: a workspace's LobeAI, or a project's main agent. */
  agentId: string;
  db: LobeChatDatabase;
  projectId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Opens the Channel a new workspace or project starts with: its creator and its main Agent (the
 * scope's LobeAI when that Agent needs a device). Only while Channels are on for the creator.
 * Best-effort: the workspace or project already exists, so a failure must not fail its creation.
 */
export const createDefaultChannel = async ({
  agentId,
  db,
  projectId,
  userId,
  workspaceId,
}: DefaultChannelParams) => {
  try {
    if (!(await isChannelEnabled(userId))) return;
    await new ChannelService(db, userId, workspaceId).createDefault({
      agentId,
      projectId,
      title: DEFAULT_CHANNEL_TITLE,
    });
  } catch (error) {
    console.error('[channel] Failed to create the default channel', {
      agentId,
      error,
      projectId,
      userId,
      workspaceId,
    });
  }
};
