import type { DocumentCommentJson } from '@lobechat/types';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { documents } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Human collaboration comments attached to Workspace documents. These rows are
 * deliberately separate from document content and never enter retrieval or an
 * agent's context.
 */
export const documentComments = pgTable(
  'document_comments',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    /** Thread root. Every reply in a thread points directly to the root. */
    parentCommentId: uuid('parent_comment_id').references((): AnyPgColumn => documentComments.id),
    /** Direct reply target when replying to another reply; null for roots and direct replies. */
    replyToCommentId: uuid('reply_to_comment_id').references(
      (): AnyPgColumn => documentComments.id,
      { onDelete: 'set null' },
    ),
    /** Kept nullable so comments survive account deletion as Workspace assets. */
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    content: text('content').notNull(),
    editorData: jsonb('editor_data').$type<DocumentCommentJson>(),
    /** Client-generated idempotency key for retried creates. */
    clientId: text('client_id').notNull(),
    /** Tombstone retained only while a deleted root still has replies. */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('document_comments_document_id_author_user_id_client_id_unique').on(
      t.documentId,
      t.authorUserId,
      t.clientId,
    ),
    index('document_comments_parent_comment_id_created_at_id_idx').on(
      t.parentCommentId,
      t.createdAt,
      t.id,
    ),
    index('document_comments_reply_to_comment_id_idx').on(t.replyToCommentId),
    index('document_comments_document_id_created_at_id_idx').on(t.documentId, t.createdAt, t.id),
    index('document_comments_author_user_id_idx').on(t.authorUserId),
    index('document_comments_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewDocumentComment = typeof documentComments.$inferInsert;
export type DocumentCommentItem = typeof documentComments.$inferSelect;

/**
 * Validated Workspace member mentions extracted from a document comment's
 * editorData. The JSON remains the rich-text render source; these rows are the
 * trusted relational source for notification diffs and future mention queries.
 */
export const documentCommentMentions = pgTable(
  'document_comment_mentions',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    commentId: uuid('comment_id')
      .references(() => documentComments.id, { onDelete: 'cascade' })
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
    uniqueIndex('document_comment_mentions_comment_id_mentioned_user_id_unique').on(
      t.commentId,
      t.mentionedUserId,
    ),
    index('document_comment_mentions_mentioned_user_id_created_at_idx').on(
      t.mentionedUserId,
      t.createdAt,
    ),
    index('document_comment_mentions_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewDocumentCommentMention = typeof documentCommentMentions.$inferInsert;
export type DocumentCommentMentionItem = typeof documentCommentMentions.$inferSelect;
