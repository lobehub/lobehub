import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { messages } from './message';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Anchor snapshot captured server-side when a message-anchored comment is
 * created. Messages are hard-deleted (no tombstones anywhere in the domain),
 * so this snapshot is the only way to keep rendering the comment's context
 * after its anchor message is gone.
 */
export interface TopicCommentAnchorPreview {
  /** Truncated plain-text excerpt of the anchored message */
  excerpt: string;
  /** Message role at snapshot time, e.g. 'user' | 'assistant' */
  role?: string;
}

/**
 * Human collaboration comments on workspace topics. Deliberately NOT messages:
 * rows here never enter the LLM context, token roll-ups, or the message tree
 * (message deletion re-parents children, which would silently re-anchor
 * comments if they lived on `messages.parentId`).
 *
 * Workspace-only feature: `workspaceId` is NOT NULL and must be copied from
 * the parent topic's `workspaceId` inside the create transaction — never from
 * the request header or client input. Personal-mode topics
 * (`topics.workspaceId IS NULL`) cannot be commented on.
 *
 * Invariant: `anchorPreview` is set iff the comment was created anchored to a
 * message, so `(messageId IS NULL AND anchorPreview IS NOT NULL)` means "the
 * anchor message has been deleted" while `messageId IS NULL AND anchorPreview
 * IS NULL` means "comment on the whole topic". The "anchored ⇒ preview" half
 * is enforced by a CHECK below; the other half can't be (the orphaned state is
 * legal), so creation code must never write a preview for topic-level rows.
 *
 * The denormalized `workspaceId` must follow the topic when it changes scope.
 * Any code path that moves a topic must move this column and its mention rows
 * in the same transaction, or delete the comments when the topic leaves
 * workspace scope. Otherwise workspace-filtered queries silently lose the
 * rows while source-scoped reads keep exposing them.
 *
 * anchorPreview retention is deliberate: deleting a message does NOT purge its
 * excerpt from comments that quoted it (same semantics as a teammate quoting
 * you before you retract). Any future compliance-grade erasure tooling must
 * sweep `anchorPreview` as well.
 *
 * Threading (single level): `parentCommentId` points at a top-level comment —
 * replies to replies are rejected at the model layer, and a reply never
 * carries its own anchor (the thread's anchor lives on the root row; CHECK
 * below). Deleting a root that still has live replies must NOT destroy them
 * (they are other people's work): the row is soft-deleted instead — content
 * blanked, mentions dropped, `deletedAt` stamped — and rendered as a
 * placeholder. Hard delete stays the norm for reply-less comments, and a
 * tombstone is garbage-collected when its last reply goes, so a soft-deleted
 * row exists iff it still has live replies. The self-FK deliberately has NO
 * delete action: the DB itself rejects hard-deleting a parent with replies
 * (defense in depth), while whole-topic cascades still pass because parent and
 * children die in the same statement.
 *
 * Workspace-owner moderation is intentionally separate from `deletedAt`.
 * Removing another user's comment retains its content for a bounded recovery
 * window; read APIs must redact that retained content for every non-owner.
 * Once the window expires, a cleanup job either hard-deletes the row or turns
 * a root with replies into the same irreversible tombstone described above.
 */
