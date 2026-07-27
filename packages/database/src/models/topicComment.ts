import { LOADING_FLAT } from '@lobechat/const';
import { parse, resolveAssistantGroupFinalContent } from '@lobechat/conversation-flow';
import type { UIChatMessage } from '@lobechat/types';
import { truncateSurrogateSafe } from '@lobechat/utils';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { messagePlugins, messages } from '../schemas/message';
import { topics } from '../schemas/topic';
import type { TopicCommentAnchorPreview, TopicCommentItem } from '../schemas/topicComment';
import { topicCommentMentions, topicComments } from '../schemas/topicComment';
import type { LobeChatDatabase, Transaction } from '../type';

export const TOPIC_COMMENT_WORKSPACE_REQUIRED =
  'Topic comments are workspace-scoped; a workspaceId is required';
/**
 * Single message for missing / cross-workspace / personal-mode topics so the
 * error reveals nothing about topics outside the caller's workspace.
 */
export const TOPIC_COMMENT_TOPIC_NOT_FOUND = 'Topic not found in current workspace';
export const TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC = 'Message does not belong to the topic';
/** Single message for missing / cross-topic / cross-workspace parents (no existence leak) */
export const TOPIC_COMMENT_PARENT_NOT_FOUND = 'Parent comment not found in the topic';
export const TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED = 'Replies can only target a top-level comment';
export const TOPIC_COMMENT_REPLY_CANNOT_ANCHOR = 'A reply cannot anchor to a message';
export const TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS =
  'Topic transfer includes comments authored by another user';
export const TOPIC_COMMENT_NOT_MODERATED = 'Topic comment is not recoverable';
export const TOPIC_COMMENT_MODERATION_EXPIRED = 'Topic comment recovery window has expired';

const TOPIC_COMMENT_MODERATION_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;
const topicCommentChildren = alias(topicComments, 'topic_comment_children');

/**
 * Anchor excerpts must be cut surrogate-safely: a lone surrogate left by a
 * mid-emoji `slice` would be escaped as an unpaired `\ud8xx` that PostgreSQL's
 * jsonb parser rejects, failing anchored-comment creation outright (see
 * `truncateSurrogateSafe`).
 */
const ANCHOR_PREVIEW_MAX_LENGTH = 200;

const normalizeAnchorPreviewContent = (content?: string | null) => {
  if (!content?.trim() || content === LOADING_FLAT) return;
  return content;
};

/**
 * Deletion-stable keyset cursor over the exact database `(createdAt, id)` key.
 * The timestamp is selected as text so PostgreSQL microseconds survive the
 * round-trip instead of being truncated by JavaScript `Date`.
 */
const topicCommentCursorSelection = {
  ...getTableColumns(topicComments),
  cursorCreatedAt: sql<string>`${topicComments.createdAt}::text`.as('cursor_created_at'),
};

const encodeTopicCommentCursor = (createdAt: string, id: string): string => `${createdAt}|${id}`;

const decodeTopicCommentCursor = (cursor?: string): { createdAt: string; id: string } | null => {
  if (!cursor) return null;

  const separator = cursor.lastIndexOf('|');
  if (separator <= 0) return null;

  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!id || Number.isNaN(Date.parse(createdAt))) return null;

  return { createdAt, id };
};

export interface CreateTopicCommentParams {
  clientId: string;
  content: string;
  editorData?: unknown;
  /** Validated (active-membership) user ids parsed from editorData by the caller */
  mentionedUserIds?: string[];
  messageId?: string;
  /**
   * Thread root to reply to. Single level: the target must itself be
   * top-level, and a reply cannot carry a messageId (the thread's anchor
   * lives on the root). Replying to a tombstoned root is allowed — the
   * thread is still alive by definition (a tombstone implies live replies).
   */
  parentCommentId?: string;
  topicId: string;
}

export interface CreateTopicCommentResult {
  addedMentionUserIds: string[];
  comment: TopicCommentItem;
  /** true when the insert hit the (topicId, authorUserId, clientId) idempotency key and the existing row is returned */
  isDuplicate: boolean;
  /** User who owns an anchored message; used for post-commit activity delivery. */
  messageOwnerUserId?: string;
  /** Author of the root when this is a reply; used for post-commit activity delivery. */
  parentAuthorUserId?: string | null;
  /** User who owns the topic. */
  topicOwnerUserId: string;
  /** Topic owner plus distinct message owners for a topic-level comment. */
  topicParticipantUserIds: string[];
}

export interface UpdateTopicCommentParams {
  content?: string;
  editorData?: unknown;
}

export interface UpdateTopicCommentOptions {
  /**
   * Replace the mention set with this list (diff is computed against the
   * mentions table). Omit to leave mentions untouched.
   */
  mentionedUserIds?: string[];
}

