import type { TaskTemplate, TaskTemplateConnector } from '@lobechat/const';
import {
  INTEREST_AREA_KEYS,
  TASK_TEMPLATE_CATEGORIES,
  TASK_TEMPLATE_ICONS,
  TASK_TEMPLATE_RECOMMEND_MAX_COUNT,
} from '@lobechat/const';
import { z } from 'zod';

// ==================== Query Schemas ====================

/**
 * Query strings carry no arrays, so `interestKeys` is a comma-separated list
 * (`?interestKeys=engineering,marketing`), like the other list filters.
 */
export const TaskTemplateListQuerySchema = z.object({
  count: z.coerce
    .number()
    .int()
    .min(1)
    .max(TASK_TEMPLATE_RECOMMEND_MAX_COUNT)
    .optional()
    .describe(`How many templates to recommend, 1–${TASK_TEMPLATE_RECOMMEND_MAX_COUNT}.`),
  interestKeys: z
    .string()
    .max(2048)
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(64)).max(32))
    .describe('Comma-separated interest areas to match, e.g. `engineering,marketing`.'),
  locale: z.string().max(32).optional().describe('Locale of the template copy, e.g. `zh-CN`.'),
  refreshSeed: z
    .string()
    .min(1)
    .max(32)
    .optional()
    .describe('Change it to draw a different set for the same day.'),
});
export type TaskTemplateListQuery = z.infer<typeof TaskTemplateListQuerySchema>;

// ==================== Response Schemas ====================

const TaskTemplateConnectorSchema = z
  .object({
    identifier: z.string(),
    /** Whether the connector must be authorized before the task can be created. */
    required: z.boolean(),
    source: z.enum(['composio', 'lobehub']),
  } satisfies Record<keyof TaskTemplateConnector, z.ZodType>)
  .strict();

/** A recommended recurring task; create it with `POST /api/v1/tasks`. */
export const TaskTemplateSchema = z
  .object({
    category: z.enum(TASK_TEMPLATE_CATEGORIES),
    /** Connectors the instruction relies on. */
    connectors: z.array(TaskTemplateConnectorSchema),
    /** Suggested schedule, as a cron pattern. */
    cronPattern: z.string(),
    description: z.string(),
    icon: z.enum(TASK_TEMPLATE_ICONS).optional(),
    id: z.number().int(),
    identifier: z.string(),
    /** The instruction to give the task. */
    instruction: z.string(),
    interests: z.array(z.enum(INTEREST_AREA_KEYS)),
    title: z.string(),
  } satisfies Record<keyof TaskTemplate, z.ZodType>)
  .strict()
  .meta({ id: 'TaskTemplate' });
