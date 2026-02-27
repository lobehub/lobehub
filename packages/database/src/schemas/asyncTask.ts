/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';

export const asyncTasks = pgTable(
  'async_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type'),

    status: text('status'),
    error: jsonb('error'),
    inferenceId: text('inference_id'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    duration: integer('duration'),
    parentId: uuid('parent_id'),
    metadata: jsonb('metadata').notNull().default('{}'),

    ...timestamps,
  },
  (t) => [
    index('async_tasks_user_id_idx').on(t.userId),
    index('async_tasks_parent_id_idx').on(t.parentId),
    index('async_tasks_type_status_idx').on(t.type, t.status),
    index('async_tasks_inference_id_idx').on(t.inferenceId),
    index('async_tasks_metadata_idx').using('gin', t.metadata)
  ],
);

export type NewAsyncTaskItem = typeof asyncTasks.$inferInsert;
export type AsyncTaskSelectItem = Omit<typeof asyncTasks.$inferSelect, 'metadata' | 'parentId'> & Partial<Pick<typeof asyncTasks.$inferSelect, 'metadata' | 'parentId'>>;
