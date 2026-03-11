import type { EvalRunTopicResult, EvalThreadResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { messages } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

const runStatusSchema = z.enum([
  'idle',
  'pending',
  'running',
  'completed',
  'failed',
  'aborted',
  'external',
]);

const reportResultItemSchema = z.object({
  correct: z.boolean(),
  result: z.record(z.unknown()).optional(),
  score: z.number(),
  threadId: z.string().optional(),
  topicId: z.string(),
});

const toIsoString = (value?: Date | null) => (value ? value.toISOString() : undefined);

const agentEvalExternalProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      datasetModel: new AgentEvalDatasetModel(ctx.serverDB, ctx.userId),
      runModel: new AgentEvalRunModel(ctx.serverDB, ctx.userId),
      runService: new AgentEvalRunService(ctx.serverDB, ctx.userId),
      runTopicModel: new AgentEvalRunTopicModel(ctx.serverDB, ctx.userId),
      testCaseModel: new AgentEvalTestCaseModel(ctx.serverDB, ctx.userId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId),
    },
  });
});

type ReportResultInput = z.infer<typeof reportResultItemSchema> & { runId: string };

const recomputeRunAggregation = async (
  ctx: {
    runModel: AgentEvalRunModel;
    runService: AgentEvalRunService;
    runTopicModel: AgentEvalRunTopicModel;
  },
  runId: string,
) => {
  const refreshedRun = await ctx.runModel.findById(runId);
  if (!refreshedRun) return undefined;

  const refreshedTopics = await ctx.runTopicModel.findByRunId(runId);
  const metrics = await ctx.runService.evaluateAndFinalizeRun({
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
  const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
  const status = hasAwaitingExternal
    ? 'external'
    : nonSuccessCases >= metrics.totalCases
      ? 'failed'
      : 'completed';

  await ctx.runModel.update(runId, { metrics, status });

  return status;
};

const applyReportResult = async (
  ctx: {
    runModel: AgentEvalRunModel;
    runTopicModel: AgentEvalRunTopicModel;
    runService: AgentEvalRunService;
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
      targetThread.passed === input.correct;
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
    const alreadyReported =
      runTopic.status === (input.correct ? 'passed' : 'failed') &&
      runTopic.score === input.score &&
      runTopic.passed === input.correct;
    if (alreadyReported) {
      idempotent = true;
    } else {
      const nextEvalResult = {
        ...existingEvalResult,
        awaitingExternalEval: false,
        externalResult,
        rubricScores,
      } satisfies EvalRunTopicResult & Record<string, unknown>;

      await ctx.runTopicModel.updateByRunAndTopic(input.runId, input.topicId, {
        evalResult: nextEvalResult,
        passed: input.correct,
        score: input.score,
        status: input.correct ? 'passed' : 'failed',
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

export const agentEvalExternalRouter = router({
  datasetGet: agentEvalExternalProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const dataset = await ctx.datasetModel.findById(input.datasetId);
      if (!dataset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset not found' });
      }

      const metadata = (dataset.metadata ?? {}) as Record<string, unknown>;

      return {
        benchmarkId: dataset.benchmarkId,
        id: dataset.id,
        identifier: dataset.identifier,
        metadata,
        name: dataset.name,
      };
    }),

  messagesList: agentEvalExternalProcedure
    .input(z.object({ threadId: z.string().optional(), topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(messages.userId, ctx.userId),
        eq(messages.topicId, input.topicId),
        isNull(messages.messageGroupId),
      ];
      if (input.threadId) conditions.push(eq(messages.threadId, input.threadId));

      const rows = await ctx.serverDB
        .select({
          content: messages.content,
          createdAt: messages.createdAt,
          id: messages.id,
          role: messages.role,
          threadId: messages.threadId,
          topicId: messages.topicId,
        })
        .from(messages)
        .where(and(...conditions))
        .orderBy(asc(messages.createdAt));

      return rows.map((row) => ({
        content: row.content,
        createdAt: toIsoString(row.createdAt),
        id: row.id,
        role: row.role,
        threadId: row.threadId,
        topicId: row.topicId,
      }));
    }),

  reportResult: agentEvalExternalProcedure
    .input(
      z.object({
        correct: z.boolean(),
        result: z.record(z.unknown()).optional(),
        runId: z.string(),
        score: z.number(),
        threadId: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => applyReportResult(ctx, input, true)),

  reportResultsBatch: agentEvalExternalProcedure
    .input(z.object({ items: z.array(reportResultItemSchema).min(1), runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const receipts = [];

      for (const item of input.items) {
        receipts.push(await applyReportResult(ctx, { ...item, runId: input.runId }, false));
      }

      const runStatus = await recomputeRunAggregation(ctx, input.runId);

      return {
        items: receipts,
        runId: input.runId,
        runStatus,
        success: true,
      };
    }),

  runGet: agentEvalExternalProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.runModel.findById(input.runId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      const config = { ...run.config, k: run.config?.k ?? 1 };

      return {
        config,
        createdAt: run.createdAt,
        datasetId: run.datasetId,
        id: run.id,
        metrics: run.metrics ?? undefined,
        name: run.name,
        startedAt: run.startedAt,
        status: run.status,
        targetAgentId: run.targetAgentId,
      };
    }),

  runSetStatus: agentEvalExternalProcedure
    .input(z.object({ runId: z.string(), status: runStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.runModel.findById(input.runId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      if (input.status !== 'completed' && input.status !== 'external') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'External endpoint only supports setting status to completed or external',
        });
      }

      if (run.status !== 'external' && run.status !== 'completed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Only external runs can be finalized via this endpoint. current=${run.status}`,
        });
      }

      if (input.status === 'completed') {
        const runTopics = await ctx.runTopicModel.findByRunId(input.runId);
        const hasAwaitingExternal = runTopics.some(
          (topic) =>
            topic.status === 'external' ||
            (topic.evalResult as Record<string, unknown> | null)?.awaitingExternalEval === true,
        );
        if (hasAwaitingExternal) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot set run to completed while external evaluation is pending',
          });
        }

        const metrics = await ctx.runService.evaluateAndFinalizeRun({
          run: { config: run.config, id: run.id, metrics: run.metrics, startedAt: run.startedAt },
          runTopics,
        });
        const updated = await ctx.runModel.update(input.runId, { metrics, status: 'completed' });

        return {
          metrics,
          runId: input.runId,
          status: updated?.status ?? 'completed',
          success: true,
        };
      }

      const updated = await ctx.runModel.update(input.runId, { status: 'external' });

      return {
        runId: input.runId,
        status: updated?.status ?? 'external',
        success: true,
      };
    }),

  runTopicReportResult: agentEvalExternalProcedure
    .input(
      z.object({
        correct: z.boolean(),
        result: z.record(z.unknown()).optional(),
        runId: z.string(),
        score: z.number(),
        threadId: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => applyReportResult(ctx, input, true)),

  runTopicsList: agentEvalExternalProcedure
    .input(z.object({ onlyExternal: z.boolean().default(false).optional(), runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.runModel.findById(input.runId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      const allRunTopics = await ctx.runTopicModel.findByRunId(input.runId);
      const runTopics = input.onlyExternal
        ? allRunTopics.filter((topic) => topic.status === 'external')
        : allRunTopics;

      return runTopics.map((topic) => {
        const testCase = topic.testCase;

        return {
          createdAt: topic.createdAt,
          evalResult: topic.evalResult,
          passed: topic.passed,
          runId: topic.runId,
          score: topic.score,
          status: topic.status,
          testCase,
          testCaseId: topic.testCaseId,
          topic: topic.topic,
          topicId: topic.topicId,
        };
      });
    }),

  testCasesCount: agentEvalExternalProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const count = await ctx.testCaseModel.countByDatasetId(input.datasetId);
      return { count };
    }),

  threadsList: agentEvalExternalProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      const threads = await ctx.threadModel.queryByTopicId(input.topicId);

      return threads.map((thread) => ({
        id: thread.id,
        topicId: thread.topicId,
        type: thread.type,
      }));
    }),
});
