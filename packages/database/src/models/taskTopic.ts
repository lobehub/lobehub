import type { TaskTopicHandoff } from '@lobechat/types';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { TaskTopicItem } from '../schemas/task';
import { tasks, taskTopics } from '../schemas/task';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';

const TERMINAL_TOPIC_STATUSES = new Set(['canceled', 'completed', 'failed', 'timeout']);

export class TaskTopicModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
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
      .where(and(eq(topics.id, topicId), eq(topics.userId, this.userId)));
  }

  async add(
    taskId: string,
    topicId: string,
    params: { operationId?: string; seq: number },
  ): Promise<void> {
    await this.db
      .insert(taskTopics)
      .values({
        operationId: params.operationId,
        seq: params.seq,
        taskId,
        topicId,
        userId: this.userId,
      })
      .onConflictDoNothing();
  }

  async updateStatus(taskId: string, topicId: string, status: string): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({ status })
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.userId, this.userId),
        ),
      );

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
          eq(taskTopics.userId, this.userId),
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
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.userId, this.userId),
        ),
      );
  }

  async updateHandoff(taskId: string, topicId: string, handoff: TaskTopicHandoff): Promise<void> {
    await this.db
      .update(taskTopics)
      .set({ handoff })
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.userId, this.userId),
        ),
      );
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
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.userId, this.userId),
        ),
      );
  }

  async timeoutRunning(taskId: string): Promise<number> {
    const result = await this.db
      .update(taskTopics)
      .set({ status: 'timeout' })
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.status, 'running'),
          eq(taskTopics.userId, this.userId),
        ),
      )
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
      .where(and(eq(taskTopics.topicId, topicId), eq(taskTopics.userId, this.userId)))
      .limit(1);
    return result[0] || null;
  }

  async findByTaskId(taskId: string): Promise<TaskTopicItem[]> {
    return this.db
      .select()
      .from(taskTopics)
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.userId, this.userId)))
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
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.userId, this.userId)))
      .orderBy(desc(taskTopics.seq));
  }

  async findWithHandoff(taskId: string, limit: number) {
    return this.db
      .select({
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
      .where(and(eq(taskTopics.taskId, taskId), eq(taskTopics.userId, this.userId)))
      .orderBy(desc(taskTopics.seq))
      .limit(limit);
  }

  async remove(taskId: string, topicId: string): Promise<boolean> {
    const result = await this.db
      .delete(taskTopics)
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.userId, this.userId),
        ),
      )
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
