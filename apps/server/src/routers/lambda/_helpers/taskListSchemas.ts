import {
  TASK_COMPLETED_WINDOW_MS,
  TASK_COMPLETED_WINDOWS,
  TASK_STATUSES,
  type TaskCompletedWindow,
} from '@lobechat/builtin-tool-task';
import {
  TASK_LIST_FILTER_CONTENT_MAX_LENGTH,
  TASK_LIST_FILTER_DATE_OPERATORS,
  TASK_LIST_FILTER_DATE_WINDOWS,
  TASK_LIST_FILTER_MAX_VALUES,
  TASK_LIST_FILTER_NONE,
  TASK_LIST_FILTER_OPERATORS,
} from '@lobechat/types';
import { z } from 'zod';

const filterSet = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    operator: z.enum(TASK_LIST_FILTER_OPERATORS),
    values: z.array(value).min(1).max(TASK_LIST_FILTER_MAX_VALUES),
  });

const filterDate = z.object({
  operator: z.enum(TASK_LIST_FILTER_DATE_OPERATORS),
  window: z.enum(TASK_LIST_FILTER_DATE_WINDOWS),
});

const filterId = z.string().min(1).max(255);

/**
 * The Tasks page filter (`TaskListFilter` in `@lobechat/types`). Ids may hold
 * `TASK_LIST_FILTER_NONE` for "no agent / member / project"; a creator is
 * never missing, so that set takes member ids and `agent:<id>` agent creators. Ownership is still enforced by
 * the model, so a filter can only narrow what the caller may already see.
 */
export const taskListFilterSchema = z.object({
  agent: filterSet(filterId).optional(),
  assignee: filterSet(filterId).optional(),
  completedAt: filterDate.optional(),
  content: z.string().trim().max(TASK_LIST_FILTER_CONTENT_MAX_LENGTH).optional(),
  createdAt: filterDate.optional(),
  creator: filterSet(filterId.refine((id) => id !== TASK_LIST_FILTER_NONE)).optional(),
  priority: filterSet(z.number().int().min(0).max(4)).optional(),
  project: filterSet(filterId).optional(),
  status: filterSet(z.enum(TASK_STATUSES)).optional(),
  updatedAt: filterDate.optional(),
});

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
  // The Tasks page filter; narrows on top of every other option.
  filter: taskListFilterSchema.optional(),
  // Archived tasks are user-closed; lists leave them out unless asked.
  includeArchived: z.boolean().optional(),
  // Up to 500: the Tasks list view walks the whole list page by page, and
  // every page is a sequential round trip (refresh after each edit included).
  limit: z.number().min(1).max(500).default(50),
  offset: z.number().min(0).default(0),
  // Which timestamp orders the page, newest first. Defaults to creation time.
  orderBy: z.enum(['createdAt', 'updatedAt']).optional(),
  parentIdentifier: z.string().trim().min(1).optional(),
  parentTaskId: z.string().trim().min(1).nullish(),
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
    filter: taskListFilterSchema.optional(),
    groupBy: z.enum(['agent', 'assignee', 'member', 'priority']).optional(),
    groups: z
      .array(
        z.object({
          key: z.string(),
          // Up to 500: the Tasks list view walks the whole list page by page, and
          // every page is a sequential round trip (refresh after each edit included).
          limit: z.number().min(1).max(500).default(50),
          offset: z.number().min(0).default(0),
          statuses: z.array(z.string()).min(1).max(10),
        }),
      )
      .min(1)
      .max(10)
      .optional(),
    includeArchived: z.boolean().optional(),
    parentIdentifier: z.string().trim().min(1).optional(),
    parentTaskId: z.string().trim().min(1).nullish(),
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
