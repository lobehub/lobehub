import type { GoalStatus } from '@lobechat/const/goal';
import type { GoalNodeStatus } from '@lobechat/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { GoalItem, NewGoal } from '../schemas/goal';
import { goals } from '../schemas/goal';
import { goalNodeDecisions, goalNodes } from '../schemas/goalGraph';
import { tasks, taskTopics } from '../schemas/task';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** States after which a goal's loop no longer advances. */
const TERMINAL_GOAL_STATUSES = new Set<GoalStatus>(['achieved', 'failed', 'canceled']);

/** Node states the coordinator will never pick up again. */
const TERMINAL_NODE_STATUSES = new Set<GoalNodeStatus>(['resolved', 'rejected', 'retired']);

/**
 * Owns the `goals` table: one row per goal — an independent target entity with
 * its own definition (title / requirement), budget and lifecycle state.
 *
 * Execution lives in the goal's graph, not on the goal row: the coordinator
 * dispatches a Task per Work node, and everything execution-specific (attempts,
 * cost, acceptance) is derived from those tasks at read time.
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

  /**
   * The goal owns a Goal Graph. `goal.create` always seeds a problem node and
   * the opening Work, so this is exactly "not a leftover from the old
   * task-carried flow".
   */
  private static hasGraphSql = sql`EXISTS (
    SELECT 1 FROM ${goalNodes} WHERE ${goalNodes.goalId} = ${goals.id}
  )`;

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

  /** The Goal Graph that owns a Work Task, or undefined when the task is not graph-managed. */
  findByWorkTask = async (taskId: string): Promise<GoalItem | undefined> => {
    const [row] = await this.db
      .select({ goal: goals })
      .from(goalNodes)
      .innerJoin(goals, eq(goalNodes.goalId, goals.id))
      .where(and(eq(goalNodes.taskId, taskId), eq(goalNodes.kind, 'task'), this.ownership()))
      .limit(1);
    return row?.goal;
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
   * Atomically take `planning → running` as the decomposition claim: several
   * concurrent advances can all see an unplanned goal, and only the one this
   * conditional write succeeds for may seed the graph. `startedAt` is stamped
   * here because the later dispatch transition becomes a same-status no-op.
   */
  claimPlanning = async (id: string) => {
    const [row] = await this.db
      .update(goals)
      .set({
        startedAt: sql`coalesce(${goals.startedAt}, now())`,
        status: 'running',
        updatedAt: new Date(),
      })
      .where(and(eq(goals.id, id), eq(goals.status, 'planning'), this.ownership()))
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

  /**
   * Open goals that nothing is currently moving — the sweep's work list.
   *
   * A goal qualifies when it is still open and has no Work node that is both
   * `active` and freshly touched: either nothing was ever dispatched, the
   * completion event that should have re-entered the coordinator was lost, or a
   * running Work outlived its operation lease and needs reclaiming. Goals with a
   * decision gate open are excluded — only a human moves those, and ticking them
   * would just report `waiting_human` on every sweep.
   *
   * Global by design (no ownership filter): the sweep runs as infrastructure and
   * carries each goal's own `userId` / `workspaceId` into its advance.
   */
  static async listStalled(
    db: LobeChatDatabase,
    options: { limit?: number; staleBefore: Date },
  ): Promise<GoalItem[]> {
    const { limit = 200, staleBefore } = options;

    return db
      .select()
      .from(goals)
      .where(
        and(
          inArray(goals.status, ['planning', 'running', 'verifying']),
          // A graph-less legacy goal has no frontier, so every sweep would
          // tick it only to report `no_progress`. Leave it alone.
          GoalModel.hasGraphSql,
          sql`NOT EXISTS (
            SELECT 1 FROM ${goalNodes}
            WHERE ${goalNodes.goalId} = ${goals.id}
              AND ${goalNodes.kind} = 'task'
              AND ${goalNodes.status} = 'active'
              AND ${goalNodes.updatedAt} > ${staleBefore}
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${goalNodeDecisions}
            JOIN ${goalNodes} AS gate ON gate.id = ${goalNodeDecisions.nodeId}
            WHERE gate.goal_id = ${goals.id}
              AND ${goalNodeDecisions.status} = 'pending'
          )`,
        ),
      )
      .orderBy(desc(goals.updatedAt))
      .limit(limit);
  }

  /**
   * List goals with the roll-up the goal surfaces render: how much of the
   * graph is done, how many decisions are waiting on a human, and what the
   * whole thing has cost so far.
   *
   * Goal-centric on purpose. Goals used to be listed through their carrier
   * task, which made a goal without one invisible; a Goal Graph goal is
   * `standalone`, so the list reads the `goals` table and derives execution
   * facts from the graph's Work tasks.
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

    // Only goals that actually have a graph. Rows created by the earlier
    // task-carried flow have no `goal_nodes`, so they would render as a
    // zero-work goal page that can never advance; they stay out of the list
    // until something backfills them into graphs.
    const conditions = [this.ownership(), GoalModel.hasGraphSql];
    if (agentId) conditions.push(eq(goals.agentId, agentId));
    if (projectId) conditions.push(eq(goals.projectId, projectId));
    if (statuses && statuses.length > 0) conditions.push(inArray(goals.status, statuses));

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(goals)
      .where(and(...conditions));

    const total = Number(countRow?.count ?? 0);
    if (total === 0) return { goals: [], total };

    const rows = await this.db
      .select()
      .from(goals)
      .where(and(...conditions))
      .orderBy(desc(goals.createdAt))
      .limit(limit)
      .offset(offset);

    const goalIds = rows.map((goal) => goal.id);
    const [nodeRows, decisionRows, runStats] = await Promise.all([
      this.db
        .select({
          goalId: goalNodes.goalId,
          kind: goalNodes.kind,
          status: goalNodes.status,
          count: sql<number>`count(*)`,
        })
        .from(goalNodes)
        .where(inArray(goalNodes.goalId, goalIds))
        .groupBy(goalNodes.goalId, goalNodes.kind, goalNodes.status),
      this.db
        .select({ goalId: goalNodes.goalId, count: sql<number>`count(*)` })
        .from(goalNodeDecisions)
        .innerJoin(goalNodes, eq(goalNodeDecisions.nodeId, goalNodes.id))
        .where(and(inArray(goalNodes.goalId, goalIds), eq(goalNodeDecisions.status, 'pending')))
        .groupBy(goalNodes.goalId),
      this.workTaskRunStats(goalIds),
    ]);

    const stats = new Map<string, { findingCount: number; workDone: number; workTotal: number }>();
    for (const row of nodeRows) {
      const current = stats.get(row.goalId) ?? { findingCount: 0, workDone: 0, workTotal: 0 };
      const count = Number(row.count);
      if (row.kind === 'finding') current.findingCount += count;
      if (row.kind === 'task') {
        current.workTotal += count;
        if (TERMINAL_NODE_STATUSES.has(row.status)) current.workDone += count;
      }
      stats.set(row.goalId, current);
    }
    const pendingByGoal = new Map(decisionRows.map((row) => [row.goalId, Number(row.count)]));

    const items: GoalListItem[] = rows.map((goal) => {
      const counts = stats.get(goal.id) ?? { findingCount: 0, workDone: 0, workTotal: 0 };
      const run = runStats.get(goal.id) ?? { totalRunCost: 0, totalRunDuration: 0 };
      return {
        findingCount: counts.findingCount,
        goal,
        pendingDecisions: pendingByGoal.get(goal.id) ?? 0,
        totalRunCost: run.totalRunCost,
        totalRunDuration: run.totalRunDuration,
        workDone: counts.workDone,
        workTotal: counts.workTotal,
      };
    });

    return { goals: items, total };
  };

  /**
   * Cost and runtime across every task the graph dispatched, including tasks
   * those Work tasks spawned themselves — the same subtree rule the task board
   * uses, seeded from the Work nodes instead of one carrier root.
   */
  private workTaskRunStats = async (goalIds: string[]) => {
    if (goalIds.length === 0)
      return new Map<string, { totalRunCost: number; totalRunDuration: number }>();

    const { rows } = await this.db.execute<{
      goal_id: string;
      total_run_cost: number;
      total_run_duration: number;
    }>(sql`
      WITH RECURSIVE work_tree AS (
        SELECT ${goalNodes.goalId} AS goal_id, ${tasks.id} AS task_id
        FROM ${goalNodes}
        JOIN ${tasks} ON ${tasks.id} = ${goalNodes.taskId}
        WHERE ${inArray(goalNodes.goalId, goalIds)}
          AND ${goalNodes.kind} = 'task'
          AND ${this.taskOwnershipSql('tasks')}
        UNION ALL
        SELECT work_tree.goal_id, child.id
        FROM ${tasks} child
        JOIN work_tree ON child.parent_task_id = work_tree.task_id
        WHERE ${this.taskOwnershipSql('child')}
      )
      SELECT
        work_tree.goal_id,
        coalesce(sum(${topics.totalCost}), 0) AS total_run_cost,
        coalesce(
          sum(extract(epoch from (${topics.completedAt} - ${taskTopics.createdAt})) * 1000)
            filter (where ${topics.completedAt} is not null),
          0
        ) AS total_run_duration
      FROM work_tree
      LEFT JOIN ${taskTopics} ON ${taskTopics.taskId} = work_tree.task_id
      LEFT JOIN ${topics} ON ${topics.id} = ${taskTopics.topicId}
      GROUP BY work_tree.goal_id
    `);

    return new Map(
      rows.map((row) => [
        row.goal_id,
        {
          totalRunCost: Number(row.total_run_cost),
          totalRunDuration: Number(row.total_run_duration),
        },
      ]),
    );
  };
}

/**
 * A goal-list row: the goal itself plus the graph roll-up the list renders —
 * how far the exploration got, what is blocked on a human, and what it cost.
 */
export interface GoalListItem {
  findingCount: number;
  goal: GoalItem;
  /** Decision gates waiting on a human right now. */
  pendingDecisions: number;
  totalRunCost: number;
  totalRunDuration: number;
  workDone: number;
  workTotal: number;
}
