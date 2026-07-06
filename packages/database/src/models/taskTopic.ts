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
    params: { operationId?: string; seq: number },
  ): Promise<void> {
    const visibility = await this.getTaskVisibility(taskId);
    await this.db
      .insert(taskTopics)
      .values({
        operationId: params.operationId,
        seq: params.seq,
        taskId,
        topicId,
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

  async countByTask(taskId: string, options?: { since?: Date }): Promise<number> {
    const conditions = [eq(taskTopics.taskId, taskId), this.ownership()];
    if (options?.since) conditions.push(gte(taskTopics.createdAt, options.since));

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
        createdAt: taskTopics.createdAt,
        handoff: taskTopics.handoff,
        metadata: topics.metadata,
        operationId: taskTopics.operationId,
        seq: taskTopics.seq,
        status: taskTopics.status,
        title: topics.title,
        topicId: taskTopics.topicId,
      })
      .from(taskTopics)
      .leftJoin(topics, eq(taskTopics.topicId, topics.id))
      .where(and(eq(taskTopics.taskId, taskId), this.ownership()))
      .orderBy(desc(taskTopics.seq))
      .limit(limit);
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
