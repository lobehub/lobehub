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
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { LobeDocumentPage } from '@/types/document';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps } from './_helpers';
import { files } from './file';
import { chunks } from './rag';
import { users } from './user';

/**
 * 文档表 - 存储文件内容或网页搜索结果
 */
export const documents = pgTable(
  'documents',
  {
    id: varchar('id', { length: 30 })
      .$defaultFn(() => idGenerator('documents', 16))
      .primaryKey(),

    // 基本信息
    title: text('title'),
    content: text('content'),
    fileType: varchar('file_type', { length: 255 }).notNull(),
    filename: text('filename'),

    // 统计信息
    totalCharCount: integer('total_char_count').notNull(),
    totalLineCount: integer('total_line_count').notNull(),

    // 元数据
    metadata: jsonb('metadata').$type<Record<string, any>>(),

    // 页面/块数据
    pages: jsonb('pages').$type<LobeDocumentPage[]>(),

    // 来源类型
    sourceType: text('source_type', { enum: ['file', 'web', 'api'] }).notNull(),
    source: text('source').notNull(), // 文件路径或网页URL

    // 关联文件（可选）
    fileId: text('file_id').references(() => files.id, { onDelete: 'set null' }),

    // 用户关联
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),

    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    // 时间戳
    ...timestamps,
  },
  (table) => [
    index('documents_source_idx').on(table.source),
    index('documents_file_type_idx').on(table.fileType),
    index('documents_file_id_idx').on(table.fileId),
    uniqueIndex('documents_client_id_user_id_unique').on(table.clientId, table.userId),
  ],
);

export type NewDocument = typeof documents.$inferInsert;
export type DocumentItem = typeof documents.$inferSelect;
export const insertDocumentSchema = createInsertSchema(documents);

/**
 * 文档块表 - 将文档内容分割成块并关联到 chunks 表，用于向量检索
 * 注意：此表可选，如果已经使用 pages 字段存储了文档块，可以不需要此表
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
  (t) => [primaryKey({ columns: [t.documentId, t.chunkId] })],
);

export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type DocumentChunkItem = typeof documentChunks.$inferSelect;
