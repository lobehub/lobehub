import type { TaskItem, TaskSubtaskProgress } from '@lobechat/types';
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { tasks, taskTopics } from '../../schemas/task';
import { topics } from '../../schemas/topic';
import {
  buildTaskListFilters,
  type TaskListFilterOptions,
  type TaskListOptions,
} from '../taskListFilters';
import { type TaskModelContext, taskOwnership, taskOwnershipSql } from './context';

interface TaskRunStats extends Record<string, unknown> {
  root_id: string;
  total_run_cost: number;
  total_run_duration: number;
}

interface TaskSubtaskProgressRow extends Record<string, unknown> {
  completed: number;
  root_id: string;
  total: number;
}

const buildListConditions = (ctx: TaskModelContext, options: TaskListFilterOptions): SQL[] => [
  taskOwnership(ctx),
  ...buildTaskListFilters(options),
];

export const groupList = async (
  ctx: TaskModelContext,
  options: TaskListFilterOptions & {
    excludeStatuses?: string[];
    groupBy?: 'agent' | 'assignee' | 'member' | 'priority';
    groups?: Array<{
      key: string;
      limit?: number;
      offset?: number;
      statuses: string[];
    }>;
  },
): Promise<
  Array<{
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    hasMore: boolean;
    key: string;
    limit: number;
    offset: number;
    priority?: number;
    tasks: TaskItem[];
    total: number;
  }>
