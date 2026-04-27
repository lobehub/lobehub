import type { TaskTopicHandoff } from '@lobechat/types';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { TaskTopicItem } from '../schemas/task';
import { tasks, taskTopics } from '../schemas/task';
import type { LobeChatDatabase } from '../type';

export class TaskTopicModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
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
    return result.length > 0;
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
      .returning();
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
    const { topics } = await import('../schemas/topic');
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

  async findWithHandoff(taskId: string, limit = 4) {
    const { topics } = await import('../schemas/topic');
    return this.db
      .select({
        createdAt: taskTopics.createdAt,
        handoff: taskTopics.handoff,
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
