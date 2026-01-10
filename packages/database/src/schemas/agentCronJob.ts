/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { users } from './user';

// Execution conditions type for JSONB field
export interface ExecutionConditions {
  maxExecutionsPerDay?: number;
  timeRange?: {
    end: string; // "18:00"
    start: string; // "09:00"
  };
  weekdays?: number[]; // [1,2,3,4,5] (Monday=1, Sunday=0)
}

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

// Validation schemas
export const cronPatternSchema = z
  .string()
  .regex(
    /^(@(annually|yearly|monthly|weekly|daily|hourly|reboot))|(@every (\d+(ns|us|µs|ms|s|m|h))+)|((((\d+,)+\d+|(\d+(\/|-)\d+)|\d+|\*) ?){5,7})$/,
    'Invalid cron pattern',
  );

// Minimum 30 minutes validation (using standard cron format)
export const minimumIntervalSchema = z.string().refine((pattern) => {
  // Standard cron format: minute hour day month weekday
  const allowedPatterns = [
    '*/30 * * * *', // Every 30 minutes
    '0 * * * *', // Every hour
    '0 */2 * * *', // Every 2 hours
    '0 */3 * * *', // Every 3 hours
    '0 */4 * * *', // Every 4 hours
    '0 */6 * * *', // Every 6 hours
    '0 */8 * * *', // Every 8 hours
    '0 */12 * * *', // Every 12 hours
    '0 0 * * *', // Daily at midnight
    '0 0 * * 0', // Weekly on Sunday
    '0 0 1 * *', // Monthly on 1st
  ];

  // Check if it matches allowed patterns
  if (allowedPatterns.includes(pattern)) {
    return true;
  }

  // Parse pattern to validate minimum 30-minute interval
  const parts = pattern.split(' ');
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour] = parts;

  // Allow minute intervals >= 30 (e.g., */30, */45, */60)
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2));
    if (!isNaN(interval) && interval >= 30) {
      return true;
    }
  }

  // Allow hourly patterns: 0 */N * * * where N >= 1
  if (minute === '0' && hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2));
    if (!isNaN(interval) && interval >= 1) {
      return true;
    }
  }

  // Allow specific hour patterns: 0 N * * * (runs once per day)
  if (minute === '0' && /^\d+$/.test(hour)) {
    const h = parseInt(hour);
    if (!isNaN(h) && h >= 0 && h <= 23) {
      return true;
    }
  }

  return false;
}, 'Minimum execution interval is 30 minutes');

export const executionConditionsSchema = z
  .object({
    maxExecutionsPerDay: z.number().min(1).max(100).optional(),
    timeRange: z
      .object({
        end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Invalid time format'),
        start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Invalid time format'),
      })
      .optional(),
    weekdays: z.array(z.number().min(0).max(6)).optional(),
  })
  .optional();

export const insertAgentCronJobSchema = createInsertSchema(agentCronJobs, {
  cronPattern: minimumIntervalSchema,
  content: z.string().min(1).max(2000),
  editData: z.record(z.any()).optional(), // Allow any JSON structure for rich content
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  maxExecutions: z.number().min(1).max(10_000).optional(),
  executionConditions: executionConditionsSchema,
});

export const updateAgentCronJobSchema = insertAgentCronJobSchema.partial();

// Type exports
export type NewAgentCronJob = typeof agentCronJobs.$inferInsert;
export type AgentCronJob = typeof agentCronJobs.$inferSelect;
export type CreateAgentCronJobData = z.infer<typeof insertAgentCronJobSchema>;
export type UpdateAgentCronJobData = z.infer<typeof updateAgentCronJobSchema>;
