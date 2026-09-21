import type { BriefDecision, TaskTopicHandoff } from '@lobechat/types';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import type { TaskTopicItem } from '../schemas/task';
import { tasks, taskTopics } from '../schemas/task';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

const TERMINAL_TOPIC_STATUSES = new Set(['canceled', 'completed', 'failed', 'timeout']);

export class TaskTopicModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: taskTopics.userId,
        visibility: taskTopics.visibility,
        workspaceId: taskTopics.workspaceId,
      },
    );

  /** Look up the parent task's visibility so newly added topics mirror it. */
  private async getTaskVisibility(taskId: string): Promise<'private' | 'public'> {
    const row = await this.db
      .select({ visibility: tasks.visibility })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return row[0]?.visibility ?? 'public';
  }

  /**
   * Mirror a terminal taskTopic transition onto the underlying topic record:
   * stamp `topics.completedAt` so duration can be computed at read time, and
   * promote `topics.status` to 'completed' on a clean finish.
   */
  private async markTopicEnded(topicId: string, status: string): Promise<void> {
    const setClause: { completedAt: Date; status?: 'completed' } = { completedAt: new Date() };
    if (status === 'completed') setClause.status = 'completed';

    await this.db
      .update(topics)
      .set(setClause)
      .where(
        and(
          eq(topics.id, topicId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
        ),
      );
  }

  async add(
    taskId: string,
    topicId: string,
    params: {
      operationId?: string;
      seq: number;
      trigger?: 'manual' | 'schedule' | 'heartbeat' | 'goal';
    },
  ): Promise<void> {
    const visibility = await this.getTaskVisibility(taskId);
    await this.db
      .insert(taskTopics)
      .values({
        operationId: params.operationId,
        seq: params.seq,
        taskId,
        topicId,
        trigger: params.trigger,
        userId: this.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing();
  }

  async updateStatus(taskId: string, topicId: string, status: string): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({ status })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()));

    if (TERMINAL_TOPIC_STATUSES.has(status)) {
      await this.markTopicEnded(topicId, status);
    }
  }

  /**
   * Atomically cancel a topic only if it is still in `running` status.
   * Returns true if a row was actually updated.
   */
  async cancelIfRunning(taskId: string, topicId: string): Promise<boolean> {
    const result = await this.db
      .update(taskTopics)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.status, 'running'),
          this.ownership(),
        ),
      )
      .returning();

    const updated = result.length > 0;
    if (updated) await this.markTopicEnded(topicId, 'canceled');
    return updated;
  }

  /**
   * Cancel every still-running topic under the given tasks in one statement,
   * returning the rows that were actually flipped. Used by the family status
   * cascade so a topic that started after the caller's snapshot is still
   * marked canceled inside the same transaction as the status update.
   */
  async cancelRunningByTaskIds(taskIds: string[]): Promise<TaskTopicItem[]> {
    if (taskIds.length === 0) return [];

    const canceled = await this.db
      .update(taskTopics)
      .set({ status: 'canceled' })
      .where(
        and(
          inArray(taskTopics.taskId, taskIds),
          eq(taskTopics.status, 'running'),
          this.ownership(),
        ),
      )
      .returning();

    for (const topic of canceled) {
      if (topic.topicId) await this.markTopicEnded(topic.topicId, 'canceled');
    }

    return canceled;
  }

  async updateOperationId(taskId: string, topicId: string, operationId?: string): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({ operationId })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()));
  }

  async updateHandoff(taskId: string, topicId: string, handoff: TaskTopicHandoff): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({ handoff })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()));
  }

  /**
   * Patch the `briefDecision` field inside the handoff JSONB without
   * disturbing other handoff keys (`title` / `summary` / `keyFindings` /
   * `nextAction`). Uses `jsonb_set` so the operation is order-independent
   * with respect to `updateHandoff` — either can run first.
   */
  async updateBriefDecision(
    taskId: string,
    topicId: string,
    decision: BriefDecision,
  ): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({
        handoff: sql`jsonb_set(COALESCE(${taskTopics.handoff}, '{}'::jsonb), '{briefDecision}', ${JSON.stringify(decision)}::jsonb)`,
      })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()));
  }

  /**
   * Patch the raw run output into `handoff.content` without
   * disturbing other handoff keys. Uses `jsonb_set` so it is order-independent
   * with respect to `updateHandoff` — critically, this lets the caller persist
   * the last message even when the (separate) handoff-summary LLM call fails, so
   * the run card always has a result to show.
   */
  async updateHandoffContent(taskId: string, topicId: string, content: string): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({
        handoff: sql`jsonb_set(COALESCE(${taskTopics.handoff}, '{}'::jsonb), '{content}', ${JSON.stringify(content)}::jsonb)`,
      })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()));
  }

  async updateReview(
    taskId: string,
    topicId: string,
    review: {
      iteration: number;
      passed: boolean;
      score: number;
      scores: any[];
    },
  ): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({
        reviewIteration: review.iteration,
        reviewPassed: review.passed ? 1 : 0,
        reviewScore: review.score,
        reviewScores: review.scores,
        reviewedAt: new Date(),
      })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()));
  }

  async timeoutRunning(taskId: string): Promise<number> {
    const result = await this.db
      .update(taskTopics)
      .set({ status: 'timeout' })
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.status, 'running'), this.ownership()))
      .returning({ topicId: taskTopics.topicId });

    await Promise.all(
      result
        .map((r) => r.topicId)
        .filter((id): id is string => !!id)
        .map((id) => this.markTopicEnded(id, 'timeout')),
    );

    return result.length;
  }

  async findByTopicId(topicId: string): Promise<TaskTopicItem | null> {
    const result = await this.db
      .select()
      .from(taskTopics)
      .where(and(eq(taskTopics.topicId, topicId), this.ownership()))
      .limit(1);
    return result[0] || null;
  }

  /**
   * Count a task's runs, optionally scoped by creation time and/or trigger
   * source.
   *
   * `triggers` filters on the `trigger` column so the maxExecutions quota can
   * count only automation ticks and ignore ad-hoc manual runs.
   * Legacy rows have a NULL trigger; they are excluded whenever `triggers` is
   * passed (they predate the column and can't be attributed to a schedule).
   */
  async countByTask(
    taskId: string,
    options?: { since?: Date; triggers?: Array<'manual' | 'schedule' | 'heartbeat' | 'goal'> },
  ): Promise<number> {
    const conditions = [eq(taskTopics.taskId, taskId), this.ownership()];
    if (options?.since) conditions.push(gte(taskTopics.createdAt, options.since));
    if (options?.triggers?.length) conditions.push(inArray(taskTopics.trigger, options.triggers));

    const rows = await this.db
      .select({ value: count() })
      .from(taskTopics)
      .where(and(...conditions));
    return rows[0]?.value ?? 0;
  }

  async findByTaskId(taskId: string): Promise<TaskTopicItem[]> {
    return this.db
      .select()
      .from(taskTopics)
      .where(and(eq(taskTopics.taskId, taskId), this.ownership()))
      .orderBy(desc(taskTopics.seq));
  }

  async findRunningByTaskIds(taskIds: string[]): Promise<TaskTopicItem[]> {
    if (taskIds.length === 0) return [];

    return this.db
      .select()
      .from(taskTopics)
      .where(
        and(
          inArray(taskTopics.taskId, taskIds),
          eq(taskTopics.status, 'running'),
          this.ownership(),
        ),
      )
      .orderBy(desc(taskTopics.seq));
  }

  async findWithDetails(taskId: string) {
    return this.db
      .select({
        createdAt: topics.createdAt,
        handoff: taskTopics.handoff,
        id: topics.id,
        metadata: topics.metadata,
        operationId: taskTopics.operationId,
        reviewIteration: taskTopics.reviewIteration,
        reviewPassed: taskTopics.reviewPassed,
        reviewScore: taskTopics.reviewScore,
        reviewScores: taskTopics.reviewScores,
        reviewedAt: taskTopics.reviewedAt,
        seq: taskTopics.seq,
        status: taskTopics.status,
        title: topics.title,
        updatedAt: topics.updatedAt,
      })
      .from(taskTopics)
      .innerJoin(topics, eq(taskTopics.topicId, topics.id))
      .where(and(eq(taskTopics.taskId, taskId), this.ownership()))
      .orderBy(desc(taskTopics.seq));
  }

  async findWithHandoff(taskId: string, limit: number) {
    return this.db
      .select({
        // The agent that actually ran this topic — used so each activity row
        // keeps its own avatar instead of inheriting the task's *current*
        // assignee (which changes when the task is reassigned).
        agentId: topics.agentId,
        completedAt: topics.completedAt,
        totalCost: topics.totalCost,
        createdAt: taskTopics.createdAt,
        handoff: taskTopics.handoff,
        metadata: topics.metadata,
        operationId: taskTopics.operationId,
        seq: taskTopics.seq,
        status: taskTopics.status,
        title: topics.title,
        topicId: taskTopics.topicId,
        trigger: taskTopics.trigger,
      })
      .from(taskTopics)
      .leftJoin(topics, eq(taskTopics.topicId, topics.id))
      .where(and(eq(taskTopics.taskId, taskId), this.ownership()))
      .orderBy(desc(taskTopics.seq))
      .limit(limit);
  }

  /**
   * A goal's spend and round count in one aggregate: how many runs those tasks
   * produced and what they cost.
   *
   * The Goal page renders these numbers and the coordinator enforces the budget
   * against them, so both read them from here — a second definition of "what
   * this goal has spent" would let the header disagree with the move that
   * parks the goal on `budget_exhausted`.
   *
   * `topics.totalCost` is NULL for a run that has not settled yet; those count
   * as a round but contribute nothing to the sum.
   */
  async sumRunCostByTaskIds(taskIds: string[]): Promise<{
    byTask: { runs: number; taskId: string; totalCost: number; totalTokens: number }[];
    runs: number;
    totalCost: number;
    totalTokens: number;
  }> {
    if (taskIds.length === 0) return { byTask: [], runs: 0, totalCost: 0, totalTokens: 0 };

    // Grouped once, then folded — one round trip serves both the enforced
    // total and the per-Task breakdown the cost panel lists.
    const rows = await this.db
      .select({
        runs: count(),
        taskId: taskTopics.taskId,
        totalCost: sql<string>`coalesce(sum(${topics.totalCost}), 0)`,
        totalTokens: sql<string>`coalesce(sum(${topics.totalTokens}), 0)`,
      })
      .from(taskTopics)
      .leftJoin(topics, eq(taskTopics.topicId, topics.id))
      .where(and(inArray(taskTopics.taskId, taskIds), this.ownership()))
      .groupBy(taskTopics.taskId);

    const byTask = rows.map((row) => ({
      runs: row.runs,
      taskId: row.taskId,
      totalCost: Number(row.totalCost ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
    }));

    return {
      byTask,
      runs: byTask.reduce((sum, row) => sum + row.runs, 0),
      totalCost: byTask.reduce((sum, row) => sum + row.totalCost, 0),
      totalTokens: byTask.reduce((sum, row) => sum + row.totalTokens, 0),
    };
  }

  async findWithHandoffByTaskIds(taskIds: string[], limit: number) {
    if (taskIds.length === 0) return [];

    return this.db
      .select({
        // The agent that actually ran this topic — used so each activity row
        // keeps its own avatar instead of inheriting the task's *current*
        // assignee (which changes when the task is reassigned).
        agentId: topics.agentId,
        completedAt: topics.completedAt,
        totalCost: topics.totalCost,
        createdAt: taskTopics.createdAt,
        handoff: taskTopics.handoff,
        metadata: topics.metadata,
        operationId: taskTopics.operationId,
        seq: taskTopics.seq,
        sourceTaskAssigneeAgentId: tasks.assigneeAgentId,
        sourceTaskId: tasks.id,
        sourceTaskIdentifier: tasks.identifier,
        sourceTaskName: tasks.name,
        status: taskTopics.status,
        title: topics.title,
        topicId: taskTopics.topicId,
        trigger: taskTopics.trigger,
      })
      .from(taskTopics)
      .innerJoin(tasks, eq(taskTopics.taskId, tasks.id))
      .leftJoin(topics, eq(taskTopics.topicId, topics.id))
      .where(and(inArray(taskTopics.taskId, taskIds), this.ownership()))
      .orderBy(desc(taskTopics.createdAt), desc(taskTopics.seq))
      .limit(limit);
  }

  async remove(taskId: string, topicId: string): Promise<boolean> {
    const result = await this.db
      .delete(taskTopics)
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.topicId, topicId), this.ownership()))
      .returning();

    if (result.length > 0) {
      await this.db
        .update(tasks)
        .set({
          totalTopics: sql`GREATEST(${tasks.totalTopics} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
    }

    return result.length > 0;
  }
}
