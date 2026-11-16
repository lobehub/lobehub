/**
 * A person sent a message in a personal conversation between two contacts. Fired once per sent
 * message; the caller has already resolved the recipient as the conversation's other person.
 */
export interface NotifyChannelDirectMessageParams {
  actorUserId: string;
  channelId: string;
  messageId: string;
  /** The other person of the conversation. */
  recipientUserId: string;
}

export const notifyChannelDirectMessage = (
  _params: NotifyChannelDirectMessageParams,
): Promise<void> => Promise.resolve();
