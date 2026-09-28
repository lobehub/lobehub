import type {
  RegisterTaskWorkParams,
  TaskItem,
  TaskWorkListItem,
  TaskWorkSummaryItem,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, or } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import { taskOwnership, type WorkContext, workOwnership } from './context';
import {
  currentTaskSummaryFields,
  currentWorkListFields,
  eventTaskSummaryFields,
  eventWorkListFields,
  taskDeletedField,
  taskSummaryJoin,
  type TaskWorkSummaryQueryRow,
  truncateSummaryText,
  versionEventSelection,
  type WorkDisplayColumns,
  type WorkTypeAdapter,
} from './internal';
import { registerWorkVersion } from './writes';

const normalizeTaskLookup = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('task_') ? trimmed : trimmed.toUpperCase();
};

/**
 * Task display fields captured by each immutable version. Live data stays on
 * the `tasks` row (joined by every query); snapshots provide the deletion
 * fallback when the backing task is later deleted.
 */
export const taskDisplayColumns = (task: TaskItem): WorkDisplayColumns => ({
  content: task.instruction,
  description: truncateSummaryText(task.instruction),
  identifier: task.identifier,
  status: task.status,
  title: task.name,
});

const resolveTask = async (
  ctx: WorkContext,
  params: RegisterTaskWorkParams,
): Promise<TaskItem | null> => {
  const filters: SQL[] = [];
  const taskId = normalizeTaskLookup(params.taskId);
  const taskIdentifier = normalizeTaskLookup(params.taskIdentifier);

  if (taskId) {
    filters.push(taskId.startsWith('task_') ? eq(tasks.id, taskId) : eq(tasks.identifier, taskId));
  }

  if (taskIdentifier) {
    filters.push(
      taskIdentifier.startsWith('task_')
        ? eq(tasks.id, taskIdentifier)
        : eq(tasks.identifier, taskIdentifier),
    );
  }

  if (filters.length === 0) return null;

  const [task] = await ctx.db
    .select()
    .from(tasks)
    .where(and(taskOwnership(ctx), filters.length === 1 ? filters[0] : or(...filters)))
    .limit(1);

  return task ?? null;
};

export const registerTaskWork = async (ctx: WorkContext, params: RegisterTaskWorkParams) => {
  const task = await resolveTask(ctx, params);
  if (!task) return null;

  return registerWorkVersion(
    ctx,
    {
      resourceId: task.id,
      resourceType: 'task',
      type: 'task',
      userId: task.createdByUserId,
      visibility: task.visibility,
    },
    params,
    () => ({ display: taskDisplayColumns(task) }),
  );
};

/** Card-facing task fields from a live-coalesced task projection. */
const toTaskCardFields = (
  row: Pick<TaskWorkSummaryQueryRow, 'resourceDeleted' | 'task'>,
): Pick<TaskWorkListItem, 'resourceDeleted' | 'task'> => ({
  resourceDeleted: row.resourceDeleted,
  task: {
    identifier: row.task.identifier,
    instruction: truncateSummaryText(row.task.instruction),
    name: row.task.name,
    priority: row.task.priority,
    status: row.task.status,
  },
});

/**
 * Task keeps bespoke adapter queries (unlike the snapshot factory types):
 * every projection LEFT JOINs the live `tasks` row so cards render live
 * name/status, falling back to the version snapshot only when the task row
 * was deleted outside the tool path.
 */
export const taskWorkAdapter: WorkTypeAdapter = {
  listConversationRows: async (ctx, params) => {
    const rows = await ctx.db
      .select({
        eventCreatedAt: workVersions.createdAt,
        ...currentTaskSummaryFields,
        resourceDeleted: taskDeletedField,
        work: currentWorkListFields,
      })
      .from(workVersions)
      .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
      .leftJoin(tasks, taskSummaryJoin(ctx))
      .where(
        and(eq(workVersions.topicId, params.topicId), params.threadFilter, eq(works.type, 'task')),
      )
      .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
      .limit(params.rowLimit);

    return rows.map((row) => ({
      eventCreatedAt: row.eventCreatedAt,
      item: {
        ...row.work,
        ...toTaskCardFields(row),
        resourceType: 'task' as const,
        type: 'task' as const,
      } satisfies TaskWorkListItem,
    }));
  },

  listVersionEvents: async (ctx, filters, limit) => {
    const rows = await ctx.db
      .select({
        ...eventTaskSummaryFields,
        resourceDeleted: taskDeletedField,
        version: versionEventSelection,
        work: eventWorkListFields,
      })
      .from(workVersions)
      .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
      .leftJoin(tasks, taskSummaryJoin(ctx))
      .where(and(...filters, eq(works.type, 'task')))
      .orderBy(desc(workVersions.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row.work,
      ...toTaskCardFields(row),
      resourceType: 'task' as const,
      type: 'task' as const,
      version: row.version,
    }));
  },

  mapCurrentRow: (row, totalCost): TaskWorkSummaryItem => ({
    ...row.work,
    ...toTaskCardFields(row),
    event: row.event,
    resourceType: 'task' as const,
    totalCost,
    type: 'task' as const,
    version: row.version,
  }),
};
