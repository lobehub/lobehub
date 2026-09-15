import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';
import { documents } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Lightweight appreciation reactions on Workspace documents. One row per
 * (document, user); the row disappears when the like is withdrawn, so the
 * table never enters retrieval or an agent's context.
 */
export const documentLikes = pgTable(
  'document_likes',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('document_likes_document_id_user_id_unique').on(t.documentId, t.userId),
    index('document_likes_document_id_created_at_idx').on(t.documentId, t.createdAt),
    index('document_likes_user_id_idx').on(t.userId),
    index('document_likes_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewDocumentLike = typeof documentLikes.$inferInsert;
export type DocumentLikeItem = typeof documentLikes.$inferSelect;
