/** One emoji on a message: who left it, by member, in the order they did. */
export interface ChannelMessageReaction {
  count: number;
  /** A Unicode emoji. */
  emoji: string;
  /** People and Agents alike, by their member in the Channel. */
  memberIds: string[];
}

/** An Agent adding or removing its own reaction on a message of its current conversation. */
export interface ChannelReactParams {
  emoji: string;
  messageId: string;
  /** The Thread `readMessages({ threadId })` returned the message from. */
  threadId?: string;
}

export interface ChannelReacted {
  added: boolean;
  emoji: string;
  messageId: string;
}
