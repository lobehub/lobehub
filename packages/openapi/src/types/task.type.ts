import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { z } from 'zod';

export const TaskIdParamSchema = z.object({
  id: z.string().min(1),
});
export type TaskIdParam = z.infer<typeof TaskIdParamSchema>;

/** Query strings carry lists as comma-separated text: `?statuses=running,paused`. */
export const TaskListQuerySchema = z.object({
  assigneeAgentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  projectId: z.string().optional(),
  statuses: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((status) => status.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(TASK_STATUSES)).optional()),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const CreateTaskRequestSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  automationMode: z.enum(['heartbeat', 'schedule']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  /** What the task must accomplish; the only required field. */
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  projectId: z.string().optional(),
  schedulePattern: z.string().optional(),
  scheduleTimezone: z.string().optional(),
  visibility: z.enum(['private', 'public']).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    assigneeAgentId: z.string().nullish(),
    assigneeUserId: z.string().nullish(),
    automationMode: z.enum(['heartbeat', 'schedule']).nullish(),
    config: z.record(z.string(), z.unknown()).optional(),
    description: z.string().nullish(),
    instruction: z.string().optional(),
    name: z.string().optional(),
    parentTaskId: z.string().nullish(),
    priority: z.number().int().min(0).max(4).optional(),
    schedulePattern: z.string().nullish(),
    scheduleTimezone: z.string().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const UpdateTaskStatusRequestSchema = z.object({
  /** Only meaningful with `failed`; rejected otherwise. */
  error: z.string().optional(),
  status: z.enum(TASK_STATUSES),
});
export type UpdateTaskStatusRequest = z.infer<typeof UpdateTaskStatusRequestSchema>;
