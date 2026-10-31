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
 * Runs `open` only while Channels are on for the creator. Best-effort: what it follows already
 * exists, so a failure must not fail its creation.
 */
const openForCreator = async (
  what: string,
  context: Omit<DefaultChannelParams, 'db'>,
  open: () => Promise<unknown>,
) => {
  try {
    if (!(await isChannelEnabled(context.userId))) return;
    await open();
  } catch (error) {
    console.error(`[channel] Failed to create ${what}`, { ...context, error });
  }
};

/**
 * Opens the Channel a new workspace or project starts with: its creator and its main Agent (the
 * scope's LobeAI when that Agent needs a device).
 */
export const createDefaultChannel = async ({ db, ...context }: DefaultChannelParams) =>
  openForCreator('the default channel', context, () =>
    new ChannelService(db, context.userId, context.workspaceId).createDefault({
      agentId: context.agentId,
      projectId: context.projectId,
      title: DEFAULT_CHANNEL_TITLE,
    }),
  );

export interface AgentDirectChannelParams {
  /** The Agent its creator just made. */
  agentId: string;
  db: LobeChatDatabase;
  /** The creator's own desktop, where an Agent that runs locally answers; checked before use. */
  localDeviceId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Opens the direct conversation between a person and the Agent they just created, named after the
 * Agent and on the device and directory a new Channel would give it; see
 * `ChannelService.createDirect`.
 */
export const createAgentDirectChannel = async ({
  db,
  localDeviceId,
  ...context
}: AgentDirectChannelParams) =>
  openForCreator('the direct channel of a new agent', context, () =>
    new ChannelService(db, context.userId, context.workspaceId).createDirect(context.agentId, {
      localDeviceId,
    }),
  );
