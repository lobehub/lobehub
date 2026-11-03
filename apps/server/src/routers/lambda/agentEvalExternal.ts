import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { messages } from '@/database/schemas';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentEvalRunService, RUN_CREATE_ID_CONFLICT } from '@/server/services/agentEvalRun';
import {
  applyReportResult,
  recomputeRunAggregation,
  resolveExpectedTotalCases,
} from '@/server/services/agentEvalRun/reportResults';

import { evalRunInputConfigSchema } from './evalRunConfig.schema';

const runStatusSchema = z.enum([
  'idle',
  'pending',
  'running',
  'completed',
  'failed',
  'aborted',
  'external',
]);

const runCreateInputSchema = z.object({
  config: evalRunInputConfigSchema.optional(),
  datasetId: z.string(),
  experimentId: z.string().optional(),
  // Caller-supplied id for idempotent cross-server creation.
  id: z.string().optional(),
  name: z.string().optional(),
  parentRunId: z.string().optional(),
  targetAgentId: z.string().optional(),
});

const reportResultItemSchema = z.object({
  correct: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  score: z.number(),
  threadId: z.string().optional(),
  topicId: z.string(),
});

const toIsoString = (value?: Date | null) => (value ? value.toISOString() : undefined);

const agentEvalExternalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      datasetModel: new AgentEvalDatasetModel(ctx.serverDB, ctx.userId, wsId),
      runModel: new AgentEvalRunModel(ctx.serverDB, ctx.userId, wsId),
      runService: new AgentEvalRunService(ctx.serverDB, ctx.userId, wsId),
      runTopicModel: new AgentEvalRunTopicModel(ctx.serverDB, ctx.userId, wsId),
      testCaseModel: new AgentEvalTestCaseModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});
const agentEvalExternalWriteProcedure = agentEvalExternalProcedure.use(
  withScopedPermission('agent:update'),
);

export {
  resolveExpectedTotalCases,
  resolveRunStatus,
} from '@/server/services/agentEvalRun/reportResults';

export const agentEvalExternalRouter = router({
  /**
   * Create an external run: immediately claimable (`pending`), no pre-created
   * Topics/RunTopics, no workflow triggered. k=1 only.
   */
  runCreate: agentEvalExternalWriteProcedure
    .input(runCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const run = await ctx.runService.createRun({ ...input, mode: 'external' });
        return {
          datasetId: run.datasetId,
          experimentId: run.experimentId ?? undefined,
          id: run.id,
          status: run.status,
          success: true,
          targetAgentId: run.targetAgentId ?? undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create run';
        if (message === RUN_CREATE_ID_CONFLICT) {
          throw new TRPCError({ code: 'CONFLICT', message });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message });
      }
    }),

  /**
   * Atomically claim a pending run (pending -> running) and return everything
   * the worker needs: run, dataset, all test cases, and the agent snapshot.
   */
  runClaim: agentEvalExternalWriteProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const payload = await ctx.runService.claimRun(input.runId);
        return { ...payload, success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Run is not claimable';
        throw new TRPCError({ code: 'CONFLICT', message });
      }
    }),

  /**
   * Execute a single case of a claimed run by dataset-native caseId. Creates
   * the Topic/RunTopic on demand, then starts the agent trajectory.
   */
  runExecuteCase: agentEvalExternalWriteProcedure
    .input(
      z.object({
        caseId: z.string(),
        /** Route execution to an enrolled device (native AgentRuntime). */
        deviceId: z.string().optional(),
        prompt: z.string().optional(),
        runId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.runService.executeTrajectoryOnDemand(input);
        if ('error' in result && result.error) {
          return { status: 'error' as const, success: false, ...result };
        }
        return { status: 'started' as const, success: true, ...result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to execute case';
        throw new TRPCError({ code: 'BAD_REQUEST', message });
      }
    }),

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
        evalConfig: dataset.evalConfig,
        evalMode: dataset.evalMode,
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
        buildWorkspaceWhere(
          { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
          messages,
        ),
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

  reportResult: agentEvalExternalWriteProcedure
    .input(
      z.object({
        correct: z.boolean(),
        result: z.record(z.string(), z.unknown()).optional(),
        runId: z.string(),
        score: z.number(),
        threadId: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => applyReportResult(ctx, input, true)),

  reportResultsBatch: agentEvalExternalWriteProcedure
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

  runSetStatus: agentEvalExternalWriteProcedure
    .input(z.object({ runId: z.string(), status: runStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.runModel.findById(input.runId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      if (input.status === 'running') {
        const updated = await ctx.runModel.update(input.runId, { status: 'running' });
        return { runId: input.runId, status: updated?.status ?? 'running', success: true };
      }

      // Worker-driven terminal failure/abort: allowed from any non-terminal
      // state. Marks remaining non-terminal RunTopics aborted and finalizes.
      if (input.status === 'failed' || input.status === 'aborted') {
        if (['completed', 'failed', 'aborted'].includes(run.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Run is already in a terminal state: ${run.status}`,
          });
        }

        await ctx.runTopicModel.batchMarkAborted(input.runId);

        if (input.status === 'failed') {
          const runTopics = await ctx.runTopicModel.findByRunId(input.runId);
          const metrics = await ctx.runService.evaluateAndFinalizeRun({
            expectedTotalCases: resolveExpectedTotalCases(
              run.config?.caseSelection,
              await ctx.testCaseModel.countByDatasetId(run.datasetId),
            ),
            run: { config: run.config, id: run.id, metrics: run.metrics, startedAt: run.startedAt },
            runTopics,
          });
          const updated = await ctx.runModel.update(input.runId, { metrics, status: 'failed' });
          return {
            metrics,
            runId: input.runId,
            status: updated?.status ?? 'failed',
            success: true,
          };
        }

        const updated = await ctx.runModel.update(input.runId, { status: 'aborted' });
        return { runId: input.runId, status: updated?.status ?? 'aborted', success: true };
      }

      if (input.status !== 'completed' && input.status !== 'external') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'External endpoint only supports setting status to completed, external, failed, or aborted',
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
          expectedTotalCases: resolveExpectedTotalCases(
            run.config?.caseSelection,
            await ctx.testCaseModel.countByDatasetId(run.datasetId),
          ),
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

  runTopicReportResult: agentEvalExternalWriteProcedure
    .input(
      z.object({
        correct: z.boolean(),
        result: z.record(z.string(), z.unknown()).optional(),
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
