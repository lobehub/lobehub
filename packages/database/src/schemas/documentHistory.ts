import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamptz, varchar255 } from './_helpers';
import { documents } from './file';
import { users } from './user';

export const documentHistories = pgTable(
  'document_histories',
  {
    id: varchar255('id')
      .$defaultFn(() => createNanoId(18)())
      .primaryKey(),

    documentId: varchar255('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    editorData: jsonb('editor_data').$type<Record<string, any>>().notNull(),
    saveSource: text('save_source', {
      enum: ['autosave', 'manual', 'restore', 'system', 'llm_call'],
    }).notNull(),
    savedAt: timestamptz('saved_at').notNull(),
  },
  (table) => [
    index('document_histories_document_id_idx').on(table.documentId),
    index('document_histories_user_id_idx').on(table.userId),
    index('document_histories_saved_at_idx').on(table.savedAt),
  ],
);

export type DocumentHistoryItem = typeof documentHistories.$inferSelect;
export type NewDocumentHistory = typeof documentHistories.$inferInsert;
