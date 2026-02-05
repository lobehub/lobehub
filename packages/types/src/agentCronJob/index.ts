import { z } from 'zod';

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
export const cronPatternSchema = z
  .string()
  .regex(
    /^(@(annually|yearly|monthly|weekly|daily|hourly|reboot))|(@every (\d+(ns|us|µs|ms|[hms]))+)|((((\d+,)+\d+|(\d+([/-])\d+)|\d+|\*) ?){5,7})$/,
    'Invalid cron pattern',
  );

// Minimum 30 minutes validation (using standard cron format)
export const minimumIntervalSchema = z.string().refine((pattern) => {
  // Standard cron format: minute hour day month weekday
  // Parse pattern to validate minimum 30-minute interval
  const parts = pattern.split(' ');
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour] = parts;

  // Validate minute is 0 or 30 (we only allow 30-minute intervals)
  const isValidMinute = minute === '0' || minute === '30' || minute === '*/30';

  if (!isValidMinute) {
    return false;
  }

  // Allow minute intervals >= 30 (e.g., */30, */45, */60)
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2));
    if (!isNaN(interval) && interval >= 30) {
      return true;
    }
    return false;
  }

  // Allow hourly patterns: {0|30} */N * * * where N >= 1
  if ((minute === '0' || minute === '30') && hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2));
    if (!isNaN(interval) && interval >= 1) {
      return true;
    }
    return false;
  }

  // Allow hourly patterns: {0|30} * * * * (every hour at :00 or :30)
  if ((minute === '0' || minute === '30') && hour === '*') {
    return true;
  }

  // Allow specific hour patterns: {0|30} N * * * (runs once per day)
  // or {0|30} N * * {weekdays} (runs on specific weekdays)
  if ((minute === '0' || minute === '30') && /^\d+$/.test(hour)) {
    const h = parseInt(hour);
    if (!isNaN(h) && h >= 0 && h <= 23) {
      return true;
    }
  }

  return false;
}, 'Minimum execution interval is 30 minutes');

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
  cronPattern: minimumIntervalSchema,
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
