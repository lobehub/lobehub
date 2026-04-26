import { pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Tracks per-user interaction state for hardcoded Task Template catalog entries.
 * `firstCreatedAt` and `dismissedAt` are independent flags — a row may have either,
 * both, or neither (transient state during upsert). Either non-null timestamp marks
 * the template as "interacted with" and excludes it from daily recommendations.
 */
export const userTaskTemplateInteractions = pgTable(
  'user_task_template_interactions',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    templateId: varchar('template_id', { length: 64 }).notNull(),
    firstCreatedAt: timestamptz('first_created_at'),
    dismissedAt: timestamptz('dismissed_at'),
    ...timestamps,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.templateId] }),
  }),
);

export type NewUserTaskTemplateInteraction = typeof userTaskTemplateInteractions.$inferInsert;
export type UserTaskTemplateInteractionItem = typeof userTaskTemplateInteractions.$inferSelect;
