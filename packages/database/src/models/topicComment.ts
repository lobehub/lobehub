import { truncateSurrogateSafe } from '@lobechat/utils';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import { messages } from '../schemas/message';
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

/**
 * Anchor excerpts must be cut surrogate-safely: a lone surrogate left by a
 * mid-emoji `slice` would be escaped as an unpaired `\ud8xx` that PostgreSQL's
 * jsonb parser rejects, failing anchored-comment creation outright (see
 * `truncateSurrogateSafe`).
 */
const ANCHOR_PREVIEW_MAX_LENGTH = 200;

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
  /** Opaque value cursor over the ascending `(createdAt, id)` root order */
  cursor?: string;
  limit?: number;
  messageId?: string;
  topicId: string;
}

export interface TopicCommentReplyPage {
  items: TopicCommentItem[];
  nextCursor: string | null;
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

  async createWithMentions(params: CreateTopicCommentParams): Promise<CreateTopicCommentResult> {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      const [topic] = await tx
        .select({ id: topics.id, workspaceId: topics.workspaceId })
        .from(topics)
        .where(eq(topics.id, params.topicId))
        .limit(1);

      // Covers missing, cross-workspace and personal-mode (workspaceId NULL) topics
      if (!topic || topic.workspaceId !== workspaceId)
        throw new Error(TOPIC_COMMENT_TOPIC_NOT_FOUND);

      if (params.parentCommentId) {
        if (params.messageId) throw new Error(TOPIC_COMMENT_REPLY_CANNOT_ANCHOR);

        const [parent] = await tx
          .select({
            id: topicComments.id,
            parentCommentId: topicComments.parentCommentId,
            topicId: topicComments.topicId,
            workspaceId: topicComments.workspaceId,
          })
          .from(topicComments)
          .where(eq(topicComments.id, params.parentCommentId))
          .limit(1);

        // One message for missing / cross-topic / cross-workspace parents
        if (!parent || parent.workspaceId !== workspaceId || parent.topicId !== params.topicId)
          throw new Error(TOPIC_COMMENT_PARENT_NOT_FOUND);
        if (parent.parentCommentId) throw new Error(TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED);
      }

      let anchorPreview: TopicCommentAnchorPreview | undefined;
      if (params.messageId) {
        const [message] = await tx
          .select({
            content: messages.content,
            id: messages.id,
            role: messages.role,
            topicId: messages.topicId,
          })
          .from(messages)
          .where(eq(messages.id, params.messageId))
          .limit(1);

        if (!message || message.topicId !== params.topicId)
          throw new Error(TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC);

        anchorPreview = {
          excerpt: truncateSurrogateSafe(message.content ?? '', ANCHOR_PREVIEW_MAX_LENGTH),
          role: message.role,
        };
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

        return { addedMentionUserIds: [], comment: existing, isDuplicate: true };
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

      return { addedMentionUserIds: mentionedUserIds, comment: inserted, isDuplicate: false };
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
      const conditions = [eq(topicComments.id, id), eq(topicComments.workspaceId, workspaceId)];
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

      const [liveReplies] = await tx
        .select({ total: count() })
        .from(topicComments)
        .where(and(eq(topicComments.parentCommentId, id), isNull(topicComments.deletedAt)));

      if ((liveReplies?.total ?? 0) > 0) {
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
            .where(
              and(eq(topicComments.parentCommentId, parent.id), isNull(topicComments.deletedAt)),
            );

          if ((siblings?.total ?? 0) === 0)
            await tx.delete(topicComments).where(eq(topicComments.id, parent.id));
        }
      }

      return 'hard';
    });
  }

  async findById(id: string): Promise<TopicCommentItem | undefined> {
    const workspaceId = this.requireWorkspaceId();

    const [comment] = await this.db
      .select()
      .from(topicComments)
      .where(and(eq(topicComments.id, id), eq(topicComments.workspaceId, workspaceId)))
      .limit(1);

    return comment;
  }

  /**
   * Root-thread page ordered by `(createdAt, id)`, with live-reply counts loaded
   * in one bounded group-by query. Reply bodies are deliberately omitted and
   * paged only through `listReplies`, so one hot thread cannot make this response
   * grow without bound. Tombstoned roots remain visible while their replies live.
   */
  async listThreads(params: ListTopicCommentThreadsParams): Promise<TopicCommentThreadPage> {
    const workspaceId = this.requireWorkspaceId();
    const { cursor, limit = 20, messageId, topicId } = params;

    const rootConditions = [
      eq(topicComments.topicId, topicId),
      eq(topicComments.workspaceId, workspaceId),
      isNull(topicComments.parentCommentId),
    ];
    if (messageId !== undefined) rootConditions.push(eq(topicComments.messageId, messageId));

    const decodedCursor = decodeTopicCommentCursor(cursor);
    if (decodedCursor) {
      const cursorCreatedAt = sql`${decodedCursor.createdAt}::timestamptz`;
      rootConditions.push(
        or(
          gt(topicComments.createdAt, cursorCreatedAt),
          and(eq(topicComments.createdAt, cursorCreatedAt), gt(topicComments.id, decodedCursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select(topicCommentCursorSelection)
      .from(topicComments)
      .where(and(...rootConditions))
      .orderBy(asc(topicComments.createdAt), asc(topicComments.id))
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
  async listReplies(params: ListTopicCommentRepliesParams): Promise<TopicCommentReplyPage> {
    const workspaceId = this.requireWorkspaceId();
    const { cursor, limit = 50, rootCommentId } = params;
    const conditions = [
      eq(topicComments.parentCommentId, rootCommentId),
      eq(topicComments.workspaceId, workspaceId),
    ];

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

    const rows = await this.db
      .select(topicCommentCursorSelection)
      .from(topicComments)
      .where(and(...conditions))
      .orderBy(asc(topicComments.createdAt), asc(topicComments.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...item }) => item);

    return {
      items,
      nextCursor: hasMore
        ? encodeTopicCommentCursor(pageRows.at(-1)!.cursorCreatedAt, pageRows.at(-1)!.id)
        : null,
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
      .where(and(scope, isNull(topicComments.deletedAt)));

    const byMessage = await this.db
      .select({ messageCount: count(), messageId: topicComments.messageId })
      .from(topicComments)
      .where(and(scope, isNotNull(topicComments.messageId)))
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
    .set({ workspaceId: targetWorkspaceId })
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
  db: LobeChatDatabase,
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
