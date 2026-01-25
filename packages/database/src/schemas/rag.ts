/* eslint-disable sort-keys-fix/sort-keys-fix  */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamps } from './_helpers';
import { documents, files } from './file';
import { users } from './user';

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    text: text('text'),
    abstract: text('abstract'),
    metadata: jsonb('metadata'),
    index: integer('index'),
    type: varchar('type'),

    clientId: text('client_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('chunks_client_id_user_id_unique').on(t.clientId, t.userId),
    index('chunks_user_id_idx').on(t.userId),
  ],
);

export type NewChunkItem = typeof chunks.$inferInsert & { fileId?: string };

export const unstructuredChunks = pgTable(
  'unstructured_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    text: text('text'),
    metadata: jsonb('metadata'),
    index: integer('index'),
    type: varchar('type'),

    ...timestamps,

    parentId: varchar('parent_id'),
    compositeId: uuid('composite_id').references(() => chunks.id, { onDelete: 'cascade' }),
    clientId: text('client_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    fileId: varchar('file_id').references(() => files.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    clientIdUnique: uniqueIndex('unstructured_chunks_client_id_user_id_unique').on(
      t.clientId,
      t.userId,
    ),
    userIdIdx: index('unstructured_chunks_user_id_idx').on(t.userId),
    compositeIdIdx: index('unstructured_chunks_composite_id_idx').on(t.compositeId),
    fileIdIdx: index('unstructured_chunks_file_id_idx').on(t.fileId),
  }),
);

export type NewUnstructuredChunkItem = typeof unstructuredChunks.$inferInsert;

export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chunkId: uuid('chunk_id')
      .references(() => chunks.id, { onDelete: 'cascade' })
      .unique(),
    embeddings: vector('embeddings', { dimensions: 1024 }),
    model: text('model'),
    clientId: text('client_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('embeddings_client_id_user_id_unique').on(t.clientId, t.userId),
    // improve delete embeddings query
    index('embeddings_chunk_id_idx').on(t.chunkId),
    index('embeddings_user_id_idx').on(t.userId),
  ],
);

export type NewEmbeddingsItem = typeof embeddings.$inferInsert;
export type EmbeddingsSelectItem = typeof embeddings.$inferSelect;

/**
 * Document chunks table - Splits document content into chunks and associates them with the chunks table for vector retrieval
 * Note: This table is optional, if the pages field is already being used to store document chunks, this table may not be needed
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    documentId: varchar('document_id', { length: 30 })
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),

    chunkId: uuid('chunk_id')
      .references(() => chunks.id, { onDelete: 'cascade' })
      .notNull(),

    pageIndex: integer('page_index'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.chunkId] }),
    index('document_chunks_document_id_idx').on(t.documentId),
    index('document_chunks_chunk_id_idx').on(t.chunkId),
    index('document_chunks_user_id_idx').on(t.userId),
  ],
);

export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type DocumentChunkItem = typeof documentChunks.$inferSelect;
