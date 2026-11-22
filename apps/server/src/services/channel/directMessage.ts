import type { LobeChatDatabase } from '@lobechat/database';
import { and, eq } from 'drizzle-orm';

import { notifyChannelDirectMessage } from '@/business/server/channel-message/notifyActivity';
import { notificationsMutedSql } from '@/database/repositories/channel/notificationMute';
import { channelMembers, channels } from '@/database/schemas';
import { after } from '@/server/utils/scheduleAfterResponse';

interface SentMessage {
  channelId: string;
  id: string;
}

/**
 * Ping the other person of a one-on-one conversation between two people about a message the
 * sender posted there. Every message counts, @mention or not. Runs after the response and never
 * fails the send; a retried send returns the same message, so its notification dedupes. The
 * business slot is a no-op outside Cloud.
 */
export const notifyChannelDirectMessages = (
  db: LobeChatDatabase,
  context: { userId: string; workspaceId?: string },
  message: SentMessage,
) => {
  const { userId } = context;

  after(async () => {
    try {
      const [channel] = await db
        .select({ ownerId: channels.userId, peerUserId: channels.peerUserId })
        .from(channels)
        .where(eq(channels.id, message.channelId))
        .limit(1);
      if (!channel?.peerUserId) return;

      const recipientUserId =
        channel.ownerId === userId
          ? channel.peerUserId
          : channel.peerUserId === userId
            ? channel.ownerId
            : null;
      if (!recipientUserId) return;

      // The recipient turned off their own notifications for this conversation.
      const [recipient] = await db
        .select({ muted: notificationsMutedSql() })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, message.channelId),
            eq(channelMembers.userId, recipientUserId),
          ),
        )
        .limit(1);
      if (recipient?.muted) return;

      await notifyChannelDirectMessage({
        actorUserId: userId,
        channelId: message.channelId,
        messageId: message.id,
        recipientUserId,
      });
    } catch (error) {
      console.error('[channel] Failed to send direct message notification', {
        channelId: message.channelId,
        error,
        messageId: message.id,
      });
    }
  });
};
