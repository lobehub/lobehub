import {
  TASK_COMPLETED_WINDOW_MS,
  TASK_COMPLETED_WINDOWS,
  TASK_STATUSES,
  type TaskCompletedWindow,
} from '@lobechat/builtin-tool-task';
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
  // Keep completed and canceled tasks only when closed within this look-back
  // window. Relative, so a client's query stays the same as time passes.
  completedWithin: z.enum(TASK_COMPLETED_WINDOWS).optional(),
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
    completedWithin: z.enum(TASK_COMPLETED_WINDOWS).optional(),
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

/** The model's `closedAfter` cut for a `completedWithin` window. */
export const resolveClosedAfter = (
  completedWithin: TaskCompletedWindow | undefined,
  now = Date.now(),
): Date | undefined =>
  completedWithin ? new Date(now - TASK_COMPLETED_WINDOW_MS[completedWithin]) : undefined;
