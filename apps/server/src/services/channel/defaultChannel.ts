import type { LobeChatDatabase } from '@lobechat/database';

import { onAgentCreated } from '@/business/server/channel/onAgentCreated';

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
 * Runs `open` best-effort: what it follows already exists, so a failure must not fail its
 * creation.
 */
const openForCreator = async (
  what: string,
  context: Omit<DefaultChannelParams, 'db'>,
  open: () => Promise<unknown>,
) => {
  try {
    await open();
  } catch (error) {
    console.error(`[channel] Failed to create ${what}`, { ...context, error });
  }
};

/**
 * Opens the Channel a new workspace or project starts with: its creator and its main Agent (the
 * scope's LobeAI when that Agent needs a device). Not gated by the `channel` flag: every project
 * starts with its General Channel, so turning Channels on later finds it already there.
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
  userId: string;
  workspaceId?: string;
}

/**
 * Opens the direct conversation between a person and the Agent they just created, named after the
 * Agent and bound to no device; see `ChannelService.createDirect`. Then hands the Agent to the
 * `onAgentCreated` slot, which may seed its documents. Both run only while Channels are on for the
 * creator, and each failure is reported on its own.
 */
export const createAgentDirectChannel = async ({ db, ...context }: AgentDirectChannelParams) => {
  let enabled = false;
  await openForCreator('the direct channel of a new agent', context, async () => {
    enabled = await isChannelEnabled(context.userId);
    if (!enabled) return;
    await new ChannelService(db, context.userId, context.workspaceId).createDirect(context.agentId);
  });
  if (!enabled) return;

  await openForCreator('the setup of a new channel agent', context, () =>
    onAgentCreated({ db, ...context }),
  );
};
