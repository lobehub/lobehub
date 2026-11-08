import {
  DEVICE_OFFLINE_RUN_STATUS,
  QUOTA_LIMITED_RUN_STATUS,
  TRANSIENT_FAILED_RUN_STATUS,
} from '@lobechat/const/goal';
import type { BriefDecision, TaskTopicHandoff } from '@lobechat/types';
import { and, count, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agentOperations } from '../schemas/agentOperations';
import type { TaskTopicItem } from '../schemas/task';
import { tasks, taskTopics } from '../schemas/task';
import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';
import { topicsOwnership } from './task/context';
import { countOf } from './utils/rows';

/**
 * The run row is not owned by an operation newer than `operationId`: the
 * condition {@link TaskTopicModel.isSupersededOperation} reads, written as a
 * predicate on the row being updated.
 */
const notSupersededBy = (operationId: string) => sql`not exists (
  select 1 from ${agentOperations} as row_operation, ${agentOperations} as reported_operation
  where row_operation.id = ${taskTopics.operationId}
    and reported_operation.id = ${operationId}
    and row_operation.id <> reported_operation.id
    and row_operation.created_at > reported_operation.created_at
)`;

/** The operation a run row names, and the one reporting on it. */
const current = alias(agentOperations, 'current_operation');
const reported = alias(agentOperations, 'reported_operation');

export const TERMINAL_TOPIC_STATUSES = new Set([
  'canceled',
  'completed',
  DEVICE_OFFLINE_RUN_STATUS,
  'failed',
  QUOTA_LIMITED_RUN_STATUS,
  'timeout',
  TRANSIENT_FAILED_RUN_STATUS,
]);