export interface DeleteTopicCommentOptions {
  /**
   * Drops the author predicate so workspace owners can moderate others'
   * comments away. Only pass after an explicit owner-level RBAC check
   * (e.g. `topic_comment:delete:all`) — never from plain member requests.
   *
   * Delete-only on purpose: `update` has no override path. Moderation means
   * removing content, never rewriting someone else's words under their name
   * (impersonation risk, and there is no edit history to audit it) — the same
   * boundary Slack/GitHub draw for admins.
   */
  overrideAuthorScope?: boolean;
}

export interface TopicCommentReadOptions {
  /** Owner-only: include recoverable comments authored by any workspace member. */
  includeAllModerated?: boolean;
}

export interface ModerateTopicCommentResult {
  comment: TopicCommentItem;
  moderationExpiresAt: Date;
}

export interface PurgeExpiredTopicCommentModerationResult {
  garbageCollected: number;
  hardDeleted: number;
  processed: number;
  tombstoned: number;
}

export interface UpdateTopicCommentResult {
  /** Newly added mention targets — the only ones the caller should notify */
  addedMentionUserIds: string[];
  comment: TopicCommentItem;
}

export interface ListTopicCommentRepliesParams {
  /** Opaque value cursor over the ascending `(createdAt, id)` reply order */
  cursor?: string;
  limit?: number;
  rootCommentId: string;
}

export interface ListTopicCommentThreadsParams {
  /** Opaque value cursor over the descending `(createdAt, id)` root order */
  cursor?: string;
  limit?: number;
  messageId?: string;
  topicId: string;
}

export interface TopicCommentReplyPage {
  items: TopicCommentItem[];
  nextCursor: string | null;
  /** Canonical live-reply count; returned only on the first cursor page. */
  total?: number;
}

export interface TopicCommentSummary {
  /**
   * Per-message counts. Only anchored roots carry a messageId, so each unit
   * here is a thread — replies never inflate a message badge. An anchored
   * tombstone still counts because it exists only while live replies keep the
   * thread alive.
   */
  countByMessage: Record<string, number>;
  /** Live comments (roots + replies); tombstones are excluded */
  total: number;
}

export interface TopicCommentThread {
  replyCount: number;
  root: TopicCommentItem;
}

export interface TopicCommentThreadPage {
  items: TopicCommentThread[];
  nextCursor: string | null;
}

/**
 * Workspace-scoped topic comments. Every method requires a workspaceId —
 * personal-mode callers (workspaceId undefined) are rejected, and the comment
 * row's workspaceId is always copied from the parent topic inside the create
 * transaction, never from the constructor argument alone (the topic lookup
 * asserts they match).
 *
 * Authorization layering: this model enforces workspace scoping plus
 * author-only mutations as defense in depth. Membership/RBAC checks and the
 * owner override decision live in the router layer. Edits are author-only by
 * design — the owner override exists solely on `delete` (see
 * {@link DeleteTopicCommentOptions}).
 *
 * Tombstoned rows (author account deleted ⇒ `authorUserId` NULL): the
 * author-scoped predicate `eq(authorUserId, userId)` never matches NULL, so
 * orphaned comments can only be deleted via `overrideAuthorScope`, never
 * edited.
 */
