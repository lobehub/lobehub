import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { z } from 'zod';

export const listSchema = z.object({
  // Keyset cursor — rows strictly after this `(orderBy timestamp, seq)` position
  // in newest-first order. Stable under concurrent inserts/deletes, unlike `offset`.
  after: z.object({ at: z.coerce.date(), seq: z.number().int() }).optional(),
  assigneeAgentId: z.string().optional(),
  // true → only tasks whose schedule or heartbeat can still fire (a terminal or
  // misconfigured one cannot), false → its exact complement. Omitted leaves the
  // set unnarrowed.
  automated: z.boolean().optional(),
  // Archived tasks are user-closed; lists leave them out unless asked.
  includeArchived: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  // Which timestamp orders the page, newest first. Defaults to creation time.
  orderBy: z.enum(['createdAt', 'updatedAt']).optional(),
  parentIdentifier: z.string().optional(),
  parentTaskId: z.string().nullish(),
  priorities: z.array(z.number().min(0).max(4)).max(5).optional(),
  projectId: z.string().optional(),
  // "My tasks" narrowing: 'assigned' → tasks whose member assignee is the
  // caller, 'created' → tasks the caller created. Always resolved against
  // `ctx.userId` so the endpoint never filters by an arbitrary member.
  scope: z.enum(['assigned', 'created']).optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).max(10).optional(),
  // UI-side narrowing of the result set. Omitted means "All" (the chip's
  // default 'private' is enforced client-side; the server stays permissive
  // so router tests / external callers don't have to know the chip).
  visibility: z.enum(['private', 'public']).optional(),
});

export const groupListSchema = z
  .object({
    assigneeAgentId: z.string().optional(),
    automated: z.boolean().optional(),
    excludeStatuses: z.array(z.enum(TASK_STATUSES)).max(10).optional(),
    groupBy: z.enum(['agent', 'assignee', 'member', 'priority']).optional(),
    groups: z
      .array(
        z.object({
          key: z.string(),
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
          statuses: z.array(z.string()).min(1).max(10),
        }),
      )
      .min(1)
      .max(10)
      .optional(),
    includeArchived: z.boolean().optional(),
    parentTaskId: z.string().nullish(),
    projectId: z.string().optional(),
    // Same "My tasks" narrowing as `listSchema.scope`, so the board renders the
    // exact set its list view does. Always resolved against `ctx.userId`.
    scope: z.enum(['assigned', 'created']).optional(),
    visibility: z.enum(['private', 'public']).optional(),
  })
  .refine(({ groupBy, groups }) => Boolean(groupBy) !== Boolean(groups), {
    message: 'Provide either groups or groupBy',
  });