> => {
  const { assigneeAgentId, excludeStatuses, groupBy, groups } = options;

  if ((!groups || groups.length === 0) && !groupBy) {
    throw new Error('Task groups or a grouping dimension are required');
  }

  const baseConditions = buildListConditions(ctx, options);
  if (excludeStatuses?.length) {
    baseConditions.push(notInArray(tasks.status, excludeStatuses));
  }

  interface GroupQuery {
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    conditions: SQL[];
    key: string;
    limit: number;
    offset: number;
    prefetchedTasks?: TaskItem[];
    priority?: number;
    total: number;
  }

  let groupQueries: GroupQuery[];

  if (groupBy === 'assignee') {
    const limit = 50;
    const assigneeGroupKey = sql<string>`case
      when ${tasks.assigneeAgentId} is not null then 'assignee:' || ${tasks.assigneeAgentId}
      when ${tasks.assigneeUserId} is not null then 'assignee:user:' || ${tasks.assigneeUserId}
      else 'assignee:unassigned'
    end`;
    const rankedTasks = ctx.db
      .select({
        ...getTableColumns(tasks),
        assigneeGroupKey: assigneeGroupKey.as('assignee_group_key'),
        groupRank:
          sql<number>`row_number() over (partition by ${assigneeGroupKey} order by ${tasks.createdAt} desc, ${tasks.seq} desc)`.as(
            'group_rank',
          ),
      })
      .from(tasks)
      .where(and(...baseConditions))
      .as('ranked_assignee_tasks');
    const [countResult, rankedTaskRows] = await Promise.all([
      ctx.db
        .select({
          assigneeGroupKey: assigneeGroupKey.as('assignee_group_key'),
          count: sql<number>`count(*)`,
        })
        .from(tasks)
        .where(and(...baseConditions))
        .groupBy(assigneeGroupKey),
      ctx.db
        .select()
        .from(rankedTasks)
        .where(sql`${rankedTasks.groupRank} <= ${limit}`)
        .orderBy(rankedTasks.assigneeGroupKey, rankedTasks.groupRank),
    ]);
    const assigneeCounts = new Map(
      countResult.map((row) => [row.assigneeGroupKey, Number(row.count)]),
    );
    const tasksByAssignee = new Map<string, TaskItem[]>();
    for (const row of rankedTaskRows) {
      const { assigneeGroupKey: groupKey, groupRank: _groupRank, ...task } = row;
      const groupTasks = tasksByAssignee.get(groupKey) ?? [];
      groupTasks.push(task);
      tasksByAssignee.set(groupKey, groupTasks);
    }

    // `assignee` is the released hybrid grouping contract: agents take
    // precedence, member-only tasks get their own user group, and only tasks
    // with neither assignee are unassigned. New clients use `agent` for the
    // agent-only board instead of changing this existing API in place.
    if (!assigneeAgentId && !assigneeCounts.has('assignee:unassigned')) {
      assigneeCounts.set('assignee:unassigned', 0);
    }

    groupQueries = [...assigneeCounts.entries()].map(([key, total]) => {
      const isUnassigned = key === 'assignee:unassigned';
      const isUser = key.startsWith('assignee:user:');
      const groupAssigneeAgentId =
        isUnassigned || isUser ? (isUnassigned ? null : undefined) : key.slice('assignee:'.length);
      const groupAssigneeUserId = isUser
        ? key.slice('assignee:user:'.length)
        : isUnassigned
          ? null
          : undefined;
      const conditions = isUser
        ? [and(isNull(tasks.assigneeAgentId), eq(tasks.assigneeUserId, groupAssigneeUserId!))!]
        : isUnassigned
          ? [and(isNull(tasks.assigneeAgentId), isNull(tasks.assigneeUserId))!]
          : [eq(tasks.assigneeAgentId, groupAssigneeAgentId!)];

      return {
        assigneeAgentId: groupAssigneeAgentId,
        assigneeUserId: groupAssigneeUserId,
        conditions,
        key,
        limit,
        offset: 0,
        prefetchedTasks: tasksByAssignee.get(key) ?? [],
        total,
      };
    });
  } else if (groupBy === 'agent' || groupBy === 'member') {
    const limit = 50;
    const groupColumn = groupBy === 'agent' ? tasks.assigneeAgentId : tasks.assigneeUserId;
    const groupPrefix = groupBy === 'agent' ? 'assignee:' : 'member:';
    const unassignedKey = `${groupPrefix}unassigned`;
    const assigneeGroupKey = sql<string>`case
      when ${groupColumn} is not null then ${groupPrefix} || ${groupColumn}
      else ${unassignedKey}
    end`;
    const rankedTasks = ctx.db
      .select({
        ...getTableColumns(tasks),
        assigneeGroupKey: assigneeGroupKey.as('assignee_group_key'),
        groupRank:
          sql<number>`row_number() over (partition by ${assigneeGroupKey} order by ${tasks.createdAt} desc, ${tasks.seq} desc)`.as(
            'group_rank',
          ),
      })
      .from(tasks)
      .where(and(...baseConditions))
      .as('ranked_assignee_tasks');
    const [countResult, rankedTaskRows] = await Promise.all([
      ctx.db
        .select({
          assigneeId: groupColumn,
          count: sql<number>`count(*)`,
        })
        .from(tasks)
        .where(and(...baseConditions))
        .groupBy(groupColumn),
      ctx.db
        .select()
        .from(rankedTasks)
        .where(sql`${rankedTasks.groupRank} <= ${limit}`)
        .orderBy(rankedTasks.assigneeGroupKey, rankedTasks.groupRank),
    ]);
    const assigneeCounts = new Map(
      countResult.map((row) => [
        row.assigneeId ? `${groupPrefix}${row.assigneeId}` : unassignedKey,
        Number(row.count),
      ]),
    );
    const tasksByAssignee = new Map<string, TaskItem[]>();
    for (const row of rankedTaskRows) {
      const { assigneeGroupKey: groupKey, groupRank: _groupRank, ...task } = row;
      const groupTasks = tasksByAssignee.get(groupKey) ?? [];
      groupTasks.push(task);
      tasksByAssignee.set(groupKey, groupTasks);
    }

    // Keep an empty Unassigned column as a stable drop target. Agent-scoped
    // boards omit the Agent-unassigned column because their base filter
    // guarantees one assignee, while Member grouping remains independent.
    if ((groupBy === 'member' || !assigneeAgentId) && !assigneeCounts.has(unassignedKey)) {
      assigneeCounts.set(unassignedKey, 0);
    }

    groupQueries = [...assigneeCounts.entries()].map(([key, total]) => {
      const isUnassigned = key === unassignedKey;
      const assigneeId = isUnassigned ? null : key.slice(groupPrefix.length);
      const groupAssigneeAgentId = groupBy === 'agent' ? assigneeId : undefined;
      const groupAssigneeUserId = groupBy === 'member' ? assigneeId : undefined;
      const conditions = [isUnassigned ? isNull(groupColumn) : eq(groupColumn, assigneeId!)];

      return {
        assigneeAgentId: groupAssigneeAgentId,
        assigneeUserId: groupAssigneeUserId,
        conditions,
        key,
        limit,
        offset: 0,
        prefetchedTasks: tasksByAssignee.get(key) ?? [],
        total,
      };
    });
  } else if (groupBy === 'priority') {
    const priorities = [1, 2, 3, 4, 0];
    const countQuery = ctx.db
      .select({ count: sql<number>`count(*)`, priority: tasks.priority })
      .from(tasks)
      .where(and(...baseConditions))
      .groupBy(tasks.priority);
    const taskQueries = priorities.map(async (priority) => {
      const conditions = [
        priority === 0
          ? or(eq(tasks.priority, priority), isNull(tasks.priority))!
          : eq(tasks.priority, priority),
      ];
      const limit = 50;
      const offset = 0;
      const prefetchedTasks = await ctx.db
        .select()
        .from(tasks)
        .where(and(...baseConditions, ...conditions))
        .orderBy(desc(tasks.createdAt), desc(tasks.seq))
        .limit(limit)
        .offset(offset);

      return {
        conditions,
        key: `priority:${priority}`,
        limit,
        offset,
        prefetchedTasks,
        priority,
        total: 0,
      };
    });
    const [countResult, queriedGroups] = await Promise.all([countQuery, Promise.all(taskQueries)]);
    const priorityCounts = new Map<number, number>();
    for (const row of countResult) {
      const priority = row.priority ?? 0;
      priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + Number(row.count));
    }

    // Priority is a finite dimension, so include empty values as usable drop
    // targets. The order matches the task list's semantic rank.
    groupQueries = queriedGroups.map((group) => ({
      ...group,
      total: priorityCounts.get(group.priority) ?? 0,
    }));
  } else {
    /* v8 ignore next -- unreachable: `groupBy` is exhausted above, so the guard at the top already proved `groups` non-empty */
    const statusGroups = (groups ?? []).map((group) => ({
      ...group,
      statuses: Array.from(new Set(group.statuses)),
    }));
    const allStatuses = Array.from(new Set(statusGroups.flatMap((group) => group.statuses)));
    const countQuery = ctx.db
      .select({ count: sql<number>`count(*)`, status: tasks.status })
      .from(tasks)
      .where(and(...baseConditions, inArray(tasks.status, allStatuses)))
      .groupBy(tasks.status);
    const taskQueries = statusGroups.map(async (group) => {
      const conditions = [inArray(tasks.status, group.statuses)];
      const limit = group.limit ?? 50;
      const offset = group.offset ?? 0;
      const prefetchedTasks = await ctx.db
        .select()
        .from(tasks)
        .where(and(...baseConditions, ...conditions))
        .orderBy(desc(tasks.createdAt), desc(tasks.seq))
        .limit(limit)
        .offset(offset);

      return {
        conditions,
        key: group.key,
        limit,
        offset,
        prefetchedTasks,
        statuses: group.statuses,
        total: 0,
      };
    });
    const [countResult, queriedGroups] = await Promise.all([countQuery, Promise.all(taskQueries)]);
    const countByStatus = new Map(countResult.map((row) => [row.status, Number(row.count)]));

    groupQueries = queriedGroups.map(({ statuses, ...group }) => ({
      ...group,
      total: statuses.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0),
    }));
  }

  const results = await Promise.all(
    groupQueries.map(async (group) => {
      const groupTasks =
        group.prefetchedTasks ??
        /* v8 ignore start -- unreachable: every grouping branch above prefetches its tasks. The stop marker sits after the return because V8 charges the continuation of this never-resumed `await` to the statement that follows it */
        (await ctx.db
          .select()
          .from(tasks)
          .where(and(...baseConditions, ...group.conditions))
          .orderBy(desc(tasks.createdAt), desc(tasks.seq))
          .limit(group.limit)
          .offset(group.offset));

      return {
        ...(group.assigneeAgentId !== undefined ? { assigneeAgentId: group.assigneeAgentId } : {}),
        ...(group.assigneeUserId !== undefined ? { assigneeUserId: group.assigneeUserId } : {}),
        hasMore: group.offset + groupTasks.length < group.total,
        key: group.key,
        limit: group.limit,
        offset: group.offset,
        ...(group.priority !== undefined ? { priority: group.priority } : {}),
        tasks: groupTasks,
        total: group.total,
      };
      /* v8 ignore stop */
    }),
  );

  const taskIds = Array.from(new Set(results.flatMap((group) => group.tasks.map(({ id }) => id))));
  const [runStats, subtaskProgressByTaskId] = await Promise.all([
    runStatsByTaskIds(ctx, taskIds),
    subtaskProgressByTaskIds(ctx, taskIds),
  ]);
  const runStatsByTaskId = new Map(
    runStats.map((stats) => [
      stats.root_id,
      {
        totalRunCost: Number(stats.total_run_cost),
        totalRunDuration: Number(stats.total_run_duration),
      },
    ]),
  );

  return results.map((group) => ({
    ...group,
    tasks: group.tasks.map((task) => ({
      ...task,
      subtaskProgress: subtaskProgressByTaskId.get(task.id),
      totalRunCost: runStatsByTaskId.get(task.id)?.totalRunCost ?? 0,
      totalRunDuration: runStatsByTaskId.get(task.id)?.totalRunDuration ?? 0,
    })),
  }));
};

