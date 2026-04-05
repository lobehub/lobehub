import { z } from 'zod';

const CRON_SHORTCUTS = new Set([
  '@annually',
  '@yearly',
  '@monthly',
  '@weekly',
  '@daily',
  '@hourly',
  '@reboot',
]);

const cronEveryPattern = /^@every (?:\d+(?:ns|us|µs|ms|[hms]))+$/;
const cronFieldPattern = /^(?:\*|\d+)(?:[/-]\d+)?(?:,\d+(?:[/-]\d+)?)*$/;
const validQuarterMinutes = new Set(['0', '15', '30', '45']);

const parseStepValue = (value: string) => {
  if (!value.startsWith('*/')) {
    return null;
  }

  const stepText = value.slice(2);
  if (!/^\d+$/.test(stepText)) {
    return null;
  }

  const step = Number.parseInt(stepText, 10);
  if (Number.isNaN(step)) {
    return null;
  }

  return step;
};

const isValidCronPattern = (pattern: string) => {
  if (CRON_SHORTCUTS.has(pattern)) {
    return true;
  }

  if (cronEveryPattern.test(pattern)) {
    return true;
  }

  const fields = pattern.trim().split(/\s+/);
  if (fields.length < 5 || fields.length > 7) {
    return false;
  }

  return fields.every((field) => cronFieldPattern.test(field));
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

// Minimum 15 minutes validation (using standard cron format)
export const minimumIntervalSchema = z.string().refine((pattern) => {
  // Standard cron format: minute hour day month weekday
  // Parse pattern to validate minimum 15-minute interval
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour] = parts;

  // Allow minute intervals >= 15 (e.g., */15, */30, */45, */60)
  const minuteStep = parseStepValue(minute);
  if (minuteStep !== null) {
    return minuteStep >= 15;
  }

  // Validate minute is 0, 15, 30 or 45 (we only allow 15-minute intervals)
  if (!validQuarterMinutes.has(minute)) {
    return false;
  }

  // Allow hourly patterns: {0|15|30|45} */N * * * where N >= 1
  const hourStep = parseStepValue(hour);
  if (hourStep !== null) {
    return hourStep >= 1;
  }

  // Allow hourly patterns: {0|15|30|45} * * * * (every hour at :00, :15, :30 or :45)
  if (hour === '*') {
    return true;
  }

  // Allow specific hour patterns: {0|15|30|45} N * * * (runs once per day)
  // or {0|15|30|45} N * * {weekdays} (runs on specific weekdays)
  if (/^\d{1,2}$/.test(hour)) {
    const h = Number.parseInt(hour, 10);
    if (!Number.isNaN(h) && h >= 0 && h <= 23) {
      return true;
    }
  }

  return false;
}, 'Minimum execution interval is 15 minutes');

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
