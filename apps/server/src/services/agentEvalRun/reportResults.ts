import type {
  EvalCaseSelection,
  EvalRunMetrics,
  EvalRunTopicResult,
  EvalThreadResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import isEqual from 'fast-deep-equal';

import type {
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import type { ThreadModel } from '@/database/models/thread';

import type { AgentEvalRunService } from './index';

interface ReportResultInput {
  correct: boolean;
  result?: Record<string, unknown>;
  runId: string;
  score: number;
  threadId?: string;
  topicId: string;
}

/**
 * Decide the run status from aggregated metrics. Priority: external (still
 * awaiting external eval) > running (cases outstanding) > failed (every case
 * errored/timed out) > completed. Exported for unit tests.
 */
export const resolveRunStatus = (
  metrics: Pick<EvalRunMetrics, 'completedCases' | 'errorCases' | 'timeoutCases' | 'totalCases'>,
  hasAwaitingExternal: boolean,
): 'completed' | 'external' | 'failed' | 'running' => {
  if (hasAwaitingExternal) return 'external';
  const totalCases = metrics.totalCases ?? 0;
  if ((metrics.completedCases ?? 0) < totalCases) return 'running';
  return (metrics.errorCases ?? 0) + (metrics.timeoutCases ?? 0) >= totalCases
    ? 'failed'
    : 'completed';
};

/**
 * Denominator for external-run totals. External runs create topics on demand,
 * so the dataset case count is the baseline; a persisted caseSelection narrows
 * it to the selected subset (include → selection size, exclude → dataset minus
 * excluded). Omitted selection means all cases (canonical).
 *
 * caseIds are shape-validated only (existence is the worker's contract); a
 * worker executing fewer cases than the selection is treated the same as one
 * executing fewer than the full dataset — no extra clamping query. Exported
 * for unit tests.
 */
export const resolveExpectedTotalCases = (
  caseSelection: EvalCaseSelection | undefined,
  datasetCaseCount: number,
): number => {
  if (!caseSelection || caseSelection.mode === 'all') return datasetCaseCount;
  const selectedIds = caseSelection.caseIds ?? [];
  if (caseSelection.mode === 'include') return selectedIds.length;
  return Math.max(datasetCaseCount - selectedIds.length, 0);
};

export const recomputeRunAggregation = async (
  ctx: {
    runModel: AgentEvalRunModel;
    runService: Pick<AgentEvalRunService, 'evaluateAndFinalizeRun'>;
    runTopicModel: AgentEvalRunTopicModel;
    testCaseModel: Pick<AgentEvalTestCaseModel, 'countByDatasetId'>;
  },
  runId: string,
) => {
  const refreshedRun = await ctx.runModel.findById(runId);
  if (!refreshedRun) return undefined;

  const refreshedTopics = await ctx.runTopicModel.findByRunId(runId);
  const metrics = await ctx.runService.evaluateAndFinalizeRun({
    expectedTotalCases: resolveExpectedTotalCases(
      refreshedRun.config?.caseSelection,
      await ctx.testCaseModel.countByDatasetId(refreshedRun.datasetId),
    ),
    run: {
      config: refreshedRun.config,
      id: refreshedRun.id,
      metrics: refreshedRun.metrics,
      startedAt: refreshedRun.startedAt,
    },
    runTopics: refreshedTopics,
  });

  const hasAwaitingExternal = refreshedTopics.some(
    (topic) =>
      topic.status === 'external' ||
      (topic.evalResult as Record<string, unknown> | null)?.awaitingExternalEval === true,
  );
  const hasActiveTopic = refreshedTopics.some(
    (topic) => topic.status === 'pending' || topic.status === 'running',
  );
  const status = hasActiveTopic ? 'running' : resolveRunStatus(metrics, hasAwaitingExternal);

  await ctx.runModel.update(runId, { metrics, status });

  return status;
};

export const applyReportResult = async (
  ctx: {
    runModel: AgentEvalRunModel;
    runTopicModel: AgentEvalRunTopicModel;
    runService: Pick<AgentEvalRunService, 'evaluateAndFinalizeRun'>;
    testCaseModel: Pick<AgentEvalTestCaseModel, 'countByDatasetId'>;
    threadModel: ThreadModel;
  },
  input: ReportResultInput,
  recomputeRun: boolean,
) => {
  const run = await ctx.runModel.findById(input.runId);
  if (!run) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
  }

  const runTopics = await ctx.runTopicModel.findByRunId(input.runId);
  const runTopic = runTopics.find((item) => item.topicId === input.topicId);
  if (!runTopic) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Run topic not found' });
  }

  const runK = run.config?.k ?? 1;
  const rubricScores = [{ rubricId: 'external', score: input.score }];
  const existingEvalResult = (runTopic.evalResult ?? {}) as EvalRunTopicResult &
    Record<string, unknown>;
  const externalResult = input.result ?? {};

  let idempotent = false;
  let reportedThreads: number;
  let totalThreads: number;
  let topicFinalized: boolean;

  if (runK > 1) {
    if (!input.threadId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'threadId is required when k > 1',
      });
    }

    const allThreads = await ctx.threadModel.queryByTopicId(input.topicId);
    const evalThreads = allThreads.filter((thread) => thread.type === 'eval');
    const sourceThreads = evalThreads.length > 0 ? evalThreads : allThreads;
    if (sourceThreads.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No threads found for this topic',
      });
    }

    const threads: EvalThreadResult[] =
      (existingEvalResult.threads as EvalThreadResult[] | undefined)?.map((thread) => ({
        ...thread,
      })) ??
      sourceThreads.map((thread) => ({
        status: 'external',
        threadId: thread.id,
      }));

    let targetIndex = threads.findIndex((thread) => thread.threadId === input.threadId);
    if (targetIndex < 0) {
      const existsInTopic = sourceThreads.some((thread) => thread.id === input.threadId);
      if (!existsInTopic) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Thread not found for this topic',
        });
      }

      threads.push({ status: 'external', threadId: input.threadId });
      targetIndex = threads.length - 1;
    }

    totalThreads = threads.length;
    const targetThread = threads[targetIndex];
    const alreadyReported =
      targetThread.status === 'completed' &&
      targetThread.score === input.score &&
      targetThread.passed === input.correct &&
      isEqual(
        (existingEvalResult.externalThreadResults as Record<string, unknown> | undefined)?.[
          input.threadId
        ],
        externalResult,
      );
    if (alreadyReported) {
      idempotent = true;
    } else {
      threads[targetIndex] = {
        ...targetThread,
        passed: input.correct,
        rubricScores,
        score: input.score,
        status: 'completed',
      };

      const existingThreadResults = (existingEvalResult.externalThreadResults ?? {}) as Record<
        string,
        unknown
      >;
      const nextEvalResult = {
        ...existingEvalResult,
        awaitingExternalEval: true,
        externalThreadResults: {
          ...existingThreadResults,
          [input.threadId]: externalResult,
        },
        threads,
      } satisfies EvalRunTopicResult & Record<string, unknown>;

      await ctx.runTopicModel.updateByRunAndTopic(input.runId, input.topicId, {
        evalResult: nextEvalResult,
        status: 'external',
      });
    }

    reportedThreads = threads.filter(
      (thread) => thread.status === 'completed' && typeof thread.score === 'number',
    ).length;
    topicFinalized = reportedThreads >= totalThreads;

    if (topicFinalized) {
      const finalThreads = threads;
      const totalScore = finalThreads.reduce((acc, thread) => acc + (thread.score ?? 0), 0);
      const avgScore = totalScore / finalThreads.length;
      const passAtK = finalThreads.some((thread) => thread.passed === true);
      const passAllK = finalThreads.every((thread) => thread.passed === true);

      const existingThreadResults = (existingEvalResult.externalThreadResults ?? {}) as Record<
        string,
        unknown
      >;
      const nextEvalResult = {
        ...existingEvalResult,
        awaitingExternalEval: false,
        externalThreadResults: {
          ...existingThreadResults,
          [input.threadId]: externalResult,
        },
        passAllK,
        passAtK,
        rubricScores: [{ rubricId: 'external', score: avgScore }],
        threads: finalThreads,
      } satisfies EvalRunTopicResult & Record<string, unknown>;

      await ctx.runTopicModel.updateByRunAndTopic(input.runId, input.topicId, {
        evalResult: nextEvalResult,
        passed: passAtK,
        score: avgScore,
        status: passAtK ? 'passed' : 'failed',
      });
    }
  } else {
    const externalError = externalResult.error as Record<string, unknown> | string | undefined;
    const errorMessage =
      typeof externalError === 'string'
        ? externalError
        : [externalError?.type, externalError?.message].filter(Boolean).join(': ') || undefined;
    const topicStatus = errorMessage ? 'error' : input.correct ? 'passed' : 'failed';
    const alreadyReported =
      runTopic.status === topicStatus &&
      runTopic.score === input.score &&
      runTopic.passed === input.correct &&
      isEqual(existingEvalResult.externalResult, externalResult);
    if (alreadyReported) {
      idempotent = true;
    } else {
      const nextEvalResult = {
        ...existingEvalResult,
        awaitingExternalEval: false,
        externalResult,
        rubricScores,
      } satisfies EvalRunTopicResult & Record<string, unknown>;
      if (errorMessage) {
        nextEvalResult.error = errorMessage;
        nextEvalResult.errorDetail = externalError;
      } else {
        delete nextEvalResult.error;
        delete nextEvalResult.errorDetail;
      }

      await ctx.runTopicModel.updateByRunAndTopic(input.runId, input.topicId, {
        evalResult: nextEvalResult,
        passed: input.correct,
        score: input.score,
        status: topicStatus,
      });
    }

    reportedThreads = 1;
    totalThreads = 1;
    topicFinalized = true;
  }

  let runStatus: string | undefined;
  if (recomputeRun) {
    runStatus = await recomputeRunAggregation(ctx, input.runId);
  }

  return {
    idempotent,
    reportedThreads,
    runId: input.runId,
    runStatus,
    success: true,
    threadId: input.threadId,
    topicFinalized,
    topicId: input.topicId,
    totalThreads,
  };
};
