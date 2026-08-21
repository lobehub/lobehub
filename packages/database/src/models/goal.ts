import type { GoalStatus, GoalSubjectType } from '@lobechat/const/goal';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { GoalItem, NewGoal } from '../schemas/goal';
import { goals } from '../schemas/goal';
import { taskTopics, tasks } from '../schemas/task';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import type { TaskItem } from './task';

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
  list = async (options: {
    agentId?: string;
    limit?: number;
    offset?: number;
    projectId?: string;
    statuses?: GoalStatus[];
  } = {}): Promise<{ goals: GoalListItem[]; total: number }> => {
    const { agentId, limit = 50, offset = 0, projectId, statuses } = options;

    const conditions = [this.ownership()];
    if (agentId) conditions.push(eq(goals.agentId, agentId));
    if (projectId) conditions.push(eq(goals.projectId, projectId));
    if (statuses && statuses.length > 0) conditions.push(inArray(goals.status, statuses));

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(goals)
      .where(and(...conditions));

    const total = Number(countRow?.count ?? 0);
    if (total === 0) return { goals: [], total };

    const goalRows = await this.db
      .select()
      .from(goals)
      .where(and(...conditions))
      .orderBy(desc(goals.createdAt))
      .limit(limit)
      .offset(offset);

    const taskIds = goalRows
      .filter((g) => g.subjectType === 'task' && g.subjectId)
      .map((g) => g.subjectId!);

    const taskRows =
      taskIds.length === 0
        ? []
        : await this.db.select().from(tasks).where(inArray(tasks.id, taskIds));
    const taskByTaskId = new Map(taskRows.map((t) => [t.id, t]));

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
                WHERE ${inArray(tasks.id, taskIds)}
                UNION ALL
                SELECT goal_tree.root_id, child.id
                FROM ${tasks} child
                JOIN goal_tree ON child.parent_task_id = goal_tree.task_id
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

    const items: GoalListItem[] = goalRows.flatMap((goal) => {
      if (goal.subjectType !== 'task' || !goal.subjectId) return [];
      const task = taskByTaskId.get(goal.subjectId);
      if (!task) return [];

      const stats = runStatsByTaskId.get(task.id) ?? { totalRunCost: 0, totalRunDuration: 0 };

      return [
        {
          ...task,
          goal,
          totalRunCost: stats.totalRunCost,
          totalRunDuration: stats.totalRunDuration,
        },
      ];
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
