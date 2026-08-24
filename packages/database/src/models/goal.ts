import type { GoalStatus, GoalSubjectType } from '@lobechat/const/goal';
import type { TaskItem } from '@lobechat/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { GoalItem, NewGoal } from '../schemas/goal';
import { goals } from '../schemas/goal';
import { goalNodes } from '../schemas/goalGraph';
import { tasks, taskTopics } from '../schemas/task';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** States after which a goal's loop no longer advances. */
const TERMINAL_GOAL_STATUSES = new Set<GoalStatus>(['achieved', 'failed', 'canceled']);

/**
 * Owns the `goals` table: one row per goal — an independent target entity with
 * its own definition (title / requirement), budget and lifecycle state. The
 * execution carrier is a polymorphic (`subjectType`, `subjectId`) link (task /
 * topic / standalone); everything execution-specific (rounds run, cost spent,
 * acceptance checks) stays on the carrier and its tables and is derived at
 * read time, never denormalized here.
 */
export class GoalModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals);

  /** Visibility-aware task scope for recursive raw-SQL carrier aggregation. */
  private taskOwnershipSql = (alias?: string) => {
    const prefix = alias ? sql.raw(`${alias}.`) : sql.raw('');
    return this.workspaceId
      ? sql`${prefix}workspace_id = ${this.workspaceId}
            AND (${prefix}visibility = 'public' OR ${prefix}created_by_user_id = ${this.userId})`
      : sql`${prefix}created_by_user_id = ${this.userId} AND ${prefix}workspace_id IS NULL`;
  };

  create = async (params: Omit<NewGoal, 'userId' | 'workspaceId'>): Promise<GoalItem> => {
    const [row] = await this.db
      .insert(goals)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();
    return row;
  };

  findById = async (id: string): Promise<GoalItem | undefined> => {
    return this.db.query.goals.findFirst({ where: and(eq(goals.id, id), this.ownership()) });
  };

  /** The goal bound to a carrier, or undefined when the subject carries none. */
  findBySubject = async (
    subjectType: GoalSubjectType,
    subjectId: string,
  ): Promise<GoalItem | undefined> => {
    return this.db.query.goals.findFirst({
      where: and(
        eq(goals.subjectType, subjectType),
        eq(goals.subjectId, subjectId),
        this.ownership(),
      ),
    });
  };

  /** The Goal Graph that owns a Work Task, or undefined when the task is not graph-managed. */
  findByWorkTask = async (taskId: string): Promise<GoalItem | undefined> => {
    const [row] = await this.db
      .select({ goal: goals })
      .from(goalNodes)
      .innerJoin(goals, eq(goalNodes.goalId, goals.id))
      .where(and(eq(goalNodes.taskId, taskId), eq(goalNodes.kind, 'work'), this.ownership()))
      .limit(1);
    return row?.goal;
  };

  /**
   * The goals of many carriers in one read — for list surfaces (goal rail /
   * goals page) that already queried the carriers and need each row's goal
   * without a request per row.
   */
  listBySubjects = async (subjectType: GoalSubjectType, subjectIds: string[]) => {
    if (subjectIds.length === 0) return [];

    return this.db
      .select()
      .from(goals)
      .where(
        and(
          eq(goals.subjectType, subjectType),
          inArray(goals.subjectId, subjectIds),
          this.ownership(),
        ),
      );
  };

  /** Recent goals for the current scope, newest first. */
  query = async (limit = 50) => {
    return this.db.query.goals.findMany({
      limit,
      orderBy: [desc(goals.createdAt)],
      where: this.ownership(),
    });
  };

  update = async (id: string, value: Partial<Omit<GoalItem, 'id' | 'userId'>>) => {
    const [row] = await this.db
      .update(goals)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(goals.id, id), this.ownership()))
      .returning();
    return row as GoalItem | undefined;
  };

  /**
   * Advance the lifecycle state, stamping the boundary timestamps as a side
   * effect: first entry into `running` records `startedAt`, any terminal state
   * records `completedAt` (and re-opening a terminal goal clears it).
   */
  updateStatus = async (id: string, status: GoalStatus) => {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return this.update(id, {
      completedAt: TERMINAL_GOAL_STATUSES.has(status) ? (existing.completedAt ?? new Date()) : null,
      startedAt: existing.startedAt ?? (status === 'running' ? new Date() : null),
      status,
    });
  };

  delete = async (id: string) => {
    return this.db.delete(goals).where(and(eq(goals.id, id), this.ownership()));
  };

  deleteBySubject = async (subjectType: GoalSubjectType, subjectId: string) => {
    return this.db
      .delete(goals)
      .where(
        and(eq(goals.subjectType, subjectType), eq(goals.subjectId, subjectId), this.ownership()),
      );
  };

  /**
   * List goals with their execution-carrier task and subtree run statistics.
   * Each item is TaskItem-shaped with the goal row attached as `goal` and the
   * run cost / duration aggregated across the whole task subtree — mirroring
   * `TaskModel.groupList`'s `goal_tree` recursive CTE, so the goal UI reads
   * the goal's own lifecycle state the same way from either endpoint.
   */
  list = async (
    options: {
      agentId?: string;
      limit?: number;
      offset?: number;
      projectId?: string;
      statuses?: GoalStatus[];
    } = {},
  ): Promise<{ goals: GoalListItem[]; total: number }> => {
    const { agentId, limit = 50, offset = 0, projectId, statuses } = options;

    // A list item is backed by a carrier task, so task visibility is the
    // effective read boundary. Goal rows themselves intentionally have no
    // visibility column and workspace ownership alone is not sufficient.
    const taskOwnership = buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: tasks.createdByUserId,
        visibility: tasks.visibility,
        workspaceId: tasks.workspaceId,
      },
    );
    const conditions = [
      this.ownership(),
      eq(goals.subjectType, 'task'),
      eq(goals.subjectId, tasks.id),
      taskOwnership,
    ];
    // Scope against the current carrier instead of the goal's creation-time
    // snapshot, because tasks can be reassigned or moved between projects.
    if (agentId) conditions.push(eq(tasks.assigneeAgentId, agentId));
    if (projectId) conditions.push(eq(tasks.projectId, projectId));
    if (statuses && statuses.length > 0) conditions.push(inArray(goals.status, statuses));

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(goals)
      .innerJoin(tasks, eq(goals.subjectId, tasks.id))
      .where(and(...conditions));

    const total = Number(countRow?.count ?? 0);
    if (total === 0) return { goals: [], total };

    const rows = await this.db
      .select({ goal: goals, task: tasks })
      .from(goals)
      .innerJoin(tasks, eq(goals.subjectId, tasks.id))
      .where(and(...conditions))
      .orderBy(desc(goals.createdAt))
      .limit(limit)
      .offset(offset);

    const taskIds = rows.map(({ task }) => task.id);

    const runStats =
      taskIds.length === 0
        ? []
        : (
            await this.db.execute<{
              root_id: string;
              total_run_cost: number;
              total_run_duration: number;
            }>(sql`
              WITH RECURSIVE goal_tree AS (
                SELECT ${tasks.id} AS root_id, ${tasks.id} AS task_id
                FROM ${tasks}
                WHERE ${inArray(tasks.id, taskIds)} AND ${this.taskOwnershipSql()}
                UNION ALL
                SELECT goal_tree.root_id, child.id
                FROM ${tasks} child
                JOIN goal_tree ON child.parent_task_id = goal_tree.task_id
                WHERE ${this.taskOwnershipSql('child')}
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
            `)
          ).rows;

    const runStatsByTaskId = new Map(
      runStats.map((s) => [
        s.root_id,
        {
          totalRunCost: Number(s.total_run_cost),
          totalRunDuration: Number(s.total_run_duration),
        },
      ]),
    );

    const items: GoalListItem[] = rows.map(({ goal, task }) => {
      const stats = runStatsByTaskId.get(task.id) ?? { totalRunCost: 0, totalRunDuration: 0 };

      return {
        ...task,
        goal,
        totalRunCost: stats.totalRunCost,
        totalRunDuration: stats.totalRunDuration,
      };
    });

    return { goals: items, total };
  };
}

/** A goal-list item: the carrier task plus the attached goal row and the
 *  subtree run statistics. */
export interface GoalListItem extends TaskItem {
  goal: GoalItem | null;
  totalRunCost: number;
  totalRunDuration: number;
}
