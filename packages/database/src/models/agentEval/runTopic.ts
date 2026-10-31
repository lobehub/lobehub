import { and, asc, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import {
  agentEvalRuns,
  type AgentEvalRunTopicItem,
  agentEvalRunTopics,
  agentEvalTestCases,
  type NewAgentEvalRunTopic,
  threads,
  topics,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class AgentEvalRunTopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalRunTopics);

  /**
   * Batch create run-topic associations
   */
  batchCreate = async (items: Omit<NewAgentEvalRunTopic, 'userId'>[]) => {
    if (items.length === 0) return [];
    const withUserId = items.map((item) => ({
      ...item,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    }));
    return this.db.insert(agentEvalRunTopics).values(withUserId).returning();
  };

  /**
   * Find all topics for a run (with TestCase and Topic details)
   */
  findByRunId = async (runId: string, pagination?: { limit?: number; offset?: number }) => {
    const query = this.db
      .select({
        createdAt: agentEvalRunTopics.createdAt,
        evalResult: agentEvalRunTopics.evalResult,
        passed: agentEvalRunTopics.passed,
        runId: agentEvalRunTopics.runId,
        score: agentEvalRunTopics.score,
        status: agentEvalRunTopics.status,
        testCase: agentEvalTestCases,
        testCaseId: agentEvalRunTopics.testCaseId,
        topic: topics,
        topicId: agentEvalRunTopics.topicId,
      })
      .from(agentEvalRunTopics)
      .leftJoin(agentEvalTestCases, eq(agentEvalRunTopics.testCaseId, agentEvalTestCases.id))
      .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
      .where(and(eq(agentEvalRunTopics.runId, runId), this.ownership()))
      .orderBy(asc(agentEvalTestCases.sortOrder), asc(agentEvalRunTopics.topicId))
      .$dynamic();

    if (pagination?.limit !== undefined) {
      query.limit(pagination.limit);
    }

    if (pagination?.offset !== undefined) {
      query.offset(pagination.offset);
    }

    return query;
  };

  /**
   * Count topics for a run
   */
  countByRunId = async (runId: string) => {
    const result = await this.db
      .select({ value: count() })
      .from(agentEvalRunTopics)
      .where(and(eq(agentEvalRunTopics.runId, runId), this.ownership()));
    return Number(result[0]?.value) || 0;
  };

  /**
   * Delete all run-topic associations for a run
   */
  deleteByRunId = async (runId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(and(eq(agentEvalRunTopics.runId, runId), this.ownership()));
  };

  /**
   * Find all runs that used a specific test case
   */
  findByTestCaseId = async (testCaseId: string) => {
    const rows = await this.db
      .select({
        createdAt: agentEvalRunTopics.createdAt,
        evalResult: agentEvalRunTopics.evalResult,
        passed: agentEvalRunTopics.passed,
        run: agentEvalRuns,
        runId: agentEvalRunTopics.runId,
        score: agentEvalRunTopics.score,
        testCaseId: agentEvalRunTopics.testCaseId,
        topic: topics,
        topicId: agentEvalRunTopics.topicId,
      })
      .from(agentEvalRunTopics)
      .leftJoin(agentEvalRuns, eq(agentEvalRunTopics.runId, agentEvalRuns.id))
      .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
      .where(and(eq(agentEvalRunTopics.testCaseId, testCaseId), this.ownership()))
      .orderBy(desc(agentEvalRunTopics.createdAt));

    return rows;
  };

  /**
   * Find a specific run-topic association by run and test case
   */
  findByRunAndTestCase = async (runId: string, testCaseId: string) => {
    const [row] = await this.db
      .select({
        createdAt: agentEvalRunTopics.createdAt,
        evalResult: agentEvalRunTopics.evalResult,
        passed: agentEvalRunTopics.passed,
        runId: agentEvalRunTopics.runId,
        score: agentEvalRunTopics.score,
        status: agentEvalRunTopics.status,
        testCase: agentEvalTestCases,
        testCaseId: agentEvalRunTopics.testCaseId,
        topic: topics,
        topicId: agentEvalRunTopics.topicId,
      })
      .from(agentEvalRunTopics)
      .leftJoin(agentEvalTestCases, eq(agentEvalRunTopics.testCaseId, agentEvalTestCases.id))
      .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
      .where(
        and(
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.testCaseId, testCaseId),
          this.ownership(),
        ),
      )
      .limit(1);

    return row;
  };

  /**
   * Atomically stop active cases and retain their partial attempt evidence.
   */
  private markStopped = async (runId: string, timeoutMs?: number) => {
    const reason = timeoutMs === undefined ? 'aborted' : 'timeout';
    const executionId = crypto.randomUUID();
    return this.db.transaction(async (tx) => {
      const stopped = await tx
        .update(agentEvalRunTopics)
        .set({
          evalResult: sql`COALESCE(${agentEvalRunTopics.evalResult}, '{}'::jsonb) || jsonb_build_object(
            'completionReason', ${reason}::text, 'executionId', ${executionId}::text,
            'error', COALESCE(${agentEvalRunTopics.evalResult}->>'error', ${reason === 'aborted' ? 'Aborted' : 'Timed out'}::text)
          )`,
          passed: null,
          score: null,
          status: reason === 'aborted' ? 'error' : 'timeout',
        })
        .where(
          and(
            this.ownership(),
            eq(agentEvalRunTopics.runId, runId),
            timeoutMs === undefined
              ? or(
                  eq(agentEvalRunTopics.status, 'pending'),
                  eq(agentEvalRunTopics.status, 'running'),
                )
              : and(
                  eq(agentEvalRunTopics.status, 'running'),
                  lt(agentEvalRunTopics.createdAt, new Date(Date.now() - timeoutMs)),
                ),
          ),
        )
        .returning();
      if (timeoutMs === undefined)
        await tx
          .update(agentEvalRuns)
          .set({ status: 'aborted' })
          .where(
            and(
              eq(agentEvalRuns.id, runId),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId },
                agentEvalRuns,
              ),
            ),
          );
      // Completed attempts are already in thread metadata while their siblings
      // run. Snapshot them under the same parent lock so Stop keeps that proof.
      if (stopped.length === 0) return stopped;
      const allAttempts = await tx
        .select()
        .from(threads)
        .where(
          and(
            inArray(
              threads.topicId,
              stopped.map((row) => row.topicId),
            ),
            eq(threads.type, 'eval'),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        );
      for (const row of stopped) {
        const attempts = allAttempts.filter((attempt) => attempt.topicId === row.topicId);
        if (attempts.length === 0) continue;
        for (const attempt of attempts) {
          if (attempt.metadata?.completedAt) continue;
          attempt.metadata = {
            ...attempt.metadata,
            completedAt: new Date().toISOString(),
            executionId: crypto.randomUUID(),
            error: reason === 'aborted' ? 'Aborted' : 'Timed out',
            status: reason === 'aborted' ? 'error' : 'timeout',
          };
          await tx
            .update(threads)
            .set({ metadata: attempt.metadata })
            .where(eq(threads.id, attempt.id));
        }
        const results = attempts.map((attempt) => ({
          ...row.evalResult?.threads?.find((result) => result.threadId === attempt.id),
          ...attempt.metadata,
          threadId: attempt.id,
        }));
        row.evalResult = { ...row.evalResult, threads: results };
        await tx
          .update(agentEvalRunTopics)
          .set({ evalResult: row.evalResult })
          .where(
            and(
              this.ownership(),
              eq(agentEvalRunTopics.runId, runId),
              eq(agentEvalRunTopics.topicId, row.topicId),
            ),
          );
      }
      return stopped;
    });
  };

  batchMarkAborted = (runId: string) => this.markStopped(runId);

  batchMarkTimeout = (runId: string, timeoutMs: number) => this.markStopped(runId, timeoutMs);

  deleteByRunAndTestCase = async (runId: string, testCaseId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.testCaseId, testCaseId),
        ),
      )
      .returning();
  };

  /**
   * Delete error/timeout RunTopics for a run, returning deleted rows
   */
  deleteErrorRunTopics = async (runId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          or(eq(agentEvalRunTopics.status, 'error'), eq(agentEvalRunTopics.status, 'timeout')),
        ),
      )
      .returning();
  };

  /**
   * Update a RunTopic by composite key (runId + topicId)
   */
  updateByRunAndTopic = async (
    runId: string,
    topicId: string,
    value: Pick<
      Partial<AgentEvalRunTopicItem>,
      'createdAt' | 'evalResult' | 'passed' | 'score' | 'status'
    >,
    options?: { allowAborted?: boolean; executionId?: string; status?: string },
  ) => {
    const [result] = await this.db
      .update(agentEvalRunTopics)
      .set(value)
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.topicId, topicId),
          options && 'executionId' in options
            ? sql`${agentEvalRunTopics.evalResult}->>'executionId' IS NOT DISTINCT FROM ${options.executionId ?? null}::text`
            : undefined,
          options?.status ? eq(agentEvalRunTopics.status, options.status as any) : undefined,
          options?.allowAborted
            ? undefined
            : sql`${agentEvalRunTopics.evalResult}->>'completionReason' IS DISTINCT FROM 'aborted'`,
        ),
      )
      .returning();
    return result;
  };

  /** Claim exactly one generation before creating an operation or resuming it. */
  claimExecution = async (params: {
    executionId: string;
    expectedExecutionId?: string;
    resume?: boolean;
    runId: string;
    testCaseId: string;
    threadId?: string;
    topicId: string;
  }) =>
    this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(agentEvalRunTopics)
        .where(
          and(
            this.ownership(),
            eq(agentEvalRunTopics.runId, params.runId),
            eq(agentEvalRunTopics.topicId, params.topicId),
            eq(agentEvalRunTopics.testCaseId, params.testCaseId),
          ),
        )
        .for('update');
      if (!parent) return undefined;
      const [run] = await tx
        .select()
        .from(agentEvalRuns)
        .where(eq(agentEvalRuns.id, params.runId))
        .for('update');
      if (!run || (!params.resume && run.status === 'aborted')) return undefined;
      const now = new Date(Math.max(Date.now(), (run.startedAt?.getTime() ?? 0) + 1));
      if (params.resume && parent.evalResult?.executionId !== params.expectedExecutionId)
        return undefined;
      if (params.threadId) {
        const [thread] = await tx
          .select()
          .from(threads)
          .where(
            and(
              eq(threads.id, params.threadId),
              eq(threads.topicId, params.topicId),
              eq(threads.type, 'eval'),
            ),
          );
        if (!thread) return undefined;
        const meta = thread.metadata ?? {};
        const previous = parent.evalResult?.threads?.find(
          (item) => item.threadId === params.threadId,
        );
        if (params.resume) {
          if (
            !['error', 'timeout'].includes(String(meta.status ?? previous?.status)) &&
            parent.status !== 'timeout'
          )
            return undefined;
        } else if (
          meta.startedAt ||
          meta.completedAt ||
          meta.executionId !== params.expectedExecutionId ||
          parent.evalResult?.completionReason === 'aborted'
        )
          return undefined;
        const result = {
          executionId: params.executionId,
          status: 'running' as const,
          threadId: params.threadId,
        };
        const next = (parent.evalResult?.threads ?? []).map((item) =>
          item.threadId === params.threadId ? result : item,
        );
        if (!next.some((item) => item.threadId === params.threadId)) next.push(result);
        await tx
          .update(threads)
          .set({
            metadata: {
              executionId: params.executionId,
              startedAt: now.toISOString(),
              status: 'running',
              testCaseId: params.testCaseId,
            },
          })
          .where(eq(threads.id, thread.id));
        await tx
          .update(agentEvalRunTopics)
          .set({
            ...(params.resume && {
              createdAt: now,
              evalResult: { executionId: params.executionId, threads: next },
              passed: null,
              score: null,
            }),
            status: 'running',
          })
          .where(
            and(
              eq(agentEvalRunTopics.runId, params.runId),
              eq(agentEvalRunTopics.topicId, params.topicId),
            ),
          );
        if (params.resume)
          await tx
            .update(agentEvalRuns)
            .set({ startedAt: now, status: 'running' })
            .where(eq(agentEvalRuns.id, params.runId));
        return { parent, thread };
      }
      if (
        params.resume
          ? !['error', 'timeout'].includes(parent.status ?? '')
          : parent.status !== 'pending'
      )
        return undefined;
      if (!params.resume && parent.evalResult?.executionId !== params.expectedExecutionId)
        return undefined;
      await tx
        .update(agentEvalRunTopics)
        .set({
          createdAt: now,
          evalResult: { executionId: params.executionId },
          passed: null,
          score: null,
          status: 'running',
        })
        .where(
          and(
            eq(agentEvalRunTopics.runId, params.runId),
            eq(agentEvalRunTopics.topicId, params.topicId),
          ),
        );
      if (params.resume)
        await tx
          .update(agentEvalRuns)
          .set({ startedAt: now, status: 'running' })
          .where(eq(agentEvalRuns.id, params.runId));
      return { parent, thread: undefined };
    });

  /** Merge operation identity without replacing a completion that raced ahead of startup. */
  mergeExecutionResult = async (
    runId: string,
    topicId: string,
    executionId: string,
    value: Record<string, unknown>,
  ) => {
    const [result] = await this.db
      .update(agentEvalRunTopics)
      .set({
        evalResult: sql`COALESCE(${agentEvalRunTopics.evalResult}, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb`,
      })
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.topicId, topicId),
          sql`${agentEvalRunTopics.evalResult}->>'executionId' = ${executionId}`,
          sql`${agentEvalRunTopics.evalResult}->>'completionReason' IS DISTINCT FROM 'aborted'`,
          sql`${agentEvalRunTopics.status} IS DISTINCT FROM 'timeout'`,
        ),
      )
      .returning();
    return result;
  };

  /** Merge attempt evidence atomically; late callbacks cannot revive a stopped/deleted attempt. */
  updateThreadMetadata = async (
    runId: string,
    topicId: string,
    threadId: string,
    metadata: Record<string, unknown>,
    options?: { executionId?: string },
  ) => {
    return this.db.transaction(async (tx) => {
      // Serialize with Stop's UPDATE of the parent row, including callbacks that
      // started evaluating before Stop but only now have a result to persist.
      const [parent] = await tx
        .select()
        .from(agentEvalRunTopics)
        .where(
          and(
            this.ownership(),
            eq(agentEvalRunTopics.runId, runId),
            eq(agentEvalRunTopics.topicId, topicId),
          ),
        )
        .for('update');
      if (
        !parent ||
        parent.evalResult?.completionReason === 'aborted' ||
        parent.status === 'timeout'
      ) {
        return undefined;
      }
      // JSON drops `undefined`, so a plain merge would keep a value the caller
      // cleared (a re-judged attempt's earlier judge error); remove those keys.
      const cleared = Object.keys(metadata).filter((key) => metadata[key] === undefined);
      const stored = sql`COALESCE(${threads.metadata}, '{}'::jsonb)`;
      const kept =
        cleared.length > 0
          ? sql`(${stored} - ARRAY[${sql.join(
              cleared.map((key) => sql`${key}`),
              sql`, `,
            )}]::text[])`
          : stored;
      const [result] = await tx
        .update(threads)
        .set({
          metadata: sql`${kept} || ${JSON.stringify(metadata)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(threads.id, threadId),
            eq(threads.topicId, topicId),
            options
              ? sql`${threads.metadata}->>'executionId' IS NOT DISTINCT FROM ${options.executionId ?? null}::text`
              : undefined,
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        )
        .returning({ id: threads.id });
      return result;
    });
  };
}
