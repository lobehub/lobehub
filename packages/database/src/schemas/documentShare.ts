import { index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { documents } from './file';
import { users } from './user';
import { workspaces } from './workspace';

export const documentShares = pgTable(
  'document_shares',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    documentId: varchar('document_id', { length: 255 })
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    visibility: text('visibility').default('private').notNull(),
    permission: text('permission').default('read').notNull(),

    pageViewCount: integer('page_view_count').default(0).notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('document_shares_document_id_unique').on(t.documentId),
    index('document_shares_user_id_idx').on(t.userId),
  ],
);

export type NewDocumentShare = typeof documentShares.$inferInsert;
export type DocumentShareItem = typeof documentShares.$inferSelect;
