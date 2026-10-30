import type { UserMemoryState } from '@lobechat/types';
import { bigint, boolean, index, jsonb, pgTable, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { softDeleteColumns, timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';

export const userMemories = pgTable(
  'user_memories',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    memoryCategory: varchar255('memory_category'),
    memoryLayer: varchar255('memory_layer'),
    memoryType: varchar255('memory_type'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    title: varchar255('title'),
    summary: text('summary'),
    summaryVector1024: vector('summary_vector_1024', { dimensions: 1024 }),
    details: text('details'),
    detailsVector1024: vector('details_vector_1024', { dimensions: 1024 }),

    status: varchar255('status'),
    /** Whether the memory may be used in conversations yet; unset rows predate the lifecycle. */
    state: text('state').$type<UserMemoryState>(),
    /** Set when the user edited the memory; automatic consolidation must not overwrite it. */
    userLocked: boolean('user_locked').default(false),

    accessedCount: bigint('accessed_count', { mode: 'number' }).default(0),
    lastAccessedAt: timestamptz('last_accessed_at').notNull(),
    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (table) => [
    index('user_memories_summary_vector_1024_index').using(
      'hnsw',
      table.summaryVector1024.op('vector_cosine_ops'),
    ),
    index('user_memories_details_vector_1024_index').using(
      'hnsw',
      table.detailsVector1024.op('vector_cosine_ops'),
    ),
    index('user_memories_user_id_index').on(table.userId),
  ],
);

export type UserMemoryItem = typeof userMemories.$inferSelect;
export type UserMemoryItemWithoutVectors = Omit<
  UserMemoryItem,
  'summaryVector1024' | 'detailsVector1024'
>;
export type NewUserMemory = typeof userMemories.$inferInsert;
