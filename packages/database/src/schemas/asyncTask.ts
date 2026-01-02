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

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    duration: integer('duration'),

    ...timestamps,
  },
  (t) => [index('async_tasks_user_id_idx').on(t.userId)],
);

export type NewAsyncTaskItem = typeof asyncTasks.$inferInsert;
export type AsyncTaskSelectItem = typeof asyncTasks.$inferSelect;
