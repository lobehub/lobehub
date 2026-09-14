import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { agentEvalRuns, agentEvalRunTopics, threads, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { evaluateAndFinalizeRun } from '@/server/services/agentEvalRun/aggregate';
import {
  applyReportResult,
  recomputeRunAggregation,
} from '@/server/services/agentEvalRun/reportResults';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { BaseService } from '../common/base.service';
import { projectRun } from '../helpers/eval-run';
import type { EvalBatchReport, EvalReport, EvalSetStatus } from '../types/eval.type';
import { EvalResourceService } from './eval-resource.service';

export class EvalLifecycleService extends BaseService {
  private reportContext(db: LobeChatDatabase) {
    const resources = new EvalResourceService(db, this.userId, this.workspaceId);
    return {
      runModel: new AgentEvalRunModel(db, this.userId, this.workspaceId),
      runTopicModel: new AgentEvalRunTopicModel(db, this.userId, this.workspaceId),
      testCaseModel: {
        countByDatasetId: async (id: string) => (await resources.getDataset(id)).testCaseCount,
      },
      threadModel: new ThreadModel(db, this.userId, this.workspaceId),
      runService: { evaluateAndFinalizeRun },
    };
  }
  private async getRun(id: string) {
    const run = await new AgentEvalRunModel(this.db, this.userId, this.workspaceId).findById(id);
    if (!run) throw this.createNotFoundError('Eval run not found');
    return run;
  }
  async requiresInternalExecution(id: string) {
    return (await this.getRun(id)).config?.executionMode !== 'external';
  }
  async claim(id: string) {
    const run = await this.getRun(id);
    if (run.config?.executionMode !== 'external')
      throw this.createConflictError('Only external runs can be claimed');
    const claimed = await new AgentEvalRunModel(this.db, this.userId, this.workspaceId).claim(id);
    if (!claimed) throw this.createConflictError('Run is not pending or already claimed');
    return projectRun(claimed);
  }
  async report(id: string, topicId: string, input: EvalReport) {
    const batch = await this.reportBatch(id, { items: [{ ...input, topicId }] });
    return { ...batch.items[0], runStatus: batch.runStatus };
  }
  async reportBatch(id: string, input: EvalBatchReport) {
    try {
      return await this.db.transaction(async (tx) => {
        // Serialize the read/modify/write aggregation, including different threads
        // of the same topic. A rejected item rolls the entire batch back.
        const [run] = await tx
          .select()
          .from(agentEvalRuns)
          .where(and(eq(agentEvalRuns.id, id), this.buildWorkspaceWhere(agentEvalRuns)))
          .for('update');
        if (!run) throw this.createNotFoundError('Eval run not found');
        if (!['running', 'external', 'completed', 'failed'].includes(run.status))
          throw this.createConflictError('Run does not accept results in its current state');
        const ctx = this.reportContext(tx);
        const resources = new EvalResourceService(tx, this.userId, this.workspaceId);
        const receipts = [];
        for (const item of input.items) {
          let [topic] = await tx
            .select()
            .from(agentEvalRunTopics)
            .where(
              and(
                eq(agentEvalRunTopics.runId, id),
                eq(agentEvalRunTopics.topicId, item.topicId),
                this.buildWorkspaceWhere(agentEvalRunTopics),
              ),
            );
          if (!topic && run.config?.executionMode === 'external' && item.testCaseId) {
            const testCase = await resources.getTestCase(item.testCaseId);
            const [sourceTopic] = await tx
              .select({ id: topics.id })
              .from(topics)
              .where(
                and(
                  eq(topics.id, item.topicId),
                  isNull(topics.deletedAt),
                  this.buildWorkspaceWhere(topics),
                ),
              );
            if (testCase.datasetId !== run.datasetId || !sourceTopic)
              throw this.createNotFoundError('Test case or topic not found');
            if (['completed', 'failed'].includes(run.status))
              throw this.createConflictError('Terminal runs cannot add results');
            const [created] = await tx
              .insert(agentEvalRunTopics)
              .values({
                ...this.buildWorkspacePayload({}),
                runId: id,
                topicId: item.topicId,
                testCaseId: item.testCaseId,
                status: 'external',
              })
              .onConflictDoNothing()
              .returning();
            if (!created)
              throw this.createConflictError('Test case already has a topic in this run');
            topic = created;
          }
          if (!topic) throw this.createNotFoundError('Run topic not found');
          if (item.testCaseId && item.testCaseId !== topic.testCaseId)
            throw this.createConflictError('Test case does not match the run topic');
          if (item.threadId) {
            const [thread] = await tx
              .select({ id: threads.id })
              .from(threads)
              .where(
                and(
                  eq(threads.id, item.threadId),
                  eq(threads.topicId, item.topicId),
                  this.buildWorkspaceWhere(threads),
                ),
              );
            if (!thread) throw this.createNotFoundError('Thread not found for this topic');
          }
          const result = topic.evalResult as
            | (NonNullable<typeof topic.evalResult> & {
                externalResult?: unknown;
                externalThreadResults?: Record<string, unknown>;
              })
            | null;
          const threadResult =
            item.threadId && (run.config?.k ?? 1) > 1
              ? result?.threads?.find((t) => t.threadId === item.threadId)
              : undefined;
          const alreadyReported =
            threadResult?.status === 'completed' ||
            ((run.config?.k ?? 1) === 1 &&
              ['passed', 'failed', 'error'].includes(topic.status ?? ''));
          if (alreadyReported) {
            const score = threadResult ? threadResult.score : topic.score;
            const passed = threadResult ? threadResult.passed : topic.passed;
            const previous = threadResult
              ? result?.externalThreadResults?.[item.threadId!]
              : result?.externalResult;
            if (
              score !== item.score ||
              passed !== item.correct ||
              !isEqual(previous, item.result ?? {})
            )
              throw this.createConflictError('A different result has already been reported');
          } else if (['completed', 'failed'].includes(run.status))
            throw this.createConflictError('Terminal runs only accept identical result replays');
          receipts.push(await applyReportResult(ctx, { ...item, runId: id }, false));
        }
        const runStatus = receipts.every((receipt) => receipt.idempotent)
          ? run.status
          : await recomputeRunAggregation(ctx, id);
        return { items: receipts, runId: id, runStatus, success: true };
      });
    } catch (error) {
      if (error instanceof TRPCError) {
        if (error.code === 'NOT_FOUND') throw this.createNotFoundError(error.message);
        throw this.createValidationError(error.message);
      }
      throw error;
    }
  }
  async setStatus(id: string, input: EvalSetStatus) {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(agentEvalRuns)
        .where(and(eq(agentEvalRuns.id, id), this.buildWorkspaceWhere(agentEvalRuns)))
        .for('update');
      if (!run) throw this.createNotFoundError('Eval run not found');
      if (run.config?.executionMode !== 'external')
        throw this.createConflictError('Only external runs support worker status changes');
      if (run.status === input.status) return projectRun(run);
      if (['completed', 'failed', 'aborted'].includes(run.status))
        throw this.createConflictError('Terminal run cannot change status');
      if (input.status === 'running')
        throw this.createConflictError('Use claim to start a pending run');
      if (
        !['running', 'external'].includes(run.status) &&
        !['failed', 'aborted'].includes(input.status)
      )
        throw this.createConflictError('Run must be claimed first');
      const ctx = this.reportContext(tx);
      if (input.status === 'completed') {
        const status = await recomputeRunAggregation(ctx, id);
        if (status !== 'completed')
          throw this.createConflictError('Cannot complete a run with outstanding or failed cases');
      } else {
        if (['failed', 'aborted'].includes(input.status))
          await ctx.runTopicModel.batchMarkAborted(id);
        await ctx.runModel.update(id, { status: input.status });
      }
      return projectRun((await ctx.runModel.findById(id))!);
    });
  }
  async retryErrors(id: string) {
    const result = await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(agentEvalRuns)
        .where(and(eq(agentEvalRuns.id, id), this.buildWorkspaceWhere(agentEvalRuns)))
        .for('update');
      if (!run) throw this.createNotFoundError('Eval run not found');
      if (!['completed', 'failed', 'aborted'].includes(run.status))
        throw this.createConflictError('Only terminal runs can retry errors');
      const model = new AgentEvalRunTopicModel(tx, this.userId, this.workspaceId);
      const errors = (await model.findByRunId(id)).filter(
        (t) => t.status === 'error' || t.status === 'timeout',
      );
      const external = run.config?.executionMode === 'external';
      if (!errors.length) return { retryCount: 0, external };
      if (external) {
        await tx
          .delete(agentEvalRunTopics)
          .where(
            and(
              eq(agentEvalRunTopics.runId, id),
              inArray(agentEvalRunTopics.status, ['error', 'timeout']),
              this.buildWorkspaceWhere(agentEvalRunTopics),
            ),
          );
        await new AgentEvalRunModel(tx, this.userId, this.workspaceId).update(id, {
          status: 'pending',
        });
        return { retryCount: errors.length, external };
      }
      const { AgentEvalRunService } = await import('@/server/services/agentEvalRun');
      const retried = await new AgentEvalRunService(
        tx,
        this.userId,
        this.workspaceId,
      ).retryErrorCases(id);
      await AgentEvalRunWorkflow.triggerRunBenchmark({
        force: true,
        runId: id,
        userId: this.userId,
      });
      return { ...retried, external };
    });
    return { runId: id, retryCount: result.retryCount };
  }
}