export class TopicCommentModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private requireWorkspaceId = (): string => {
    if (!this.workspaceId) throw new Error(TOPIC_COMMENT_WORKSPACE_REQUIRED);
    return this.workspaceId;
  };

  private resolveAnchorPreviewExcerpt = async (
    db: LobeChatDatabase,
    anchor: {
      content: string | null;
      groupId: string | null;
      id: string;
      role: string;
      threadId: string | null;
    },
    topicId: string,
    workspaceId: string,
  ) => {
    let content = normalizeAnchorPreviewContent(anchor.content);
    if (anchor.role === 'assistant') {
      // Fetch only this reply's non-user descendant tree. A normal topic query
      // pages at 1000 rows and can omit an older anchor or its final answer;
      // stopping at user turns keeps the chain complete without loading the
      // rest of a long conversation. Include the immediate user parent because
      // conversation-flow uses it to recognize a toolless narration as the head
      // of the following tool chain.
      const result = await db.execute(sql`
        WITH RECURSIVE anchor_reply(id) AS (
          SELECT id
          FROM messages
          WHERE id = ${anchor.id}
            AND topic_id = ${topicId}
            AND workspace_id = ${workspaceId}
            AND group_id IS NOT DISTINCT FROM ${anchor.groupId}
            AND thread_id IS NOT DISTINCT FROM ${anchor.threadId}
          UNION
          SELECT child.id
          FROM messages child
          JOIN anchor_reply parent ON child.parent_id = parent.id
          WHERE child.role <> 'user'
            AND child.topic_id = ${topicId}
            AND child.workspace_id = ${workspaceId}
            AND child.group_id IS NOT DISTINCT FROM ${anchor.groupId}
            AND child.thread_id IS NOT DISTINCT FROM ${anchor.threadId}
        )
        SELECT id FROM anchor_reply
        UNION
        SELECT parent.id
        FROM messages anchor
        JOIN messages parent ON parent.id = anchor.parent_id
        WHERE anchor.id = ${anchor.id}
          AND parent.role = 'user'
          AND parent.topic_id = ${topicId}
          AND parent.workspace_id = ${workspaceId}
          AND parent.group_id IS NOT DISTINCT FROM ${anchor.groupId}
          AND parent.thread_id IS NOT DISTINCT FROM ${anchor.threadId}
      `);
      const messageIds = (result.rows as { id: string }[]).map(({ id }) => id);
      // Preview reconstruction only needs conversation-flow's structural fields.
      // Avoid MessageModel.queryWithWhere here: it also hydrates files, parsed
      // documents, RAG chunks, translations, TTS and other UI relations while
      // this transaction holds the topic lock.
      const messageList = await db
        .select({
          agentId: messages.agentId,
          content: messages.content,
          createdAt: messages.createdAt,
          error: messages.error,
          groupId: messages.groupId,
          id: messages.id,
          metadata: messages.metadata,
          parentId: messages.parentId,
          role: messages.role,
          targetId: messages.targetId,
          threadId: messages.threadId,
          tool_call_id: messagePlugins.toolCallId,
          tools: messages.tools,
          updatedAt: messages.updatedAt,
        })
        .from(messages)
        .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
        .where(and(inArray(messages.id, messageIds), isNull(messages.messageGroupId)))
        .orderBy(asc(messages.createdAt), asc(messages.id));
      const { flatList } = parse(messageList as UIChatMessage[]);
      content =
        resolveAssistantGroupFinalContent(flatList.find((message) => message.id === anchor.id)) ??
        content;
    }

    return truncateSurrogateSafe(content ?? '', ANCHOR_PREVIEW_MAX_LENGTH);
  };

  /**
   * Non-owners can read their own recoverable placeholder. Everyone can read
   * a recoverable root while active replies need its thread structure. The
   * body is still redacted at the DTO boundary; this predicate only controls
   * row visibility and pagination.
   */
  private moderatedReadCondition = (options: TopicCommentReadOptions): SQL | undefined => {
    if (options.includeAllModerated) return undefined;

    return or(
      isNull(topicComments.moderatedAt),
      eq(topicComments.authorUserId, this.userId),
      and(
        isNull(topicComments.parentCommentId),
        exists(
          this.db
            .select({ id: topicCommentChildren.id })
            .from(topicCommentChildren)
            .where(
              and(
                eq(topicCommentChildren.parentCommentId, topicComments.id),
                isNull(topicCommentChildren.deletedAt),
                isNull(topicCommentChildren.moderatedAt),
              ),
            ),
        ),
      ),
    );
  };

  async createWithMentions(params: CreateTopicCommentParams): Promise<CreateTopicCommentResult> {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      const [topic] = await tx
        .select({ id: topics.id, userId: topics.userId, workspaceId: topics.workspaceId })
        .from(topics)
        .where(eq(topics.id, params.topicId))
        .limit(1)
        .for('update');

      // Covers missing, cross-workspace and personal-mode (workspaceId NULL) topics
      if (!topic || topic.workspaceId !== workspaceId)
        throw new Error(TOPIC_COMMENT_TOPIC_NOT_FOUND);

      let parentAuthorUserId: string | null | undefined;
      if (params.parentCommentId) {
        if (params.messageId) throw new Error(TOPIC_COMMENT_REPLY_CANNOT_ANCHOR);

        const [parent] = await tx
          .select({
            authorUserId: topicComments.authorUserId,
            id: topicComments.id,
            parentCommentId: topicComments.parentCommentId,
            topicId: topicComments.topicId,
            workspaceId: topicComments.workspaceId,
          })
          .from(topicComments)
          .where(eq(topicComments.id, params.parentCommentId))
          .limit(1)
          .for('key share');

        // One message for missing / cross-topic / cross-workspace parents
        if (!parent || parent.workspaceId !== workspaceId || parent.topicId !== params.topicId)
          throw new Error(TOPIC_COMMENT_PARENT_NOT_FOUND);
        if (parent.parentCommentId) throw new Error(TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED);
        parentAuthorUserId = parent.authorUserId;
      }

      let anchorPreview: TopicCommentAnchorPreview | undefined;
      let messageOwnerUserId: string | undefined;
      if (params.messageId) {
        const [message] = await tx
          .select({
            content: messages.content,
            groupId: messages.groupId,
            id: messages.id,
            role: messages.role,
            threadId: messages.threadId,
            topicId: messages.topicId,
            userId: messages.userId,
          })
          .from(messages)
          .where(eq(messages.id, params.messageId))
          .limit(1);

        if (!message || message.topicId !== params.topicId)
          throw new Error(TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC);

        anchorPreview = {
          excerpt: await this.resolveAnchorPreviewExcerpt(
            tx as LobeChatDatabase,
            message,
            params.topicId,
            workspaceId,
          ),
          role: message.role,
        };
        messageOwnerUserId = message.userId;
      }

      let topicParticipantUserIds: string[] = [];
      if (!params.parentCommentId && !params.messageId) {
        const messageOwners = await tx
          .select({ userId: messages.userId })
          .from(messages)
          .where(eq(messages.topicId, params.topicId))
          .groupBy(messages.userId);
        topicParticipantUserIds = [
          ...new Set([topic.userId, ...messageOwners.map(({ userId }) => userId)]),
        ];
      }
      const mentionedUserIds = [...new Set(params.mentionedUserIds ?? [])];

      const [inserted] = await tx
        .insert(topicComments)
        .values({
          anchorPreview,
          authorUserId: this.userId,
          clientId: params.clientId,
          content: params.content,
          editorData: params.editorData,
          messageId: params.messageId ?? null,
          parentCommentId: params.parentCommentId ?? null,
          topicId: params.topicId,
          workspaceId: topic.workspaceId,
        })
        .onConflictDoNothing({
          target: [topicComments.topicId, topicComments.authorUserId, topicComments.clientId],
        })
        .returning();

      if (!inserted) {
        // Retried create: the idempotency key already has a row — return it as-is
        const [existing] = await tx
          .select()
          .from(topicComments)
          .where(
            and(
              eq(topicComments.topicId, params.topicId),
              eq(topicComments.workspaceId, workspaceId),
              eq(topicComments.clientId, params.clientId),
              eq(topicComments.authorUserId, this.userId),
            ),
          )
          .limit(1);

        // Conflict raced with a delete of the original row; let the caller retry
        if (!existing) throw new Error('Failed to create topic comment');

        return {
          addedMentionUserIds: [],
          comment: existing,
          isDuplicate: true,
          messageOwnerUserId,
          parentAuthorUserId,
          topicParticipantUserIds,
          topicOwnerUserId: topic.userId,
        };
      }

      if (mentionedUserIds.length > 0) {
        await tx
          .insert(topicCommentMentions)
          .values(
            mentionedUserIds.map((mentionedUserId) => ({
              commentId: inserted.id,
              mentionedUserId,
              workspaceId,
            })),
          )
          .onConflictDoNothing();
      }

      return {
        addedMentionUserIds: mentionedUserIds,
        comment: inserted,
        isDuplicate: false,
        messageOwnerUserId,
        parentAuthorUserId,
        topicParticipantUserIds,
        topicOwnerUserId: topic.userId,
      };
    });
  }

  async update(
    id: string,
    params: UpdateTopicCommentParams,
    options: UpdateTopicCommentOptions = {},
  ): Promise<UpdateTopicCommentResult | undefined> {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      const conditions = [
        eq(topicComments.id, id),
        eq(topicComments.workspaceId, workspaceId),
        // Edits are strictly author-scoped — no owner override here on
        // purpose (see DeleteTopicCommentOptions.overrideAuthorScope)
        eq(topicComments.authorUserId, this.userId),
        // Tombstones are dead rows — never editable
        isNull(topicComments.deletedAt),
        // Owner-moderated rows are frozen until restored
        isNull(topicComments.moderatedAt),
      ];

      const [comment] = await tx
        .update(topicComments)
        .set({
          updatedAt: new Date(),
          ...(params.content === undefined ? {} : { content: params.content }),
          ...(params.editorData === undefined ? {} : { editorData: params.editorData }),
        })
        .where(and(...conditions))
        .returning();

      if (!comment) return undefined;

      let addedMentionUserIds: string[] = [];
      if (options.mentionedUserIds) {
        const next = [...new Set(options.mentionedUserIds)];
        const existingRows = await tx
          .select({ mentionedUserId: topicCommentMentions.mentionedUserId })
          .from(topicCommentMentions)
          .where(eq(topicCommentMentions.commentId, id));
        const existing = new Set(existingRows.map((row) => row.mentionedUserId));

        addedMentionUserIds = next.filter((userId) => !existing.has(userId));
        const removed = [...existing].filter((userId) => !next.includes(userId));

        if (addedMentionUserIds.length > 0) {
          await tx
            .insert(topicCommentMentions)
            .values(
              addedMentionUserIds.map((mentionedUserId) => ({
                commentId: id,
                mentionedUserId,
                workspaceId,
              })),
            )
            .onConflictDoNothing();
        }

        if (removed.length > 0) {
          await tx
            .delete(topicCommentMentions)
            .where(
              and(
                eq(topicCommentMentions.commentId, id),
                inArray(topicCommentMentions.mentionedUserId, removed),
              ),
            );
        }
      }

      return { addedMentionUserIds, comment };
    });
  }

  /**
   * Hybrid delete. A comment with live replies is soft-deleted (content and
   * editorData blanked, mentions dropped, `deletedAt` stamped) so the replies
   * — other people's work — survive under a placeholder; the anchor fields
   * stay so the thread keeps its message anchor. A reply-less comment is
   * hard-deleted, and if it was the last live reply of a tombstoned root the
   * tombstone is garbage-collected in the same transaction. Tombstones
   * themselves are not deletable again (only GC removes them).
   *
   * Returns the mode used, or false when the row wasn't found / not owned.
   */
  async delete(
    id: string,
    options: DeleteTopicCommentOptions = {},
  ): Promise<'hard' | 'soft' | false> {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      const conditions = [
        eq(topicComments.id, id),
        eq(topicComments.workspaceId, workspaceId),
        isNull(topicComments.moderatedAt),
      ];
      if (!options.overrideAuthorScope)
        conditions.push(eq(topicComments.authorUserId, this.userId));

      // Discover the thread root first, then serialize every structural delete
      // in the thread on that one row. Locking only the target would still let
      // two sibling replies be deleted concurrently and both observe the other
      // uncommitted reply, leaving an empty tombstone behind.
      const [candidate] = await tx
        .select({ id: topicComments.id, parentCommentId: topicComments.parentCommentId })
        .from(topicComments)
        .where(and(...conditions))
        .limit(1);

      if (!candidate) return false;

      const rootId = candidate.parentCommentId ?? candidate.id;
      const [lockedRoot] = await tx
        .select({ id: topicComments.id })
        .from(topicComments)
        .where(
          and(
            eq(topicComments.id, rootId),
            eq(topicComments.workspaceId, workspaceId),
            isNull(topicComments.parentCommentId),
          ),
        )
        .for('update');

      if (!lockedRoot) return false;

      // The target may have changed while this transaction waited for the root
      // lock, so authorization and deletion state must be checked again.
      const [comment] = await tx
        .select({
          deletedAt: topicComments.deletedAt,
          id: topicComments.id,
          parentCommentId: topicComments.parentCommentId,
        })
        .from(topicComments)
        .where(and(...conditions))
        .limit(1);

      if (!comment || comment.deletedAt) return false;

      const [structuralReplies] = await tx
        .select({ total: count() })
        .from(topicComments)
        .where(eq(topicComments.parentCommentId, id));

      if ((structuralReplies?.total ?? 0) > 0) {
        await tx
          .update(topicComments)
          .set({ content: '', deletedAt: new Date(), editorData: null, updatedAt: new Date() })
          .where(eq(topicComments.id, id));
        // Retracted content must not keep notifying/relating people
        await tx.delete(topicCommentMentions).where(eq(topicCommentMentions.commentId, id));

        return 'soft';
      }

      await tx.delete(topicComments).where(eq(topicComments.id, id));

      // Tombstone GC: a soft-deleted root exists iff it still has live replies
      if (comment.parentCommentId) {
        const [parent] = await tx
          .select({ deletedAt: topicComments.deletedAt, id: topicComments.id })
          .from(topicComments)
          .where(eq(topicComments.id, comment.parentCommentId))
          .limit(1);

        if (parent?.deletedAt) {
          const [siblings] = await tx
            .select({ total: count() })
            .from(topicComments)
            .where(eq(topicComments.parentCommentId, parent.id));

          if ((siblings?.total ?? 0) === 0)
            await tx.delete(topicComments).where(eq(topicComments.id, parent.id));
        }
      }

      return 'hard';
    });
  }

  /**
   * Recoverably remove another user's active comment. Authorization is owner-
   * only at the router; the author inequality remains here as defense in depth
   * so this path can never change self-delete semantics.
   */
  async moderateRemove(
    id: string,
    now = new Date(),
    trx?: Transaction,
  ): Promise<ModerateTopicCommentResult | undefined> {
    const workspaceId = this.requireWorkspaceId();
    const moderationExpiresAt = new Date(now.getTime() + TOPIC_COMMENT_MODERATION_RECOVERY_MS);

    const [comment] = await (trx ?? this.db)
      .update(topicComments)
      .set({
        moderatedAt: now,
        moderatedByUserId: this.userId,
        moderationExpiresAt,
        // Moderation is not an author edit and must not change the displayed edit time.
        updatedAt: sql`${topicComments.updatedAt}`,
      })
      .where(
        and(
          eq(topicComments.id, id),
          eq(topicComments.workspaceId, workspaceId),
          isNull(topicComments.deletedAt),
          isNull(topicComments.moderatedAt),
          or(ne(topicComments.authorUserId, this.userId), isNull(topicComments.authorUserId)),
        ),
      )
      .returning();

    return comment ? { comment, moderationExpiresAt } : undefined;
  }

  /** Owner-only at the router. Restoring does not touch updatedAt or mentions. */
  async restoreModerated(
    id: string,
    now = new Date(),
    trx?: Transaction,
  ): Promise<TopicCommentItem | undefined> {
    const workspaceId = this.requireWorkspaceId();

    const [comment] = await (trx ?? this.db)
      .update(topicComments)
      .set({
        moderatedAt: null,
        moderatedByUserId: null,
        moderationExpiresAt: null,
        // Restoring the retained version is not a content edit.
        updatedAt: sql`${topicComments.updatedAt}`,
      })
      .where(
        and(
          eq(topicComments.id, id),
          eq(topicComments.workspaceId, workspaceId),
          isNotNull(topicComments.moderatedAt),
          gt(topicComments.moderationExpiresAt, now),
          isNull(topicComments.deletedAt),
        ),
      )
      .returning();

    return comment;
  }

  async findById(
    id: string,
    options: TopicCommentReadOptions = {},
  ): Promise<TopicCommentItem | undefined> {
    const workspaceId = this.requireWorkspaceId();
    const moderatedReadCondition = this.moderatedReadCondition(options);

    const [comment] = await this.db
      .select()
      .from(topicComments)
      .where(
        and(
          eq(topicComments.id, id),
          eq(topicComments.workspaceId, workspaceId),
          moderatedReadCondition,
        ),
      )
      .limit(1);

    return comment;
  }

  /**
   * Root-thread page ordered newest-first by `(createdAt, id)`, with live-reply counts loaded
   * in one bounded group-by query. Reply bodies are deliberately omitted and
   * paged only through `listReplies`, so one hot thread cannot make this response
   * grow without bound. Tombstoned roots remain visible while their replies live.
   */
  async listThreads(
    params: ListTopicCommentThreadsParams,
    options: TopicCommentReadOptions = {},
  ): Promise<TopicCommentThreadPage> {
    const workspaceId = this.requireWorkspaceId();
    const { cursor, limit = 20, messageId, topicId } = params;

    const rootConditions = [
      eq(topicComments.topicId, topicId),
      eq(topicComments.workspaceId, workspaceId),
      isNull(topicComments.parentCommentId),
    ];
    const moderatedReadCondition = this.moderatedReadCondition(options);
    if (moderatedReadCondition) rootConditions.push(moderatedReadCondition);
    if (messageId !== undefined) rootConditions.push(eq(topicComments.messageId, messageId));

    const decodedCursor = decodeTopicCommentCursor(cursor);
    if (decodedCursor) {
      const cursorCreatedAt = sql`${decodedCursor.createdAt}::timestamptz`;
      rootConditions.push(
        or(
          lt(topicComments.createdAt, cursorCreatedAt),
          and(eq(topicComments.createdAt, cursorCreatedAt), lt(topicComments.id, decodedCursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select(topicCommentCursorSelection)
      .from(topicComments)
      .where(and(...rootConditions))
      .orderBy(desc(topicComments.createdAt), desc(topicComments.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const roots = pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...root }) => root);
    const rootIds = roots.map((root) => root.id);
    const replyCountRows =
      rootIds.length === 0
        ? []
        : await this.db
            .select({ parentCommentId: topicComments.parentCommentId, total: count() })
            .from(topicComments)
            .where(
              and(
                eq(topicComments.workspaceId, workspaceId),
                inArray(topicComments.parentCommentId, rootIds),
                isNull(topicComments.deletedAt),
                isNull(topicComments.moderatedAt),
              ),
            )
            .groupBy(topicComments.parentCommentId);

    const replyCountByRootId = new Map<string, number>();
    for (const row of replyCountRows) {
      if (row.parentCommentId) replyCountByRootId.set(row.parentCommentId, row.total);
    }

    return {
      items: roots.map((root) => ({ replyCount: replyCountByRootId.get(root.id) ?? 0, root })),
      nextCursor: hasMore
        ? encodeTopicCommentCursor(pageRows.at(-1)!.cursorCreatedAt, pageRows.at(-1)!.id)
        : null,
    };
  }

  /** Independently paginated replies for expanding or incrementally loading one thread. */
  async listReplies(
    params: ListTopicCommentRepliesParams,
    options: TopicCommentReadOptions = {},
  ): Promise<TopicCommentReplyPage> {
    const workspaceId = this.requireWorkspaceId();
    const { cursor, limit = 50, rootCommentId } = params;
    const conditions = [
      eq(topicComments.parentCommentId, rootCommentId),
      eq(topicComments.workspaceId, workspaceId),
    ];
    const moderatedReadCondition = this.moderatedReadCondition(options);
    if (moderatedReadCondition) conditions.push(moderatedReadCondition);

    const decodedCursor = decodeTopicCommentCursor(cursor);
    if (decodedCursor) {
      const cursorCreatedAt = sql`${decodedCursor.createdAt}::timestamptz`;
      conditions.push(
        or(
          gt(topicComments.createdAt, cursorCreatedAt),
          and(eq(topicComments.createdAt, cursorCreatedAt), gt(topicComments.id, decodedCursor.id)),
        )!,
      );
    }

    const [rows, total] = await Promise.all([
      this.db
        .select(topicCommentCursorSelection)
        .from(topicComments)
        .where(and(...conditions))
        .orderBy(asc(topicComments.createdAt), asc(topicComments.id))
        .limit(limit + 1),
      decodedCursor
        ? Promise.resolve(undefined)
        : this.db
            .select({ total: count() })
            .from(topicComments)
            .where(
              and(
                eq(topicComments.parentCommentId, rootCommentId),
                eq(topicComments.workspaceId, workspaceId),
                isNull(topicComments.deletedAt),
                isNull(topicComments.moderatedAt),
              ),
            )
            .then(([row]) => row.total),
    ]);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...item }) => item);

    return {
      items,
      nextCursor: hasMore
        ? encodeTopicCommentCursor(pageRows.at(-1)!.cursorCreatedAt, pageRows.at(-1)!.id)
        : null,
      ...(total === undefined ? {} : { total }),
    };
  }

  async summary(topicId: string): Promise<TopicCommentSummary> {
    const workspaceId = this.requireWorkspaceId();
    const scope = and(
      eq(topicComments.topicId, topicId),
      eq(topicComments.workspaceId, workspaceId),
    );

    const [totalRow] = await this.db
      .select({ total: count() })
      .from(topicComments)
      .where(and(scope, isNull(topicComments.deletedAt), isNull(topicComments.moderatedAt)));

    const byMessage = await this.db
      .select({ messageCount: count(), messageId: topicComments.messageId })
      .from(topicComments)
      .where(
        and(
          scope,
          isNotNull(topicComments.messageId),
          or(
            and(isNull(topicComments.deletedAt), isNull(topicComments.moderatedAt)),
            exists(
              this.db
                .select({ id: topicCommentChildren.id })
                .from(topicCommentChildren)
                .where(
                  and(
                    eq(topicCommentChildren.parentCommentId, topicComments.id),
                    isNull(topicCommentChildren.deletedAt),
                    isNull(topicCommentChildren.moderatedAt),
                  ),
                ),
            ),
          ),
        ),
      )
      .groupBy(topicComments.messageId);

    return {
      countByMessage: Object.fromEntries(
        byMessage.map((row) => [row.messageId as string, row.messageCount]),
      ),
      total: totalRow?.total ?? 0,
    };
  }

  async getMentions(commentId: string) {
    const workspaceId = this.requireWorkspaceId();

    return this.db
      .select()
      .from(topicCommentMentions)
      .where(
        and(
          eq(topicCommentMentions.commentId, commentId),
          eq(topicCommentMentions.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(topicCommentMentions.createdAt));
  }
}

/**
 * Permanently sanitize expired owner-moderated comments in a bounded batch.
 * Candidate rows are locked so a concurrent restore or reply creation cannot
 * race the destructive transition.
 */
export const purgeExpiredTopicCommentModeration = async (
  db: LobeChatDatabase,
  options: { limit?: number; now?: Date } = {},
): Promise<PurgeExpiredTopicCommentModerationResult> => {
  const { limit = 500, now = new Date() } = options;

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: topicComments.id,
        parentCommentId: topicComments.parentCommentId,
      })
      .from(topicComments)
      .where(
        and(
          isNotNull(topicComments.moderatedAt),
          lte(topicComments.moderationExpiresAt, now),
          isNull(topicComments.deletedAt),
        ),
      )
      .orderBy(asc(topicComments.moderationExpiresAt), asc(topicComments.id))
      .limit(limit)
      .for('update');

    if (candidates.length === 0)
      return { garbageCollected: 0, hardDeleted: 0, processed: 0, tombstoned: 0 };

    const candidateIds = candidates.map(({ id }) => id);
    const children = await tx
      .select({ parentCommentId: topicComments.parentCommentId })
      .from(topicComments)
      .where(inArray(topicComments.parentCommentId, candidateIds));
    const idsWithChildren = new Set(
      children.flatMap(({ parentCommentId }) => (parentCommentId ? [parentCommentId] : [])),
    );
    const tombstoneIds = candidateIds.filter((id) => idsWithChildren.has(id));
    const hardDeleteIds = candidateIds.filter((id) => !idsWithChildren.has(id));

    let tombstoned = 0;
    if (tombstoneIds.length > 0) {
      await tx
        .delete(topicCommentMentions)
        .where(inArray(topicCommentMentions.commentId, tombstoneIds));
      const rows = await tx
        .update(topicComments)
        .set({
          content: '',
          deletedAt: now,
          editorData: null,
          moderatedAt: null,
          moderatedByUserId: null,
          moderationExpiresAt: null,
        })
        .where(
          and(
            inArray(topicComments.id, tombstoneIds),
            isNotNull(topicComments.moderatedAt),
            lte(topicComments.moderationExpiresAt, now),
          ),
        )
        .returning({ id: topicComments.id });
      tombstoned = rows.length;
    }

    let hardDeleted = 0;
    if (hardDeleteIds.length > 0) {
      const rows = await tx
        .delete(topicComments)
        .where(
          and(
            inArray(topicComments.id, hardDeleteIds),
            isNotNull(topicComments.moderatedAt),
            lte(topicComments.moderationExpiresAt, now),
          ),
        )
        .returning({ id: topicComments.id });
      hardDeleted = rows.length;
    }

    // If a candidate child was the last row preserving a permanent root
    // tombstone, collect that now-empty root in the same transaction. A root
    // and its expired child can also both appear in this batch.
    const gcCandidateIds = [
      ...new Set([
        ...tombstoneIds,
        ...candidates.flatMap(({ parentCommentId }) => (parentCommentId ? [parentCommentId] : [])),
      ]),
    ];
    const garbageCollectedRows =
      gcCandidateIds.length === 0
        ? []
        : await tx
            .delete(topicComments)
            .where(
              and(
                inArray(topicComments.id, gcCandidateIds),
                isNotNull(topicComments.deletedAt),
                isNull(topicComments.moderatedAt),
                notExists(
                  tx
                    .select({ id: topicCommentChildren.id })
                    .from(topicCommentChildren)
                    .where(eq(topicCommentChildren.parentCommentId, topicComments.id)),
                ),
              ),
            )
            .returning({ id: topicComments.id });

    return {
      garbageCollected: garbageCollectedRows.length,
      hardDeleted,
      processed: candidates.length,
      tombstoned,
    };
  });
};

