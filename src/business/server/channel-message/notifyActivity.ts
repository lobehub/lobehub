/**
 * A person sent a message in a one-on-one conversation between two people. Fired once per sent
 * message; the caller has already resolved the recipient as the conversation's other person.
 */
export interface NotifyChannelDirectMessageParams {
  actorUserId: string;
  channelId: string;
  messageId: string;
  /** The other person of the conversation. */
  recipientUserId: string;
  /** The workspace the conversation is in; absent for the personal space. */
  workspaceId?: string;
}

export const notifyChannelDirectMessage = (
  _params: NotifyChannelDirectMessageParams,
): Promise<void> => Promise.resolve();