export const runStatsByTaskIds = async (
  ctx: TaskModelContext,
  taskIds: string[],
): Promise<TaskRunStats[]> => {
  if (taskIds.length === 0) return [];

  const result = await ctx.db.execute<TaskRunStats>(sql`
    WITH RECURSIVE goal_tree AS (
      SELECT ${tasks.id} AS root_id, ${tasks.id} AS task_id
      FROM ${tasks}
      WHERE ${inArray(tasks.id, taskIds)} AND ${taskOwnership(ctx)}
      UNION ALL
      SELECT goal_tree.root_id, child.id
      FROM ${tasks} child
      JOIN goal_tree ON child.parent_task_id = goal_tree.task_id
      WHERE ${taskOwnershipSql(ctx, 'child')}
    )
    SELECT
      goal_tree.root_id,
      coalesce(sum(${topics.totalCost}), 0) AS total_run_cost,
      coalesce(
        sum(extract(epoch from (${topics.completedAt} - ${taskTopics.createdAt})) * 1000)
          filter (where ${topics.completedAt} is not null),
        0
      ) AS total_run_duration
    FROM goal_tree
    LEFT JOIN ${taskTopics} ON ${taskTopics.taskId} = goal_tree.task_id
    LEFT JOIN ${topics} ON ${topics.id} = ${taskTopics.topicId}
    GROUP BY goal_tree.root_id
  `);

  return result.rows;
};

