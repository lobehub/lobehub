/**
 * Workspace members were @-mentioned in a Channel message. Fired once per sent
 * message; the caller has already narrowed recipients to the message's active
 * human members other than the sender.
 */
export interface NotifyChannelMentionParams {
  actorUserId: string;
  channelId: string;
  messageId: string;
  recipientUserIds: string[];
  workspaceId: string;
}

export const notifyChannelMention = (_params: NotifyChannelMentionParams): Promise<void> =>
  Promise.resolve();
