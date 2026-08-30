import type { SearchDocumentEntity } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  bigint,
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

/** Monotonic version source shared by capture triggers, reindex fences, and Outbox work. */
export const searchSyncRevisionSequence = pgSequence('search_sync_revision_seq');

/** Durable, coalescing queue for asynchronously refreshing search projections. */
export const searchSyncOutbox = pgTable(
  'search_sync_outbox',
  {
    /** Failed claims for the current revision; a newer captured change resets this to zero. */
    attempts: integer('attempts').notNull().default(0),
    /** Earliest time a worker may claim this row, including retry backoff delays. */
    availableAt: timestamptz('available_at').notNull().defaultNow(),
    /** Time this logical Outbox row was first created; coalesced changes preserve it. */
    createdAt: createdAt(),
    /** Terminal failure time; dead rows remain for inspection until a newer change revives them. */
    deadAt: timestamptz('dead_at'),
    /** Stable source document identifier within the selected search entity. */
    documentId: text('document_id').notNull(),
    /** Search projection whose document must be refreshed or deleted. */
    entity: text('entity').$type<SearchDocumentEntity>().notNull(),
    /** Internal surrogate identifier; work identity is the entity and document ID pair. */
    id: uuid('id').primaryKey().defaultRandom(),
    /** Latest truncated processing error or expired-lease reason, cleared by a newer change. */
    lastError: text('last_error'),
    /** Exclusive lease expiry whose exact timestamp also fences settlement by stale workers. */
    lockedUntil: timestamptz('locked_until'),
    /** Claim order where lower values run first; destructive or scope changes use priority zero. */
    priority: smallint('priority').notNull().default(10),
    /** Monotonic document version; sequence gaps are valid because allocation is non-transactional. */
    revision: bigint('revision', { mode: 'number' })
      .notNull()
      .default(sql`nextval('search_sync_revision_seq')`),
    /** Last enqueue, claim, release, retry, or terminal-failure state transition. */
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