/**
 * Keeps the denormalized comment scope consistent when topics change
 * ownership. `AgentModel.transferAgent` and
 * `AgentGroupRepository.transferToWorkspace` rewrite `topics.workspaceId`
 * (including to NULL for personal scope); without this call the comments keep
 * the source workspaceId — destination-scoped reads lose them, source-scoped
 * reads keep leaking them, and deleting the source workspace cascades rows
 * that no longer belong to it. Must run inside the same transaction that
 * moves the topics.
 *
 * - Cross-workspace move: comments and mention rows follow the topic — they
 *   are part of its history, exactly like `messages`. Authors / mentioned
 *   users may not be members of the target workspace; that renders the same
 *   as any other non-member author (same class as a deactivated account).
 * - Move to personal scope: comments are deleted. Personal topics cannot be
 *   commented on by design and `workspaceId` is NOT NULL, so there is no
 *   representable state to keep. One DELETE removes roots and replies alike —
 *   parent and child rows die in the same statement, so the self-FK
 *   (NO ACTION) passes; mention rows go via ON DELETE CASCADE.
 */
export const syncTopicCommentsOnTopicTransfer = async (
  trx: Transaction,
  topicIds: string[],
  targetWorkspaceId: string | null,
): Promise<void> => {
  if (topicIds.length === 0) return;

  if (!targetWorkspaceId) {
    await trx.delete(topicComments).where(inArray(topicComments.topicId, topicIds));
    return;
  }

  await trx
    .update(topicComments)
    // Moving a comment is not an author edit. Explicitly preserve updatedAt to
    // bypass the schema's Drizzle $onUpdate hook.
    .set({ updatedAt: topicComments.updatedAt, workspaceId: targetWorkspaceId })
    .where(inArray(topicComments.topicId, topicIds));

  await trx
    .update(topicCommentMentions)
    .set({ workspaceId: targetWorkspaceId })
    .where(
      inArray(
        topicCommentMentions.commentId,
        trx
          .select({ id: topicComments.id })
          .from(topicComments)
          .where(inArray(topicComments.topicId, topicIds)),
      ),
    );
};

/**
 * Whether any comment on the given topics was authored by someone other than
 * `userId`. Transfer guards (`AgentModel.transferHasForeignRows`,
 * `AgentGroupRepository.transferHasForeignRows`) must include this check:
 * comments move — or die, when the target is personal scope — with their
 * topics (see {@link syncTopicCommentsOnTopicTransfer}), so a non-owner
 * member must not be able to rehome or destroy a teammate's comment just
 * because every other cascaded row happens to be their own.
 *
 * `topicWhere` is a predicate over the joined `topics` table selecting the
 * topics the transfer would move. NULL authors (account deleted) count as
 * foreign: the row is definitionally not the caller's, and SQL `ne()` would
 * silently skip it.
 */
export const hasForeignTopicComments = async (
  db: Pick<LobeChatDatabase, 'select'>,
  userId: string,
  topicWhere: SQL,
): Promise<boolean> => {
  const [foreign] = await db
    .select({ id: topicComments.id })
    .from(topicComments)
    .innerJoin(topics, eq(topicComments.topicId, topics.id))
    .where(
      and(
        topicWhere,
        or(ne(topicComments.authorUserId, userId), isNull(topicComments.authorUserId)),
      ),
    )
    .limit(1);

  return !!foreign;
};