export const subtaskProgressByTaskIds = async (
  ctx: TaskModelContext,
  taskIds: string[],
): Promise<Map<string, TaskSubtaskProgress>> => {
  if (taskIds.length === 0) return new Map();

  const result = await ctx.db.execute<TaskSubtaskProgressRow>(sql`
    WITH RECURSIVE task_tree AS (
      SELECT ${tasks.id} AS root_id, ${tasks.id} AS task_id, ${tasks.status} AS status
      FROM ${tasks}
      WHERE ${inArray(tasks.id, taskIds)} AND ${taskOwnership(ctx)}
      UNION ALL
      SELECT task_tree.root_id, child.id, child.status
      FROM ${tasks} child
      JOIN task_tree ON child.parent_task_id = task_tree.task_id
      WHERE ${taskOwnershipSql(ctx, 'child')}
    )
    SELECT
      task_tree.root_id,
      count(*) filter (
        where task_tree.task_id <> task_tree.root_id and task_tree.status = 'completed'
      ) AS completed,
      count(*) filter (where task_tree.task_id <> task_tree.root_id) AS total
    FROM task_tree
    GROUP BY task_tree.root_id
  `);

  return new Map(
    result.rows.map((progress) => [
      progress.root_id,
      { completed: Number(progress.completed), total: Number(progress.total) },
    ]),
  );
};

export const list = async (
  ctx: TaskModelContext,
  options: TaskListOptions = {},
): Promise<{ tasks: TaskItem[]; total: number }> => {
  const { after, statuses, priorities, limit = 50, offset = 0, orderBy = 'createdAt' } = options;
  const orderColumn = orderBy === 'updatedAt' ? tasks.updatedAt : tasks.createdAt;

  const conditions = buildListConditions(ctx, options);

  if (statuses?.length) conditions.push(inArray(tasks.status, statuses));
  if (priorities?.length) conditions.push(inArray(tasks.priority, priorities));
  if (after) {
    conditions.push(
      or(
        lt(orderColumn, after.at),
        and(eq(orderColumn, after.at), lt(tasks.seq, after.seq)),
      ) as SQL,
    );
  }

  const where = and(...conditions);

  const countQuery = ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(where);

  const taskListQuery = ctx.db
    .select()
    .from(tasks)
    .where(where)
    // `seq` breaks timestamp ties so the order is total — required for the
    // keyset cursor above and for offset pages to never repeat or skip a row.
    .orderBy(desc(orderColumn), desc(tasks.seq))
    .limit(limit)
    .offset(offset);
  const [countResult, taskList] = await Promise.all([countQuery, taskListQuery]);
  const subtaskProgressByTaskId = await subtaskProgressByTaskIds(
    ctx,
    taskList.map(({ id }) => id),
  );

  return {
    tasks: taskList.map((task) => ({
      ...task,
      subtaskProgress: subtaskProgressByTaskId.get(task.id),
    })),
    total: Number(countResult[0].count),
  };
};
