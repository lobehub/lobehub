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
    index('search_sync_outbox_dead_idx')
      .on(table.deadAt)
      .where(sql`${table.deadAt} IS NOT NULL`),
    index('search_sync_outbox_lease_idx')
      .on(table.lockedUntil)
      .where(sql`${table.deadAt} IS NULL AND ${table.lockedUntil} IS NOT NULL`),
  ],
);

export type SearchSyncOutboxItem = typeof searchSyncOutbox.$inferSelect;
