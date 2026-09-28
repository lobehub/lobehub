import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { softDeleteColumns, timestamps } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { users } from './user';
import { workspaces } from './workspace';

interface ExecutionConditions {
  activeDays?: number[];
  activeHours?: { end: number; start: number };
  maxExecutionsPerDay?: number;
}

/**
 * @deprecated Legacy per-agent schedule rows. Superseded by scheduling on the
 * task itself — `tasks.automation_mode = 'schedule'` with `schedule_pattern` /
 * `schedule_timezone` — which keeps the schedule next to the work it triggers
 * instead of in a parallel table. Kept for rows that pre-date that move and for
 * `briefs.cron_job_id`, which still points here. New code schedules through
 * `tasks`; do not add writers.
 *
 * It carries the recycle-bin columns because it is still read through the
 * shared ownership funnel (`buildWorkspaceWhere`), which filters every
 * trash-aware table uniformly — a deprecated table still must not surface rows
 * belonging to a trashed agent. It gets no `TrashService` handler of its own:
 * the agent is the restorable unit, and these rows follow it.
 */
export const agentCronJobs = pgTable(
  'agent_cron_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agentCronJobs'))
      .notNull(),

    // Foreign keys
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: text('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // Task identification
    name: text('name'), // Optional task name like "Daily Report", "Data Monitoring"
    description: text('description'), // Optional task description

    // Core configuration
    enabled: boolean('enabled').default(true),
    cronPattern: text('cron_pattern').notNull(), // e.g., "*/30 * * * *" (every 30 minutes)
    timezone: text('timezone').default('UTC'),

    // Content fields
    content: text('content').notNull(), // Simple text content
    editData: jsonb('edit_data'), // Rich content data (markdown, files, images, etc.)

    // Execution count management
    maxExecutions: integer('max_executions'), // null = unlimited
    remainingExecutions: integer('remaining_executions'), // null = unlimited

    // Execution conditions (stored as JSONB)
    executionConditions: jsonb('execution_conditions').$type<ExecutionConditions>(),

    // Execution statistics
    lastExecutedAt: timestamp('last_executed_at'),
    totalExecutions: integer('total_executions').default(0),

    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (t) => [
    // Indexes for performance
    index('agent_cron_jobs_agent_id_idx').on(t.agentId),
    index('agent_cron_jobs_group_id_idx').on(t.groupId),
    index('agent_cron_jobs_user_id_idx').on(t.userId),
    index('agent_cron_jobs_workspace_id_idx').on(t.workspaceId),
    index('agent_cron_jobs_enabled_idx').on(t.enabled),
    index('agent_cron_jobs_remaining_executions_idx').on(t.remainingExecutions),
    index('agent_cron_jobs_last_executed_at_idx').on(t.lastExecutedAt),
  ],
);

// Type exports
export type NewAgentCronJob = typeof agentCronJobs.$inferInsert;
export type AgentCronJob = typeof agentCronJobs.$inferSelect;
export type CreateAgentCronJobData = Partial<NewAgentCronJob> &
  Pick<NewAgentCronJob, 'agentId' | 'cronPattern' | 'content'>;
export type UpdateAgentCronJobData = Partial<AgentCronJob>;

export type { ExecutionConditions };
