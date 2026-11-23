import type { LobeChatDatabase } from '@lobechat/database';
import { and, eq, inArray, isNull, not } from 'drizzle-orm';

import { notifyChannelMention } from '@/business/server/channel-mention/notifyActivity';
import { notificationsMutedSql } from '@/database/repositories/channel/notificationMute';
import { channelMembers, workspaceMembers } from '@/database/schemas';
import { after } from '@/server/utils/scheduleAfterResponse';

interface MentionedMessage {
  channelId: string;
  id: string;
  mentions: string[];
}

/**
 * Ping the people a workspace Channel message @-mentions. Runs after the response and never
 * fails the send; a retried send returns the same message, so its notification dedupes. The
 * business slot is a no-op outside Cloud.
 */
export const notifyChannelMentions = (
  db: LobeChatDatabase,
  /** `includeActor` notifies `userId` too: an Agent wrote the message on their behalf. */
  context: { includeActor?: boolean; userId: string; workspaceId?: string },
  message: MentionedMessage,
) => {
  const { includeActor, userId, workspaceId } = context;
  if (!workspaceId || !message.mentions.length) return;

  after(async () => {
    try {
      const members = await db
        .select({ userId: channelMembers.userId })
        .from(channelMembers)
        // Leaving a workspace keeps the Channel member row, so membership is checked here.
        .innerJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.userId, channelMembers.userId),
            eq(workspaceMembers.workspaceId, workspaceId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .where(
          and(
            eq(channelMembers.channelId, message.channelId),
            inArray(channelMembers.id, message.mentions),
            eq(channelMembers.actorType, 'user'),
            eq(channelMembers.status, 'active'),
            // Muting the Channel's notifications stops even an @mention's push.
            not(notificationsMutedSql()),
          ),
        );
      const recipientUserIds = [
        ...new Set(members.flatMap((member) => (member.userId ? [member.userId] : []))),
      ].filter((id) => includeActor || id !== userId);
      if (!recipientUserIds.length) return;

      await notifyChannelMention({
        actorUserId: userId,
        channelId: message.channelId,
        messageId: message.id,
        recipientUserIds,
        workspaceId,
      });
    } catch (error) {
      console.error('[channel] Failed to send mention notification', {
        channelId: message.channelId,
        error,
        messageId: message.id,
        workspaceId,
      });
    }
  });
};
