import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';

import {
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  threads,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

/** A queued case given a slot that has not started within this long gets its slot back. */
export const QUEUED_DISPATCH_STALE_MS = 5 * 60_000;

/** Coordinates the run, case and attempt generations under one transaction. */
export class AgentEvalExecutionRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalRunTopics);

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
            .where(
              and(
                eq(threads.id, attempt.id),
                buildWorkspaceWhere(
                  { userId: this.userId, workspaceId: this.workspaceId },
                  threads,
                ),
              ),
            );
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

  /**
   * Hand a run's waiting cases the slots its concurrency limit leaves free. The
   * run row is locked, so two cases finishing together cannot give out one slot
   * twice. A case holds a slot while running, or while still pending after a
   * dispatch younger than `staleMs` (its trigger has not reached it yet); an
   * older dispatch that never started is handed out again.
   */
  claimQueuedCases = async (
    runId: string,
    maxConcurrency: number,
    staleMs = QUEUED_DISPATCH_STALE_MS,
  ): Promise<string[]> =>
    this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({ status: agentEvalRuns.status })
        .from(agentEvalRuns)
        .where(
          and(
            eq(agentEvalRuns.id, runId),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              agentEvalRuns,
            ),
          ),
        )
        .for('update');
      if (!run || !['pending', 'running'].includes(run.status ?? '')) return [];

      const rows = await tx
        .select({
          evalResult: agentEvalRunTopics.evalResult,
          status: agentEvalRunTopics.status,
          testCaseId: agentEvalRunTopics.testCaseId,
        })
        .from(agentEvalRunTopics)
        .leftJoin(agentEvalTestCases, eq(agentEvalTestCases.id, agentEvalRunTopics.testCaseId))
        .where(and(this.ownership(), eq(agentEvalRunTopics.runId, runId)))
        // Waiting cases start in the dataset's order.
        .orderBy(
          sql`${agentEvalTestCases.sortOrder} ASC NULLS LAST`,
          agentEvalRunTopics.testCaseId,
        );
      const now = Date.now();
      const dispatched = (row: (typeof rows)[number]) => {
        const at = Date.parse(row.evalResult?.dispatchedAt ?? '');
        return Number.isFinite(at) && now - at < staleMs;
      };
      const busy = rows.filter(
        (row) => row.status === 'running' || (row.status === 'pending' && dispatched(row)),
      ).length;
      const free = Math.floor(maxConcurrency) - busy;
      if (free <= 0) return [];
      const picked = rows
        .filter((row) => row.status === 'pending' && !dispatched(row))
        .slice(0, free)
        .map((row) => row.testCaseId);
      if (picked.length === 0) return [];

      const stamp = JSON.stringify({ dispatchedAt: new Date(now).toISOString() });
      await tx
        .update(agentEvalRunTopics)
        .set({
          evalResult: sql`COALESCE(${agentEvalRunTopics.evalResult}, '{}'::jsonb) || ${stamp}::jsonb`,
        })
        .where(
          and(
            this.ownership(),
            eq(agentEvalRunTopics.runId, runId),
            eq(agentEvalRunTopics.status, 'pending'),
            inArray(agentEvalRunTopics.testCaseId, picked),
          ),
        );
      return picked;
    });

  /** Give back the slots of cases whose start could not be triggered. */
  releaseQueuedCases = async (runId: string, testCaseIds: string[]) => {
    if (testCaseIds.length === 0) return;
    await this.db
      .update(agentEvalRunTopics)
      .set({ evalResult: sql`${agentEvalRunTopics.evalResult} - 'dispatchedAt'` })
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.status, 'pending'),
          inArray(agentEvalRunTopics.testCaseId, testCaseIds),
        ),
      );
  };

  /**
   * Allocate and bind a pass@k attempt set atomically. Retried dispatches read
   * that same set; a failure before commit leaves the parent pending and no
   * orphan threads. The lock order matches Stop and execution claims.
   */
  prepareThreadExecutions = async (params: {
    expectedExecutionId?: string;
    k: number;
    runId: string;
    sourceMessageId?: string;
    testCaseId: string;
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
      if (
        !parent ||
        !['pending', 'running'].includes(parent.status ?? '') ||
        parent.evalResult?.completionReason === 'aborted' ||
        parent.evalResult?.executionId !== params.expectedExecutionId
      )
        return undefined;
      const [run] = await tx
        .select()
        .from(agentEvalRuns)
        .where(
          and(
            eq(agentEvalRuns.id, params.runId),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              agentEvalRuns,
            ),
          ),
        )
        .for('update');
      if (!run || run.status === 'aborted') return undefined;
      const [topic] = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(
          and(
            eq(topics.id, params.topicId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
          ),
        );
      if (!topic) return undefined;

      let threadIds = parent.evalResult?.threads?.map((attempt) => attempt.threadId);
      if (parent.status === 'pending') {
        if (threadIds?.length) throw new Error('Pending case already has an attempt set');
        const created = await tx
          .insert(threads)
          .values(
            Array.from({ length: params.k }, () => ({
              metadata: {
                executionId: crypto.randomUUID(),
                status: 'pending',
                testCaseId: params.testCaseId,
              },
              sourceMessageId: params.sourceMessageId,
              status: 'active' as const,
              topicId: params.topicId,
              type: 'eval' as const,
              userId: parent.userId,
              workspaceId: parent.workspaceId,
            })),
          )
          .returning({ id: threads.id });
        threadIds = created.map((thread) => thread.id);
        await tx
          .update(agentEvalRunTopics)
          .set({
            // The timeout counts from here, as for a single attempt: a case that
            // waited for a slot must not start already overdue.
            createdAt: new Date(),
            evalResult: {
              ...parent.evalResult,
              threads: threadIds.map((threadId) => ({ status: 'running' as const, threadId })),
            },
            status: 'running',
          })
          .where(
            and(
              this.ownership(),
              eq(agentEvalRunTopics.runId, params.runId),
              eq(agentEvalRunTopics.topicId, params.topicId),
            ),
          );
      }
      if (!threadIds || threadIds.length !== params.k)
        throw new Error('Running case has an incomplete attempt set');
      const attempts = await tx
        .select()
        .from(threads)
        .where(
          and(
            inArray(threads.id, threadIds),
            eq(threads.topicId, params.topicId),
            eq(threads.type, 'eval'),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        );
      if (attempts.length !== threadIds.length)
        throw new Error('Running case has missing attempts');
      return {
        pendingThreads: attempts
          .filter(
            (attempt) =>
              attempt.metadata?.status === 'pending' &&
              !attempt.metadata.startedAt &&
              !attempt.metadata.completedAt,
          )
          .map((attempt) => ({
            executionId: attempt.metadata?.executionId as string | undefined,
            threadId: attempt.id,
          })),
        threadIds,
      };
    });

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
        .where(
          and(
            eq(agentEvalRuns.id, params.runId),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              agentEvalRuns,
            ),
          ),
        )
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
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
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
          .where(
            and(
              eq(threads.id, thread.id),
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
            ),
          );
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
              this.ownership(),
            ),
          );
        if (params.resume)
          await tx
            .update(agentEvalRuns)
            .set({ startedAt: now, status: 'running' })
            .where(
              and(
                eq(agentEvalRuns.id, params.runId),
                buildWorkspaceWhere(
                  { userId: this.userId, workspaceId: this.workspaceId },
                  agentEvalRuns,
                ),
              ),
            );
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
            this.ownership(),
          ),
        );
      if (params.resume)
        await tx
          .update(agentEvalRuns)
          .set({ startedAt: now, status: 'running' })
          .where(
            and(
              eq(agentEvalRuns.id, params.runId),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId },
                agentEvalRuns,
              ),
            ),
          );
      return { parent, thread: undefined };
    });

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
