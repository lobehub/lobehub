import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { topics } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

/** A message write, reduced to what moves its topic's activity time. */
export interface TopicMessageActivity {
  topicId?: string | null;
  updatedAt?: Date | number | string | null;
}

/**
 * A topic's activity time as the topic lists sort and return it: the newest
 * live-message write (`topics.last_message_at`), else the row's own
 * `updated_at` for topics with no message written since the column shipped
 * (not backfilled yet, or no messages at all).
 *
 * Matches the `topics_*_agent_id_activity_idx` index expression exactly, so
 * the list's `ORDER BY favorite DESC, <this> DESC LIMIT n` reads off the index.
 */
export const topicActivityAtColumn = () =>
  sql<Date>`COALESCE(${topics.lastMessageAt}, ${topics.updatedAt})`.mapWith(topics.updatedAt);

/**
 * Move `topics.last_message_at` forward to the newest of the given message
 * writes. Call it in the same transaction as the message insert/update so the
 * list order can never observe a message without its topic bump.
 *
 * - Monotonic: the guard only writes when the value advances, so a replayed or
 *   back-dated write (imports, retries) is a no-op and creates no dead tuple.
 * - Never decreases: deleting a message leaves the topic's activity time where
 *   it was (the list never re-sorted on delete in practice either — the next
 *   write moves it again).
 * - Leaves `topics.updated_at` untouched: that is the topic's own edit time
 *   (rename, favorite), displayed separately from the activity sort key.
 * - Keyed by topic id only: in a workspace the topic may belong to another
 *   member, and the caller's message write already proved access to it.
 */
export const bumpTopicLastMessageAt = async (
  db: LobeChatDatabase | Transaction,
  writes: TopicMessageActivity[],
): Promise<void> => {
  const latestByTopic = new Map<string, Date>();

  for (const { topicId, updatedAt } of writes) {
    if (!topicId || updatedAt === null || updatedAt === undefined) continue;

    const at = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    if (Number.isNaN(at.getTime())) continue;

    const current = latestByTopic.get(topicId);
    if (!current || at > current) latestByTopic.set(topicId, at);
  }

  // Almost always one topic (a chat turn); imports and copies carry a handful.
  for (const [topicId, at] of latestByTopic) {
    await db
      .update(topics)
      // Self-assign so Drizzle's `$onUpdate` does not stamp `updated_at`.
      .set({ lastMessageAt: at, updatedAt: topics.updatedAt })
      .where(
        and(eq(topics.id, topicId), or(isNull(topics.lastMessageAt), lt(topics.lastMessageAt, at))),
      );
  }
};
