/* eslint-disable sort-keys-fix/sort-keys-fix  */
import type { ExecutionConditions } from '@lobechat/types';
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { users } from './user';

// Agent cron jobs table - supports multiple cron jobs per agent
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

    ...timestamps,
  },
  (t) => [
    // Indexes for performance
    index('agent_cron_jobs_agent_id_idx').on(t.agentId),
    index('agent_cron_jobs_group_id_idx').on(t.groupId),
    index('agent_cron_jobs_user_id_idx').on(t.userId),
    index('agent_cron_jobs_enabled_idx').on(t.enabled),
    index('agent_cron_jobs_remaining_executions_idx').on(t.remainingExecutions),
    index('agent_cron_jobs_last_executed_at_idx').on(t.lastExecutedAt),
  ],
);

// Type exports
export type NewAgentCronJob = typeof agentCronJobs.$inferInsert;
export type AgentCronJob = typeof agentCronJobs.$inferSelect;

// Re-export types from types package for consumers
export type { ExecutionConditions } from '@lobechat/types';
export type { InsertAgentCronJob as CreateAgentCronJobData } from '@lobechat/types';
export type { UpdateAgentCronJob as UpdateAgentCronJobData } from '@lobechat/types';