export class TaskTopicModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  // Same rule as the other task child rows: a private run is visible to the
  // member who ran it and to the task's creator.
  private ownership = () =>
    topicsOwnership({ db: this.db, userId: this.userId, workspaceId: this.workspaceId });

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
  async markTopicEnded(topicId: string, status: string): Promise<void> {
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

  /**
   * Write a run's status.
   *
   * With `reportedOperationId`, the write is the completion of that operation
   * and lands only while no newer operation owns the row — see
   * {@link isSupersededOperation}. The guard is part of the UPDATE itself, so a
   * follow-up taking the row over between a completion's ownership check and
   * this write still wins. Returns whether a row was written.
   */
  async updateStatus(
    taskId: string,
    topicId: string,
    status: string,
    options: { reportedOperationId?: string } = {},
  ): Promise<boolean> {
    const { reportedOperationId } = options;
    const rows = await this.db
      .update(taskTopics)
      .set({ status })
      .where(
        and(
          eq(taskTopics.taskId, taskId),
          eq(taskTopics.topicId, topicId),
          this.ownership(),
          reportedOperationId ? notSupersededBy(reportedOperationId) : undefined,
        ),
      )
      .returning({ topicId: taskTopics.topicId });

    if (reportedOperationId && rows.length === 0) return false;

    if (TERMINAL_TOPIC_STATUSES.has(status)) {
      await this.markTopicEnded(topicId, status);
    }
    return rows.length > 0;
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

    // One statement for every ended topic: callers run this inside a
    // transaction holding task row locks, so a per-topic loop would stretch
    // those locks over hundreds of sequential writes in a large batch.
    const topicIds = canceled
      .map((topic) => topic.topicId)
      .filter((topicId): topicId is string => !!topicId);
    if (topicIds.length > 0) {
      await this.db
        .update(topics)
        .set({ completedAt: new Date() })
        .where(
          and(
            inArray(topics.id, topicIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
          ),
        );
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

  /**
   * Flip one run out of `running` — but only while it is still that exact run.
   *
   * Unlike {@link updateStatus}, a miss is a real answer rather than a silent
   * no-op: a row a newer operation has already replaced, or one another writer
   * settled a moment ago, returns `false`. Only the run row is written; the
   * topic's end stamp is the caller's to commit alongside it — see
   * `TaskRunClaimRepo`.
   */
  async claimRunIfRunning(topicId: string, operationId: string, status: string): Promise<boolean> {
    const result = await this.db
      .update(taskTopics)
      .set({ status })
      .where(
        and(
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.operationId, operationId),
          eq(taskTopics.status, 'running'),
          this.ownership(),
        ),
      )
      .returning({ topicId: taskTopics.topicId });

    return result.length > 0;
  }

  /**
   * Put a run claimed by {@link claimRunIfRunning} back to `running`.
   *
   * Keyed on the same operation as the claim, so a newer run that took the row
   * over in between is never reopened. Only the run row is written; clearing the
   * topic's end stamp is the caller's — see `TaskRunClaimRepo`.
   */
  async reopenRun(topicId: string, operationId: string, fromStatus: string): Promise<boolean> {
    const result = await this.db
      .update(taskTopics)
      .set({ status: 'running' })
      .where(
        and(
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.operationId, operationId),
          eq(taskTopics.status, fromStatus),
          this.ownership(),
        ),
      )
      .returning({ topicId: taskTopics.topicId });

    return result.length > 0;
  }

  /**
   * Put a settled run back in flight, because its topic is live again.
   *
   * A Task's run row is written at the two ends of a run the runner owns: the
   * runner opens it (`running`, with the operation it dispatched) and the
   * lifecycle closes it (terminal). A user answering a finished run in that
   * run's own conversation starts a third kind of run — dispatched from the
   * composer, never through `runTask` — so without this the row stays terminal
   * while the topic it names is visibly working: the run card keeps its finished
   * state, `TaskService.cancelTopic` refuses to stop the live run, and the
   * detail page stops polling for it.
   *
   * Guarded on the row not already being `running`: a message queued behind a
   * run that is still going must not steal that run's `operationId`, which is
   * the only handle cancellation has on it.
   *
   * The trigger is restamped as `'manual'` for the same reason it is written at
   * all: only automation ticks may spend the attempt budget, and a user replying
   * in the run's conversation is not one. Leaving the previous value would make
   * an orphaned answer settle as a tick and count against the schedule.
   *
   * Only the run row is written; clearing the topic's end stamp is the caller's
   * to commit alongside it — see `TaskRunClaimRepo`.
   */
  async reopenSettledRun(topicId: string, operationId: string): Promise<boolean> {
    const result = await this.db
      .update(taskTopics)
      .set({ operationId, status: 'running', trigger: 'manual' })
      .where(
        and(eq(taskTopics.topicId, topicId), ne(taskTopics.status, 'running'), this.ownership()),
      )
      .returning({ topicId: taskTopics.topicId });

    return result.length > 0;
  }

  /**
   * Hand a still-`running` run over to the operation that replaced it.
   *
   * A user following up in a Task's conversation while its run is still live
   * interrupts that run (the composer supersedes it). The interrupted run never
   * settles the row — an interrupt is not an outcome — so unless the follow-up
   * takes the row over, the Task stays `running` with nothing behind it.
   *
   * Compare-and-swap on the replaced operation: the row moves only while it is
   * still `running` under `fromOperationId`, so a run that settled in between,
   * or another send that took the row over first, is never overwritten. The
   * trigger is restamped `'manual'` for the same reason as
   * {@link reopenSettledRun}.
   */
  async takeOverRunningRun(
    topicId: string,
    fromOperationId: string,
    toOperationId: string,
  ): Promise<boolean> {
    const result = await this.db
      .update(taskTopics)
      .set({ operationId: toOperationId, trigger: 'manual' })
      .where(
        and(
          eq(taskTopics.topicId, topicId),
          eq(taskTopics.operationId, fromOperationId),
          eq(taskTopics.status, 'running'),
          this.ownership(),
        ),
      )
      .returning({ topicId: taskTopics.topicId });

    return result.length > 0;
  }

  /**
   * Whether `operationId` is an older run of this topic that a newer operation
   * has already replaced on the run row.
   *
   * Ordered by the operations' creation, not by mere inequality: the runner
   * records a run on the row only after its dispatch returns, so a short run can
   * report before the row names it. That report comes from the *newer* operation
   * and must go through; only a report from an operation older than the one the
   * row names is a superseded run's late delivery.
   */
  async isSupersededOperation(topicId: string, operationId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ topicId: taskTopics.topicId })
      .from(taskTopics)
      .innerJoin(current, eq(current.id, taskTopics.operationId))
      .innerJoin(reported, eq(reported.id, operationId))
      .where(
        and(
          eq(taskTopics.topicId, topicId),
          ne(taskTopics.operationId, operationId),
          sql`${current.createdAt} > ${reported.createdAt}`,
          this.ownership(),
        ),
      )
      .limit(1);

    return !!row;
  }

  /** Undo {@link markTopicEnded}'s end stamp for a run that is live again. */
  async clearTopicEnded(topicId: string): Promise<void> {
    await this.db
      .update(topics)
      .set({ completedAt: null })
      .where(
        and(
          eq(topics.id, topicId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
        ),
      );
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
      .select({ count: count() })
      .from(taskTopics)
      .where(and(...conditions));
    return countOf(rows, 'the task topic count');
  }

  async findByTaskId(taskId: string): Promise<TaskTopicItem[]> {
    return this.db
      .select()
      .from(taskTopics)
      .where(and(eq(taskTopics.taskId, taskId), this.ownership()))
      .orderBy(desc(taskTopics.seq));
  }

  async findByTaskIds(taskIds: string[]): Promise<TaskTopicItem[]> {
    if (taskIds.length === 0) return [];

    return this.db
      .select()
      .from(taskTopics)
      .where(and(inArray(taskTopics.taskId, taskIds), this.ownership()));
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
        agentId: topics.agentId,
        createdAt: topics.createdAt,
        groupId: topics.groupId,
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
   * Usage for one or more Tasks in one aggregate: how many runs they produced,
   * their tokens, and what they cost.
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
    byTask: {
      runs: number;
      taskId: string;
      totalCost: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
    }[];
    runs: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
  }> {
    if (taskIds.length === 0) {
      return {
        byTask: [],
        runs: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      };
    }

    // Grouped once, then folded — one round trip serves both the enforced
    // total and the per-Task breakdown the cost panel lists.
    const rows = await this.db
      .select({
        runs: count(),
        taskId: taskTopics.taskId,
        totalCost: sql<string>`coalesce(sum(${topics.totalCost}), 0)`,
        totalInputTokens: sql<string>`coalesce(sum(${topics.totalInputTokens}), 0)`,
        totalOutputTokens: sql<string>`coalesce(sum(${topics.totalOutputTokens}), 0)`,
        totalTokens: sql<string>`coalesce(sum(${topics.totalTokens}), 0)`,
      })
      .from(taskTopics)
      .leftJoin(topics, eq(taskTopics.topicId, topics.id))
      .where(and(inArray(taskTopics.taskId, taskIds), this.ownership()))
      .groupBy(taskTopics.taskId);

    const byTask = rows.map((row) => ({
      runs: row.runs,
      taskId: row.taskId,
      // Every sum is wrapped in coalesce(…, 0), so none of them is NULL.
      totalCost: Number(row.totalCost),
      totalInputTokens: Number(row.totalInputTokens),
      totalOutputTokens: Number(row.totalOutputTokens),
      totalTokens: Number(row.totalTokens),
    }));

    return {
      byTask,
      runs: byTask.reduce((sum, row) => sum + row.runs, 0),
      totalCost: byTask.reduce((sum, row) => sum + row.totalCost, 0),
      totalInputTokens: byTask.reduce((sum, row) => sum + row.totalInputTokens, 0),
      totalOutputTokens: byTask.reduce((sum, row) => sum + row.totalOutputTokens, 0),
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
