import { and, eq, exists, isNull, ne, or, type SQL, sql, type SQLWrapper } from 'drizzle-orm';
import { type AnyPgColumn, QueryBuilder } from 'drizzle-orm/pg-core';

import {
  messageChunks,
  messageGroups,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
  sessions,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from './workspace';

/**
 * Standalone builder so the predicates below can be constructed WITHOUT a
 * live database handle — they only ever produce SQL. This keeps them usable
 * from code whose `db` is a partial test stub, and makes the dependency
 * explicit: nothing here executes queries.
 */
const qb = new QueryBuilder();

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
export const buildMessageScopeWhere = (ctx: { userId: string; workspaceId?: string }): SQL =>
  or(
    // 1. Message belongs to a topic → derive from the topic's current scope
    exists(
      qb
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.id, messages.topicId), buildWorkspaceWhere(ctx, topics))),
    ),
    // 2. No topic, but a session → derive from the session's current scope
    and(
      isNull(messages.topicId),
      exists(
        qb
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
  ctx: { userId: string; workspaceId?: string },
  cols: { topicId: AnyPgColumn; userId: AnyPgColumn; workspaceId: AnyPgColumn },
): SQL =>
  or(
    exists(
      qb
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
  ctx: { userId: string; workspaceId?: string },
  messageIdColumn: AnyPgColumn,
): SQL =>
  exists(
    qb
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, messageIdColumn), buildMessageScopeWhere(ctx))),
  ) as SQL;

/**
 * Re-materialize stale scope snapshots BEFORE deleting a snapshot FK target
 * (a workspace, or a user).
 *
 * Because transfers leave `messages` (and message child tables /
 * `message_groups`) with their creation-time `user_id` / `workspace_id`, those
 * columns can keep pointing at an owner the rows no longer belong to — and
 * they carry `ON DELETE cascade` FKs, so deleting that old owner would
 * silently destroy history that was transferred away.
 *
 * This scrub restores the pre-derivation invariant for exactly the rows a
 * transfer used to rewrite: rows whose snapshot `workspace_id` disagrees with
 * their anchor's current `workspace_id` (the workspace axis only ever changes
 * via a transfer, so this is a precise stale marker; author snapshots inside
 * an untouched scope are intentionally left alone to preserve the existing
 * "deleting a user removes what they authored" cascade semantics).
 *
 * Owner deletion is rare and already heavyweight, so paying the targeted
 * UPDATEs here — instead of on every transfer — is the whole point of the
 * derived-scope design. Call it inside the same transaction as the owner
 * DELETE.
 */
export const resnapshotTransferredMessagesBeforeOwnerDelete = async (
  // `Pick` so both the base database and a transaction executor are accepted
  db: Pick<LobeChatDatabase, 'execute'>,
  owner: { userId: string } | { workspaceId: string },
): Promise<void> => {
  const ownedBy = (table: { userId: AnyPgColumn; workspaceId: AnyPgColumn }) =>
    'userId' in owner ? eq(table.userId, owner.userId) : eq(table.workspaceId, owner.workspaceId);

  // 1. Messages anchored to a topic follow the topic's current scope.
  await db.execute(sql`
    UPDATE ${messages} SET user_id = ${topics.userId}, workspace_id = ${topics.workspaceId}
    FROM ${topics}
    WHERE ${and(
      eq(messages.topicId, topics.id),
      ownedBy(messages),
      sql`${messages.workspaceId} IS DISTINCT FROM ${topics.workspaceId}`,
    )}
  `);

  // 2. Messages without a topic follow their session's current scope.
  await db.execute(sql`
    UPDATE ${messages} SET user_id = ${sessions.userId}, workspace_id = ${sessions.workspaceId}
    FROM ${sessions}
    WHERE ${and(
      isNull(messages.topicId),
      eq(messages.sessionId, sessions.id),
      ownedBy(messages),
      sql`${messages.workspaceId} IS DISTINCT FROM ${sessions.workspaceId}`,
    )}
  `);

  // 3. message_groups are topic-anchored.
  await db.execute(sql`
    UPDATE ${messageGroups} SET user_id = ${topics.userId}, workspace_id = ${topics.workspaceId}
    FROM ${topics}
    WHERE ${and(
      eq(messageGroups.topicId, topics.id),
      ownedBy(messageGroups),
      sql`${messageGroups.workspaceId} IS DISTINCT FROM ${topics.workspaceId}`,
    )}
  `);

  // 4. Message child tables inherit the (now re-snapshotted) parent message.
  const childAnchors = [
    [messagePlugins, messagePlugins.id],
    [messageTranslates, messageTranslates.id],
    [messageTTS, messageTTS.id],
    [messagesFiles, messagesFiles.messageId],
    [messageQueries, messageQueries.messageId],
    [messageQueryChunks, messageQueryChunks.messageId],
    [messageChunks, messageChunks.messageId],
  ] as const;
  for (const [child, messageIdColumn] of childAnchors) {
    await db.execute(sql`
      UPDATE ${child} SET user_id = ${messages.userId}, workspace_id = ${messages.workspaceId}
      FROM ${messages}
      WHERE ${and(
        eq(messageIdColumn, messages.id),
        ownedBy(child),
        sql`${child.workspaceId} IS DISTINCT FROM ${messages.workspaceId}`,
      )}
    `);
  }
};

/** Transfer aborted: a teammate's topic-anchored message/message_group appeared. */
export const MESSAGE_TRANSFER_HAS_FOREIGN_AUTHORS = 'MESSAGE_TRANSFER_HAS_FOREIGN_AUTHORS';

/**
 * Whether any message rows anchored to the given topics were authored by
 * someone other than `userId`.
 *
 * Transfer guards need this because `messages` and `message_groups` derive
 * their scope from the owning topic at read time (see buildMessageScopeWhere /
 * buildTopicAnchoredScopeWhere): every row anchored to a transferred topic
 * moves with it — including rows the direct session/agent linkage probes
 * cannot see, e.g. OpenAPI-created messages that carry only a `topicId`
 * (`agentId` is optional there and `sessionId` is always null). A teammate's
 * topic-only rows are still their work, so a non-owner transfer must not
 * rehome them.
 *
 * `topicWhere` must bound the probed topics (by session/agent/group linkage)
 * so both probes stay index-driven; each stops at the first foreign row.
 */
export const hasForeignTopicAnchoredMessageRows = async (
  // `Pick` so both the base database and a transaction executor are accepted
  db: Pick<LobeChatDatabase, 'select'>,
  userId: string,
  topicWhere: SQL,
): Promise<boolean> => {
  const [foreignMessage] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(topics, eq(messages.topicId, topics.id))
    .where(and(topicWhere, ne(messages.userId, userId)))
    .limit(1);
  if (foreignMessage) return true;

  const [foreignGroup] = await db
    .select({ id: messageGroups.id })
    .from(messageGroups)
    .innerJoin(topics, eq(messageGroups.topicId, topics.id))
    .where(and(topicWhere, ne(messageGroups.userId, userId)))
    .limit(1);
  return !!foreignGroup;
};
