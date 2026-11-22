/**
 * A person sent a message in a one-on-one conversation between two people. Fired once per sent
 * message; the caller has already resolved the recipient as the conversation's other person.
 */
export interface NotifyChannelDirectMessageParams {
  actorUserId: string;
  channelId: string;
  messageId: string;
  /** The other person of the conversation; its Channel says which scope it is in. */
  recipientUserId: string;
}

export const notifyChannelDirectMessage = (
  _params: NotifyChannelDirectMessageParams,
): Promise<void> => Promise.resolve();

/**
 * An Agent wrote to a person in that person's direct conversation with it, on its requester's
 * behalf (`lobe-channel.messagePerson`). Fired once per message; the recipient owns the
 * conversation.
 */
export interface NotifyChannelAgentMessageParams {
  agentId: string;
  channelId: string;
  messageId: string;
  recipientUserId: string;
}

export const notifyChannelAgentMessage = (
  _params: NotifyChannelAgentMessageParams,
): Promise<void> => Promise.resolve();
