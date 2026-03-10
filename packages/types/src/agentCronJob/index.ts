import { z } from 'zod';

const cronAliasPattern = /^@(?:annually|yearly|monthly|weekly|daily|hourly|reboot)$/;
const cronEveryPattern = /^@every\s+(?:\d+(?:ns|us|µs|ms|[hms]))+$/;
const cronFieldPattern = /^(?:\*|\d+|\d+[/-]\d+)$/;

const isValidCronField = (field: string): boolean => {
  return field.split(',').every((part) => cronFieldPattern.test(part));
};

const isValidCronPattern = (value: string): boolean => {
  if (cronAliasPattern.test(value) || cronEveryPattern.test(value)) return true;

  const fields = value.trim().split(/\s+/);

  return fields.length >= 5 && fields.length <= 7 && fields.every(isValidCronField);
};

// Execution conditions type
export interface ExecutionConditions {
  maxExecutionsPerDay?: number;
  timeRange?: {
    end: string; // "18:00"
    start: string; // "09:00"
  };
  weekdays?: number[]; // [1,2,3,4,5] (Monday=1, Sunday=0)
}

// Cron pattern validation schema
export const cronPatternSchema = z.string().refine(isValidCronPattern, 'Invalid cron pattern');

// Backward-compatible alias: keep export name while removing artificial interval limits.
// Cron validation now follows cronPatternSchema directly.
export const minimumIntervalSchema = cronPatternSchema;

// Execution conditions schema
export const ExecutionConditionsSchema = z
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

// Insert schema for creating agent cron jobs
export const InsertAgentCronJobSchema = z.object({
  agentId: z.string(),
  content: z.string(), // Allow empty content (when using editData for rich content)
  cronPattern: cronPatternSchema,
  description: z.string().optional().nullable(),
  editData: z.record(z.string(), z.any()).optional().nullable(),
  enabled: z.boolean().optional().nullable(),
  executionConditions: ExecutionConditionsSchema.nullable(),
  groupId: z.string().optional().nullable(),
  id: z.string().optional(),
  maxExecutions: z.number().min(1).max(10_000).optional().nullable(),
  name: z.string().optional().nullable(),
  remainingExecutions: z.number().optional().nullable(),
  timezone: z.string().optional().nullable(),
  userId: z.string().optional(),
});

// Update schema (all fields optional)
export const UpdateAgentCronJobSchema = InsertAgentCronJobSchema.partial();

// Type exports
export type InsertAgentCronJob = z.infer<typeof InsertAgentCronJobSchema>;
export type UpdateAgentCronJob = z.infer<typeof UpdateAgentCronJobSchema>;
