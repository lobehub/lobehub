/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { isNotNull } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import type { LobeDocumentPage } from '@/types/document';
import type { FileSource } from '@/types/files';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { accessedAt, createdAt, timestamps } from './_helpers';
import { asyncTasks } from './asyncTask';
import { users } from './user';

export const globalFiles = pgTable(
  'global_files',
  {
    hashId: varchar('hash_id', { length: 64 }).primaryKey(),
    fileType: varchar('file_type', { length: 255 }).notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    metadata: jsonb('metadata'),
    creator: text('creator')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),
    createdAt: createdAt(),
    accessedAt: accessedAt(),
  },
  (t) => [index('global_files_creator_idx').on(t.creator)],
);

export type NewGlobalFile = typeof globalFiles.$inferInsert;
export type GlobalFileItem = typeof globalFiles.$inferSelect;

/**
 * Documents table - Stores file content or web search results
 */
export const documents = pgTable(
  'documents',
  {
    id: varchar('id', { length: 255 })
      .$defaultFn(() => idGenerator('documents', 16))
      .primaryKey(),

    // Basic information
    title: text('title'),
    description: text('description'),
    content: text('content'),

    // Special type: custom/folder
    fileType: varchar('file_type', { length: 255 }).notNull(),
    filename: text('filename'),

    // Statistics
    totalCharCount: integer('total_char_count').notNull(),
    totalLineCount: integer('total_line_count').notNull(),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, any>>(),

    // Page/chunk data
    pages: jsonb('pages').$type<LobeDocumentPage[]>(),

    // Source type
    sourceType: text('source_type', { enum: ['file', 'web', 'api', 'topic'] }).notNull(),
    source: text('source').notNull(), // File path or web URL

    // Associated file (optional)
    // forward reference needs AnyPgColumn to avoid circular type inference

    fileId: text('file_id').references((): AnyPgColumn => files.id, { onDelete: 'set null' }),

    knowledgeBaseId: text('knowledge_base_id').references(() => knowledgeBases.id, {
      onDelete: 'set null',
    }),

    // Parent document (for folder hierarchy structure)
    parentId: varchar('parent_id', { length: 255 }).references((): AnyPgColumn => documents.id, {
      onDelete: 'set null',
    }),

    // User association
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),

    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    slug: varchar('slug', { length: 255 }).$defaultFn(() => randomSlug(3)),

    // Timestamps
    ...timestamps,
  },
  (table) => [
    index('documents_source_idx').on(table.source),
    index('documents_file_type_idx').on(table.fileType),
    index('documents_source_type_idx').on(table.sourceType),
    index('documents_user_id_idx').on(table.userId),
    index('documents_file_id_idx').on(table.fileId),
    index('documents_parent_id_idx').on(table.parentId),
    index('documents_knowledge_base_id_idx').on(table.knowledgeBaseId),
    uniqueIndex('documents_client_id_user_id_unique').on(table.clientId, table.userId),
    uniqueIndex('documents_slug_user_id_unique')
      .on(table.slug, table.userId)
      .where(isNotNull(table.slug)),
  ],
);

export type NewDocument = typeof documents.$inferInsert;
export type DocumentItem = typeof documents.$inferSelect;
export const insertDocumentSchema = createInsertSchema(documents);

export const files = pgTable(
  'files',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('files'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * mime
     */
    fileType: varchar('file_type', { length: 255 }).notNull(),
    /**
     * sha256
     */
    fileHash: varchar('file_hash', { length: 64 }).references(() => globalFiles.hashId, {
      onDelete: 'no action',
    }),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    source: text('source').$type<FileSource>(),

    // Parent Folder or Document
    parentId: varchar('parent_id', { length: 255 }).references((): AnyPgColumn => documents.id, {
      onDelete: 'set null',
    }),

    clientId: text('client_id'),
    metadata: jsonb('metadata'),
    chunkTaskId: uuid('chunk_task_id').references(() => asyncTasks.id, { onDelete: 'set null' }),
    embeddingTaskId: uuid('embedding_task_id').references(() => asyncTasks.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (table) => {
    return {
      fileHashIdx: index('file_hash_idx').on(table.fileHash),
      userIdIdx: index('files_user_id_idx').on(table.userId),
      parentIdIdx: index('files_parent_id_idx').on(table.parentId),
      chunkTaskIdIdx: index('files_chunk_task_id_idx').on(table.chunkTaskId),
      embeddingTaskIdIdx: index('files_embedding_task_id_idx').on(table.embeddingTaskId),
      clientIdUnique: uniqueIndex('files_client_id_user_id_unique').on(
        table.clientId,
        table.userId,
      ),
    };
  },
);
export type NewFile = typeof files.$inferInsert;
export type FileItem = typeof files.$inferSelect;

export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('knowledgeBases'))
      .primaryKey(),

    name: text('name').notNull(),
    description: text('description'),
    avatar: text('avatar'),

    // different types of knowledge bases need to be distinguished
    type: text('type'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),

    isPublic: boolean('is_public').default(false),

    settings: jsonb('settings'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('knowledge_bases_client_id_user_id_unique').on(t.clientId, t.userId),
    index('knowledge_bases_user_id_idx').on(t.userId),
  ],
);

export const insertKnowledgeBasesSchema = createInsertSchema(knowledgeBases);

export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert;
export type KnowledgeBaseItem = typeof knowledgeBases.$inferSelect;

export const knowledgeBaseFiles = pgTable(
  'knowledge_base_files',
  {
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),

    fileId: text('file_id')
      .references(() => files.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.knowledgeBaseId, t.fileId] }),
    index('knowledge_base_files_kb_id_idx').on(t.knowledgeBaseId),
    index('knowledge_base_files_user_id_idx').on(t.userId),
    index('knowledge_base_files_file_id_idx').on(t.fileId),
  ],
);
