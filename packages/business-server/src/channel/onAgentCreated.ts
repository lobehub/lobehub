import type { LobeChatDatabase } from '@lobechat/database';

export interface OnAgentCreatedParams {
  /** The Agent its creator just made. */
  agentId: string;
  db: LobeChatDatabase;
  /** The person who created the Agent. */
  userId: string;
  workspaceId?: string;
}

/**
 * Follow-up for an Agent created while Channels are on, called after its direct Channel has been
 * opened. An implementation can seed the Agent's own documents, such as a bootstrap document that
 * the Agent removes once it has configured itself; whatever it writes belongs to the Agent, not to
 * the user's memory. A failure is logged and never fails the creation. The default does nothing.
 */
export async function onAgentCreated(_params: OnAgentCreatedParams): Promise<void> {}
