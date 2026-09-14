import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { createdAt, updatedAt, varchar255 } from './_helpers';
import { documents } from './file';
import { users } from './user';

/** States understood by the editor annotation repository plus its tombstone. */
export const DOCUMENT_ANNOTATION_STATUSES = ['active', 'resolved', 'orphaned', 'deleted'] as const;

export type DocumentAnnotationStatus = (typeof DOCUMENT_ANNOTATION_STATUSES)[number];

/**
 * Opaque anchor data owned by the editor integration. `nodeKeys` is the
 * current Lexical anchor projection; future integrations may add a stable
 * text selector or block id without another database migration.
 */
export interface DocumentAnnotationAnchorMetadata {
  [key: string]: unknown;
  nodeKeys?: string[];
}

/**
 * Standalone document comments. The document row remains the source of truth
 * for visibility/ACL; this table deliberately does not copy workspace scope.
 * `version` is a per-annotation optimistic-concurrency token and is bumped on
 * every material update, including a soft delete.
 */
export const documentAnnotations = pgTable(
  'document_annotations',
  {
    id: varchar255('id')
      .primaryKey()
      .$defaultFn(() => createNanoId(18)())
      .notNull(),

    documentId: varchar255('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Optional author snapshot retained for clients that render profile data offline. */
    author: jsonb('author'),
    kind: text('kind').default('comment').notNull(),
    payload: jsonb('payload'),
    quotedText: text('quoted_text').default('').notNull(),
    status: text('status', { enum: DOCUMENT_ANNOTATION_STATUSES }).default('active').notNull(),
    anchorMetadata: jsonb('anchor_metadata').$type<DocumentAnnotationAnchorMetadata | null>(),

    version: integer('version').default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The primary key makes ids globally unique; retain the document-scoped
    // unique key as an explicit invariant for scoped upserts and migrations.
    uniqueIndex('document_annotations_document_id_id_unique').on(table.documentId, table.id),
    index('document_annotations_document_id_created_at_id_idx').on(
      table.documentId,
      table.createdAt,
      table.id,
    ),
    index('document_annotations_document_id_status_idx').on(table.documentId, table.status),
    index('document_annotations_user_id_idx').on(table.userId),
    check(
      'document_annotations_status_check',
      sql`${table.status} IN ('active', 'resolved', 'orphaned', 'deleted')`,
    ),
    check('document_annotations_version_positive', sql`${table.version} > 0`),
  ],
);

export type NewDocumentAnnotation = typeof documentAnnotations.$inferInsert;
export type DocumentAnnotationItem = typeof documentAnnotations.$inferSelect;
