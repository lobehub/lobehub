import type {
  RegisterTaskWorkParams,
  TaskItem,
  TaskWorkListItem,
  TaskWorkSummaryItem,
  TaskWorkVersionSnapshot,
  WorkItem,
  WorkVersionItem,
  WorkVersionSnapshot,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, or } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import { taskOwnership, versionOwnership, type WorkContext, workOwnership } from './context';
import {
  currentVersions,
  taskSummaryFields,
  taskSummaryJoin,
  type TaskWorkSummaryQueryRow,
  truncateSummaryText,
  versionEventSelection,
  type WorkTypeAdapter,
} from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

const normalizeTaskLookup = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('task_') ? trimmed : trimmed.toUpperCase();
};

export const taskSnapshot = (task: TaskItem): WorkVersionSnapshot => ({
  task: {
    assigneeAgentId: task.assigneeAgentId,
    assigneeUserId: task.assigneeUserId,
    automationMode: task.automationMode,
    config: task.config,
    context: task.context,
    createdByAgentId: task.createdByAgentId,
    currentTopicId: task.currentTopicId,
    description: task.description,
    editorData: task.editorData,
    error: task.error,
    heartbeatInterval: task.heartbeatInterval,
    heartbeatTimeout: task.heartbeatTimeout,
    id: task.id,
    identifier: task.identifier,
    instruction: task.instruction,
    maxTopics: task.maxTopics,
    name: task.name,
    parentTaskId: task.parentTaskId,
    priority: task.priority,
    schedulePattern: task.schedulePattern,
    scheduleTimezone: task.scheduleTimezone,
    sortOrder: task.sortOrder,
    status: task.status,
    totalTopics: task.totalTopics,
  } satisfies TaskWorkVersionSnapshot,
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

const upsertTaskWork = async (ctx: WorkContext, task: TaskItem): Promise<WorkItem> => {
  const values = {
    resourceId: task.id,
    resourceLabel: task.identifier,
    resourceType: 'task' as const,
    type: 'task' as const,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  };

  const conflict = resolveWorkUpsertConflict(ctx);

  const [work] = await ctx.db
    .insert(works)
    .values(values)
    .onConflictDoUpdate({
      ...conflict,
      set: {
        resourceLabel: task.identifier,
        updatedAt: new Date(),
      },
    })
    .returning();

  return work;
};

const createTaskVersion = async (
  ctx: WorkContext,
  work: WorkItem,
  task: TaskItem,
  params: RegisterTaskWorkParams,
): Promise<WorkVersionItem> =>
  createVersion(ctx, work, params, () => ({
    snapshot: taskSnapshot(task),
  }));

export const registerTaskWork = async (
  ctx: WorkContext,
  params: RegisterTaskWorkParams,
): Promise<WorkItem | null> => {
  const task = await resolveTask(ctx, params);
  if (!task) return null;

  const work = await upsertTaskWork(ctx, task);
  await createTaskVersion(ctx, work, task, params);

  return findById(ctx, work.id);
};

/** Card-facing task fields from the live-coalesced `taskSummaryFields` projection. */
const toTaskCardFields = (
  task: TaskWorkSummaryQueryRow['task'],
): Pick<TaskWorkListItem, 'task' | 'taskDeleted'> => ({
  task: {
    instruction: truncateSummaryText(task.instruction),
    name: task.name,
    priority: task.priority,
    status: task.status,
  },
  taskDeleted: task.deleted,
});

/**
 * Task keeps bespoke adapter queries (unlike the snapshot factory types):
 * every projection LEFT JOINs the live `tasks` row so cards render live
 * name/status, falling back to the version snapshot only when the task row
 * was deleted outside the tool path (see `taskSummaryFields`).
 */
export const taskWorkAdapter: WorkTypeAdapter<TaskWorkSummaryQueryRow> = {
  listConversationRows: async (ctx, params) => {
    const rows = await ctx.db
      .select({
        eventCreatedAt: workVersions.createdAt,
        ...taskSummaryFields(currentVersions.snapshot),
        work: works,
      })
      .from(workVersions)
      .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
      .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
      .leftJoin(tasks, taskSummaryJoin(ctx))
      .where(
        and(
          versionOwnership(ctx),
          eq(workVersions.topicId, params.topicId),
          params.threadFilter,
          eq(works.type, 'task'),
        ),
      )
      .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
      .limit(params.rowLimit);

    return rows.map((row) => ({
      eventCreatedAt: row.eventCreatedAt,
      item: {
        ...row.work,
        ...toTaskCardFields(row.task),
        resourceType: 'task' as const,
        type: 'task' as const,
      } satisfies TaskWorkListItem,
    }));
  },

  listSummaryRows: (ctx, filters, rowLimit) =>
    ctx.db
      .select({
        event: versionEventSelection,
        ...taskSummaryFields(currentVersions.snapshot),
        version: {
          createdAt: currentVersions.createdAt,
          id: currentVersions.id,
          version: currentVersions.version,
        },
        work: works,
      })
      .from(workVersions)
      .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
      .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
      .leftJoin(tasks, taskSummaryJoin(ctx))
      .where(and(versionOwnership(ctx), ...filters, eq(works.type, 'task')))
      .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
      .limit(rowLimit),

  listVersionEvents: async (ctx, filters, limit) => {
    const rows = await ctx.db
      .select({
        ...taskSummaryFields(workVersions.snapshot),
        version: versionEventSelection,
        work: works,
      })
      .from(workVersions)
      .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
      .leftJoin(tasks, taskSummaryJoin(ctx))
      .where(and(versionOwnership(ctx), ...filters, eq(works.type, 'task')))
      .orderBy(desc(workVersions.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row.work,
      ...toTaskCardFields(row.task),
      resourceType: 'task' as const,
      type: 'task' as const,
      version: row.version,
    }));
  },

  mapSummaryRow: (row, totalCost): TaskWorkSummaryItem => ({
    ...row.work,
    ...toTaskCardFields(row.task),
    event: row.event,
    resourceType: 'task' as const,
    totalCost,
    type: 'task' as const,
    version: row.version,
  }),

  mapWorkspaceRow: (row, totalCost): TaskWorkSummaryItem => ({
    ...row.work,
    ...toTaskCardFields(row.task),
    event: row.event,
    resourceType: 'task' as const,
    totalCost,
    type: 'task' as const,
    version: row.version,
  }),
};
