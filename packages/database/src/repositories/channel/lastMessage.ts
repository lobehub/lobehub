import type { ChannelLastMessage, ContactCardType } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  agents,
  channelMessageFiles,
  channelMessages,
  channelThreads,
  files,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { agentTitleSql } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { isAgentAuthored } from './author';
import { channelUserNameSql } from './nickname';
import { isOpeningAck } from './openingAck';
import { messageStands } from './tombstone';

/** Characters of the latest message a Channel list item carries as its preview. */
const LIST_PREVIEW_LENGTH = 200;
/** Characters of a Thread name taken from its root message, as the client names one. */
const THREAD_TITLE_LENGTH = 60;

/** Attachment count and first attachment type of each message, for a preview of a file-only one. */
const attachmentsByMessage = async (db: LobeChatDatabase, messageIds: string[]) => {
  const result = new Map<string, { count: number; fileType: string }>();
  if (!messageIds.length) return result;

  const rows = await db
    .select({ fileType: files.fileType, messageId: channelMessageFiles.messageId })
    .from(channelMessageFiles)
    .innerJoin(files, eq(files.id, channelMessageFiles.fileId))
    .where(inArray(channelMessageFiles.messageId, messageIds))
    .orderBy(asc(channelMessageFiles.messageId), asc(channelMessageFiles.sortOrder));
  for (const { fileType, messageId } of rows) {
    const current = result.get(messageId);
    if (current) current.count += 1;
    else result.set(messageId, { count: 1, fileType });
  }
  return result;
};

/**
 * The newest message of each Channel, for a conversation-list preview. Thread replies count, as
 * they do for the unread count: a reply in a Thread is the conversation's latest activity, and a
 * preview stopped at the main conversation reads as nothing new. Trashed Threads are skipped.
 * A Thread is named by its title, else the first line of the message it branched from. The
 * sender and attachments come along, so a list can read "Me: [Image]". An Agent's pre-run
 * acknowledgement is marked `opening`, so a client can show it without announcing it.
 */
export const channelLastMessages = async (
  db: LobeChatDatabase,
  channelIds: string[],
): Promise<Map<string, ChannelLastMessage>> => {
  if (!channelIds.length) return new Map();
  const root = alias(channelMessages, 'thread_root');

  const latest = await db
    .selectDistinctOn([channelMessages.channelId], {
      agentId: channelMessages.agentId,
      agentName: agents.name,
      agentTitle: agentTitleSql(),
      cardName: sql<string | null>`${channelMessages.metadata} -> 'card' ->> 'name'`,
      cardType: sql<ContactCardType | null>`${channelMessages.metadata} -> 'card' ->> 'type'`,
      channelId: channelMessages.channelId,
      content: sql<string>`left(${channelMessages.content}, ${LIST_PREVIEW_LENGTH})`,
      createdAt: channelMessages.createdAt,
      id: channelMessages.id,
      opening: sql<boolean>`coalesce(${isOpeningAck}, false)`.mapWith(Boolean),
      routingStatus: channelMessages.routingStatus,
      threadId: channelMessages.threadId,
      threadTitle: sql<string | null>`coalesce(
        nullif(${channelThreads.metadata} ->> 'title', ''),
        nullif(left(split_part(btrim(${root.content}), E'\n', 1), ${THREAD_TITLE_LENGTH}), '')
      )`,
      userFullName: channelUserNameSql(channelMessages.channelId, channelMessages.userId),
      userId: channelMessages.userId,
      username: users.username,
    })
    .from(channelMessages)
    .leftJoin(
      channelThreads,
      and(
        eq(channelThreads.channelId, channelMessages.channelId),
        eq(channelThreads.id, channelMessages.threadId),
      ),
    )
    .leftJoin(
      root,
      and(eq(root.channelId, channelThreads.channelId), eq(root.id, channelThreads.rootMessageId)),
    )
    .leftJoin(users, eq(users.id, channelMessages.userId))
    .leftJoin(agents, eq(agents.id, channelMessages.agentId))
    .where(
      and(
        inArray(channelMessages.channelId, channelIds),
        messageStands(),
        or(isNull(channelMessages.threadId), notTrashed(channelThreads.isDeleted)),
      ),
    )
    .orderBy(channelMessages.channelId, desc(channelMessages.sequence));

  const attachmentsOf = await attachmentsByMessage(
    db,
    latest.map(({ id }) => id),
  );

  return new Map(
    latest.map((row) => {
      const isAgent = isAgentAuthored(row);
      return [
        row.channelId,
        {
          attachments: attachmentsOf.get(row.id) ?? null,
          author: {
            id: isAgent ? row.agentId : row.userId,
            name: isAgent ? row.agentName || row.agentTitle : row.userFullName || row.username,
            type: isAgent ? ('agent' as const) : ('user' as const),
          },
          card: row.cardType ? { name: row.cardName, type: row.cardType } : null,
          content: row.content,
          createdAt: row.createdAt,
          opening: row.opening,
          thread: row.threadId ? { id: row.threadId, title: row.threadTitle } : null,
        },
      ];
    }),
  );
};
