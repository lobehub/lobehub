import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz } from './_helpers';
import { agentCronJobs } from './agentCronJob';
import { tasks } from './task';
import { users } from './user';

export const briefs = pgTable(
  'briefs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Source (polymorphic, fill as needed)
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    cronJobId: text('cron_job_id').references(() => agentCronJobs.id, { onDelete: 'cascade' }),
    topicId: text('topic_id'),
    agentId: text('agent_id'),

    // Content
    type: text('type').notNull(), // 'decision' | 'result' | 'insight' | 'error'
    priority: text('priority').default('info'), // 'urgent' | 'normal' | 'info'
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    artifacts: jsonb('artifacts'), // document ids
    actions: jsonb('actions'), // BriefAction[]
    commentType: text('comment_type'), // 'summary' | 'suggestion' | 'motion'

    // Resolution
    resolvedAction: text('resolved_action'), // action key chosen by user (e.g. 'approve', 'feedback')
    resolvedComment: text('resolved_comment'), // user feedback text (for 'comment' type actions)
    readAt: timestamptz('read_at'),
    resolvedAt: timestamptz('resolved_at'),

    createdAt: createdAt(),
  },
  (t) => [
    index('briefs_user_id_idx').on(t.userId),
    index('briefs_task_id_idx').on(t.taskId),
    index('briefs_cron_job_id_idx').on(t.cronJobId),
    index('briefs_agent_id_idx').on(t.agentId),
    index('briefs_type_idx').on(t.type),
    index('briefs_priority_idx').on(t.priority),
    index('briefs_unresolved_idx').on(t.userId, t.resolvedAt),
  ],
);

export type NewBrief = typeof briefs.$inferInsert;
export type BriefItem = typeof briefs.$inferSelect;