export const topicComments = pgTable(
  'topic_comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('topicComments'))
      .notNull(),
    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),
    /** NULL = comment on the whole topic, or the anchor message was deleted (see anchorPreview) */
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    /**
     * Thread root this row replies to; NULL = top-level comment. Single-level
     * only (the parent must itself be top-level). No delete action on purpose —
     * see the table doc.
     */
    parentCommentId: text('parent_comment_id').references((): AnyPgColumn => topicComments.id),
    /**
     * Tombstone on account deletion (nullable + SET NULL, matching
     * taskComments): this table is workspace-only, so every row is a team
     * asset, and member *removal* already keeps comments (removal soft-deletes
     * the membership row — no FK here ever fires). Cascading on the rarer
     * account deletion would make the two "person left" paths behave
     * oppositely. NULL renders as a deactivated-user placeholder; author-scoped
     * WHERE clauses never match NULL, so orphaned rows can only be deleted via
     * the owner-level delete override (edits have no override by design). Note
     * this only protects against the *author* leaving — if the topic creator's
     * account is deleted, the topic cascade still removes every comment on it.
     */
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    content: text('content').notNull(),
    /** Lexical editor JSON. Opaque to the database; size-capped at the router layer. */
    editorData: jsonb('editor_data'),
    /** Client-generated idempotency key: retried creates with the same key return the existing row */
    clientId: text('client_id').notNull(),
    anchorPreview: jsonb('anchor_preview').$type<TopicCommentAnchorPreview>(),

    /**
     * Tombstone-with-replies marker. Set ONLY when a comment is deleted while
     * structural replies exist (content/editorData blanked, mentions dropped in the
     * same transaction); the anchor fields stay so the thread keeps its anchor.
     * Reply-less deletes stay hard, and the tombstone is GC'd with its last
     * reply — so `deletedAt IS NOT NULL` implies structural replies exist. A
     * reply can itself be temporarily hidden by recoverable moderation.
     */
    deletedAt: timestamptz('deleted_at'),

    /** Recoverable removal by a workspace owner; NULL for active/permanent tombstone rows. */
    moderatedAt: timestamptz('moderated_at'),
    /**
     * Acting owner, retained for moderation audit correlation only. Ordinary
     * Topic Comment DTOs must never expose this identity. SET NULL keeps the
     * recovery state valid if that owner's account is later deleted.
     */
    moderatedByUserId: text('moderated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** End of the owner-moderation recovery window. */
    moderationExpiresAt: timestamptz('moderation_expires_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Idempotency is scoped to one author's sends within a topic. The same
    // clientId may be reused by another author or in another topic. Rows whose
    // author account was deleted (authorUserId NULL) drop out of the index —
    // Postgres treats NULLs as distinct — which is harmless: a deleted account
    // can never retry a create.
    uniqueIndex('topic_comments_topic_id_author_user_id_client_id_unique').on(
      t.topicId,
      t.authorUserId,
      t.clientId,
    ),
    // Write-time guard for the "anchored ⇒ preview" invariant: a
    // message-anchored comment must carry its server-side snapshot, or the
    // comment loses all context once the (hard-deleted, hook-less) message
    // goes away. Same shape as verify_runs_acceptance_requires_round.
    check(
      'topic_comments_anchored_requires_preview',
      sql`${t.messageId} IS NULL OR ${t.anchorPreview} IS NOT NULL`,
    ),
    // A reply never carries its own anchor — the thread's anchor lives on the
    // root row. Keeps per-message badge counts equal to thread counts for free.
    check(
      'topic_comments_reply_has_no_anchor',
      sql`${t.parentCommentId} IS NULL OR (${t.messageId} IS NULL AND ${t.anchorPreview} IS NULL)`,
    ),
    check(
      'topic_comments_moderation_window_consistent',
      sql`(${t.moderatedAt} IS NULL) = (${t.moderationExpiresAt} IS NULL)`,
    ),
    check(
      'topic_comments_deleted_not_recoverable',
      sql`${t.deletedAt} IS NULL OR ${t.moderatedAt} IS NULL`,
    ),
    // Reply pagination + live-reply counts + self-FK maintenance
    index('topic_comments_parent_comment_id_created_at_id_idx').on(
      t.parentCommentId,
      t.createdAt,
      t.id,
    ),
    // Composite cursor pagination over a topic's root threads
    index('topic_comments_topic_id_created_at_id_idx').on(t.topicId, t.createdAt, t.id),
    // summary({ topicId }) group-by messageId without heap fetches
    index('topic_comments_topic_id_message_id_idx').on(t.topicId, t.messageId),
    // ON DELETE SET NULL maintenance path
    index('topic_comments_message_id_idx').on(t.messageId),
    index('topic_comments_author_user_id_idx').on(t.authorUserId),
    index('topic_comments_moderation_expires_at_idx').on(t.moderationExpiresAt),
    index('topic_comments_moderated_by_user_id_idx').on(t.moderatedByUserId),
    index('topic_comments_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewTopicComment = typeof topicComments.$inferInsert;
export type TopicCommentItem = typeof topicComments.$inferSelect;

/**
 * Mention rows are the single source of truth for who a comment mentions —
 * mention metadata inside `editorData` is untrusted client input and must be
 * re-validated against active workspace membership before rows land here.
 *
 * Read only via the parent comment (join / commentId filter); this table
 * carries no creator userId on purpose and must never be ownership-filtered
 * on its own.
 */
export const topicCommentMentions = pgTable(
  'topic_comment_mentions',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    commentId: text('comment_id')
      .references(() => topicComments.id, { onDelete: 'cascade' })
      .notNull(),
    mentionedUserId: text('mentioned_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('topic_comment_mentions_comment_id_mentioned_user_id_unique').on(
      t.commentId,
      t.mentionedUserId,
    ),
    // Future "mentions of me" reads
    index('topic_comment_mentions_mentioned_user_id_created_at_idx').on(
      t.mentionedUserId,
      t.createdAt,
    ),
    index('topic_comment_mentions_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewTopicCommentMention = typeof topicCommentMentions.$inferInsert;
export type TopicCommentMentionItem = typeof topicCommentMentions.$inferSelect;
