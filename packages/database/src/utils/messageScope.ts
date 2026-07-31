import { and, eq, exists, isNull, or, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { messages, sessions, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from './workspace';

/**
 * Derived ownership predicate for the `messages` table.
 *
 * `messages.user_id` / `messages.workspace_id` are creation-time snapshots and
 * MUST NOT be used for scope filtering: transferring an agent between scopes
 * rehomes topics/sessions but intentionally leaves the `messages` rows
 * untouched (rewriting them is minutes-long due to index/BM25 write
 * amplification). A message's authoritative scope is therefore derived from
 * its stable anchors:
 *
 * 1. `topic_id` set   → the owning topic's scope
 * 2. else `session_id` set → the owning session's scope
 * 3. else (legacy orphan rows, never part of a transfer) → the row's own
 *    snapshot columns
 *
 * The predicate is self-contained (correlated EXISTS on the anchors' primary
 * keys), so callers don't need to pre-authorize the topic/session — queries
 * keyed by id/topicId/sessionId/agentId pay one PK probe per candidate row.
 * Do NOT use it as the only filter of a whole-table scan (counts, exports):
 * those call sites must drive from `topics`/`sessions` joins instead so an
 * index bounds the scan.
 */
export const buildMessageScopeWhere = (
  db: LobeChatDatabase,
  ctx: { userId: string; workspaceId?: string },
): SQL =>
  or(
    // 1. Message belongs to a topic → derive from the topic's current scope
    exists(
      db
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.id, messages.topicId), buildWorkspaceWhere(ctx, topics))),
    ),
    // 2. No topic, but a session → derive from the session's current scope
    and(
      isNull(messages.topicId),
      exists(
        db
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(eq(sessions.id, messages.sessionId), buildWorkspaceWhere(ctx, sessions))),
      ),
    ),
    // 3. Orphan legacy rows (no topic, no session): the snapshot is authoritative
    and(isNull(messages.topicId), isNull(messages.sessionId), buildWorkspaceWhere(ctx, messages)),
  ) as SQL;

/**
 * Join-based variant of {@link buildMessageScopeWhere} for queries planned by
 * the pg_search custom scan (`content @@@ …` + `paradedb.score` ordering):
 * ParadeDB rejects correlated EXISTS predicates in that shape
 * ("Unsupported query shape"), while plain joins plan fine.
 *
 * Callers MUST add both anchors to the query:
 * `.leftJoin(topics, eq(topics.id, messages.topicId))`
 * `.leftJoin(sessions, eq(sessions.id, messages.sessionId))`
 */
export const buildMessageScopeJoinWhere = (
  ctx: { userId: string; workspaceId?: string },
  cols: {
    sessionId: AnyPgColumn | SQLWrapper;
    topicId: AnyPgColumn | SQLWrapper;
    userId: AnyPgColumn;
    workspaceId: AnyPgColumn;
  } = messages,
): SQL =>
  or(
    // topic joined and in scope (left-joined NULL rows fail the predicate)
    buildWorkspaceWhere(ctx, topics),
    and(isNull(cols.topicId), buildWorkspaceWhere(ctx, sessions)),
    and(isNull(cols.topicId), isNull(cols.sessionId), buildWorkspaceWhere(ctx, cols)),
  ) as SQL;

/**
 * Derived ownership predicate for topic-anchored tables whose only stable
 * anchor is `topic_id` (e.g. `message_groups`): rows with a topic follow the
 * topic's current scope; rows without one fall back to their own snapshot
 * columns.
 */
export const buildTopicAnchoredScopeWhere = (
  db: LobeChatDatabase,
  ctx: { userId: string; workspaceId?: string },
  cols: { topicId: AnyPgColumn; userId: AnyPgColumn; workspaceId: AnyPgColumn },
): SQL =>
  or(
    exists(
      db
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.id, cols.topicId), buildWorkspaceWhere(ctx, topics))),
    ),
    and(isNull(cols.topicId), buildWorkspaceWhere(ctx, cols)),
  ) as SQL;

/**
 * Derived ownership predicate for message child tables
 * (`message_plugins` / `message_translates` / `message_tts` /
 * `messages_files` / `message_queries` …).
 *
 * Child rows carry their own `user_id`/`workspace_id` snapshots, but those
 * drift exactly like the parent message's (and historically were not even
 * rewritten on transfer). Their authoritative scope is simply "my parent
 * message's scope", expressed via the given FK column onto `messages.id`.
 *
 * Skip this predicate entirely when the query already inner-joins `messages`
 * under {@link buildMessageScopeWhere} — the join makes it redundant.
 */
export const buildMessageChildScopeWhere = (
  db: LobeChatDatabase,
  ctx: { userId: string; workspaceId?: string },
  messageIdColumn: AnyPgColumn,
): SQL =>
  exists(
    db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, messageIdColumn), buildMessageScopeWhere(db, ctx))),
  ) as SQL;
