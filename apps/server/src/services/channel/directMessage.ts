import type { LobeChatDatabase } from '@lobechat/database';
import { eq } from 'drizzle-orm';

import { notifyChannelDirectMessage } from '@/business/server/channel-message/notifyActivity';
import { channels } from '@/database/schemas';
import { after } from '@/server/utils/scheduleAfterResponse';

interface SentMessage {
  channelId: string;
  id: string;
}

/**
 * Ping the other person of a personal conversation between two contacts about a message the
 * sender posted there. Every message counts, @mention or not. Runs after the response and never
 * fails the send; a retried send returns the same message, so its notification dedupes. The
 * business slot is a no-op outside Cloud.
 */
export const notifyChannelDirectMessages = (
  db: LobeChatDatabase,
  context: { userId: string; workspaceId?: string },
  message: SentMessage,
) => {
  const { userId, workspaceId } = context;
  // Conversations between people are personal.
  if (workspaceId) return;

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
