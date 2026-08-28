import type {
  SearchDocumentEntity,
  SearchReindexEntityStatus,
  SearchReindexRunStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgSequence,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';

export const searchSyncRevisionSequence = pgSequence('search_sync_revision_seq');

/** Opt-in switch for installations that run a search-sync outbox consumer. */
export const searchSyncSettings = pgTable(
  'search_sync_settings',
  {
    createdAt: createdAt(),
    enabled: boolean('enabled').notNull().default(false),
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().default('default'),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('search_sync_settings_key_unique').on(table.key)],
);

/** Durable, coalescing queue for asynchronously refreshing search projections. */
export const searchSyncOutbox = pgTable(
  'search_sync_outbox',
  {
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamptz('available_at').notNull().defaultNow(),
    createdAt: createdAt(),
    deadAt: timestamptz('dead_at'),
    documentId: text('document_id').notNull(),
    entity: text('entity').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    lastError: text('last_error'),
    lockedUntil: timestamptz('locked_until'),
    priority: smallint('priority').notNull().default(10),
    revision: bigint('revision', { mode: 'number' })
      .notNull()
      .default(sql`nextval('search_sync_revision_seq')`),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('search_sync_outbox_entity_document_id_unique').on(table.entity, table.documentId),
    index('search_sync_outbox_claim_idx')
      .on(table.priority, table.availableAt, table.revision)
      .where(sql`${table.deadAt} IS NULL`),
    index('search_sync_outbox_lease_idx')
      .on(table.lockedUntil)
      .where(sql`${table.deadAt} IS NULL AND ${table.lockedUntil} IS NOT NULL`),
  ],
);

/** One durable full-reindex attempt for a deployment-owned Elasticsearch namespace. */
export const searchReindexRuns = pgTable(
  'search_reindex_runs',
  {
    aliasesCreatedAt: timestamptz('aliases_created_at'),
    baseRevision: bigint('base_revision', { mode: 'number' }).notNull(),
    /**
     * Highest allocated Outbox revision observed after backfill. Sequence allocation is not a
     * committed snapshot boundary, so consumers must never discard rows at or below this value.
     */
    backfillHighWaterRevision: bigint('backfill_high_water_revision', { mode: 'number' }),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    lastError: text('last_error'),
    namespace: text('namespace').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    status: text('status').$type<SearchReindexRunStatus>().notNull().default('backfilling'),
    updatedAt: updatedAt(),
  },
  (table) => [index('search_reindex_runs_namespace_status_idx').on(table.namespace, table.status)],
);

/** Per-entity keyset cursor and counters used to resume a full reindex safely. */
export const searchReindexEntityProgress = pgTable(
  'search_reindex_entity_progress',
  {
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    cursor: text('cursor'),
    entity: text('entity').$type<SearchDocumentEntity>().notNull(),
    failedCount: integer('failed_count').notNull().default(0),
    id: uuid('id').primaryKey().defaultRandom(),
    indexedCount: bigint('indexed_count', { mode: 'number' }).notNull().default(0),
    physicalIndex: text('physical_index').notNull(),
    processedCount: bigint('processed_count', { mode: 'number' }).notNull().default(0),
    runId: uuid('run_id')
      .references(() => searchReindexRuns.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').$type<SearchReindexEntityStatus>().notNull().default('pending'),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('search_reindex_entity_progress_run_id_entity_unique').on(
      table.runId,
      table.entity,
    ),
    index('search_reindex_entity_progress_run_id_status_idx').on(table.runId, table.status),
  ],
);

/** Replayable item-level failures that must be resolved before aliases can be created. */
export const searchReindexFailures = pgTable(
  'search_reindex_failures',
  {
    attempts: integer('attempts').notNull().default(1),
    createdAt: createdAt(),
    documentId: text('document_id').notNull(),
    entity: text('entity').$type<SearchDocumentEntity>().notNull(),
    error: text('error').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    resolvedAt: timestamptz('resolved_at'),
    retryable: boolean('retryable').notNull().default(true),
    runId: uuid('run_id')
      .references(() => searchReindexRuns.id, { onDelete: 'cascade' })
      .notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('search_reindex_failures_run_id_entity_document_id_unique').on(
      table.runId,
      table.entity,
      table.documentId,
    ),
    index('search_reindex_failures_run_id_resolved_at_idx').on(table.runId, table.resolvedAt),
  ],
);

export type SearchSyncOutboxItem = typeof searchSyncOutbox.$inferSelect;
export type SearchReindexRun = typeof searchReindexRuns.$inferSelect;
export type SearchReindexEntityProgress = typeof searchReindexEntityProgress.$inferSelect;
export type SearchReindexFailure = typeof searchReindexFailures.$inferSelect;
