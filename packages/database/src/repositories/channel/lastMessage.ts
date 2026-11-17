import type { ChannelLastMessage } from '@lobechat/types';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { channelMessages, channelThreads } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';

/** Characters of the latest message a Channel list item carries as its preview. */
const LIST_PREVIEW_LENGTH = 200;
/** Characters of a Thread name taken from its root message, as the client names one. */
const THREAD_TITLE_LENGTH = 60;

/**
 * The newest message of each Channel, for a conversation-list preview. Thread replies count, as
 * they do for the unread count: a reply in a Thread is the conversation's latest activity, and a
 * preview stopped at the main conversation reads as nothing new. Trashed Threads are skipped.
 * A Thread is named by its title, else the first line of the message it branched from.
 */
export const channelLastMessages = async (
  db: LobeChatDatabase,
  channelIds: string[],
): Promise<Map<string, ChannelLastMessage>> => {
  if (!channelIds.length) return new Map();
  const root = alias(channelMessages, 'thread_root');

  const latest = await db
    .selectDistinctOn([channelMessages.channelId], {
      channelId: channelMessages.channelId,
      content: sql<string>`left(${channelMessages.content}, ${LIST_PREVIEW_LENGTH})`,
      createdAt: channelMessages.createdAt,
      threadId: channelMessages.threadId,
      threadTitle: sql<string | null>`coalesce(
        nullif(${channelThreads.metadata} ->> 'title', ''),
        nullif(left(split_part(btrim(${root.content}), E'\n', 1), ${THREAD_TITLE_LENGTH}), '')
      )`,
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
    .where(
      and(
        inArray(channelMessages.channelId, channelIds),
        or(isNull(channelMessages.threadId), notTrashed(channelThreads.isDeleted)),
      ),
    )
    .orderBy(channelMessages.channelId, desc(channelMessages.sequence));

  return new Map(
    latest.map(({ channelId, content, createdAt, threadId, threadTitle }) => [
      channelId,
      {
        content,
        createdAt,
        thread: threadId ? { id: threadId, title: threadTitle } : null,
      },
    ]),
  );
};
