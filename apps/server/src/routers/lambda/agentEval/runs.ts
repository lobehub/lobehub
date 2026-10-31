import { TRPCError } from '@trpc/server';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentEvalRunService, RUN_CREATE_ID_CONFLICT } from '@/server/services/agentEvalRun';
import { CASE_AGENT_MODEL_REQUIRED } from '@/server/services/agentEvalRun/caseAgent';
import {
  assertRunCaseCompatibility,
  EvalCaseCompatibilityError,
} from '@/server/services/agentEvalRun/caseCompatibility';
import { EvalResumeConflictError } from '@/server/services/agentEvalRun/resumeTarget';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { evalRunInputConfigSchema } from '../evalRunConfig.schema';
import { RUN_ENRICHMENT_CONCURRENCY } from './constants';
import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

const log = debug('lobe-lambda-router:agent-eval');

/** Max trajectories resumed at once by `batchResumeRunCases`. */
const BATCH_RESUME_CONCURRENCY = 5;

export const runRouter = router({
  /**
   * Whether this server can call each provider for the current user: the same
   * runtime construction an eval run performs before its first model call, so
   * a missing key (account or server) is caught before an experiment spends
   * attempts on `InvalidProviderAPIKey` errors.
   */
  checkProviders: agentEvalProcedure
    .input(z.object({ providers: z.array(z.string().trim().min(1)).max(20) }))
    .query(async ({ input, ctx }) => {
      const providers = [...new Set(input.providers)];
      return pMap(
        providers,
        async (provider) => {
          try {
            await initModelRuntimeFromDB(
              ctx.serverDB,
              ctx.userId,
              provider,
              ctx.workspaceId ?? undefined,
            );
            return { ok: true as const, provider };
          } catch (error) {
            const detail = error as { errorType?: string; message?: string } | undefined;
            return {
              error: detail?.errorType ?? detail?.message ?? 'Provider unavailable',
              ok: false as const,
              provider,
            };
          }
        },
        { concurrency: 4 },
      );
    }),
  // ============================================
  // Run Operations
  // ============================================
  createRun: agentEvalProcedureWrite
    .input(
      z.object({
        // Optional caller-supplied id: a client that checkpoints its launch can
        // retry the same create after a lost response without making a second run.
        id: z.string().trim().min(1).max(64).optional(),
        datasetId: z.string(),
        targetAgentId: z.string().optional(),
        name: z.string().optional(),
        config: evalRunInputConfigSchema.optional(),
        experimentId: z.string().optional(),
        parentRunId: z.string().optional(),
        // 'external': create claimable (pending) run with no pre-created topics.
        mode: z.enum(['internal', 'external']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.runService.createRun(input);
        if (!result) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create run',
          });
        }
        return result;
      } catch (error: any) {
        const pgError = error?.cause || error;

        if (pgError?.message === 'Experiment not found') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Experiment not found' });
        }
        if (pgError?.message === 'Parent run not found') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Parent run not found' });
        }
        if (pgError?.message === CASE_AGENT_MODEL_REQUIRED) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: CASE_AGENT_MODEL_REQUIRED });
        }
        // The id is taken by a run this caller cannot see, or by one created with
        // other parameters: say so without describing the other run.
        if (pgError?.message === RUN_CREATE_ID_CONFLICT) {
          throw new TRPCError({ code: 'CONFLICT', message: RUN_CREATE_ID_CONFLICT });
        }

        // Check for foreign key violation (dataset not found)
        if (pgError?.code === '23503' && pgError?.constraint?.includes('dataset')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Dataset with id "${input.datasetId}" not found`,
          });
        }
        throw error;
      }
    }),
  listRuns: agentEvalProcedure
    .input(
      z.object({
        benchmarkId: z.string().optional(),
        datasetId: z.string().optional(),
        experimentId: z.string().optional(),
        status: z
          .enum(['idle', 'pending', 'running', 'completed', 'failed', 'aborted', 'external'])
          .optional(),
        limit: z.number().min(1).max(100).default(50).optional(),
        offset: z.number().min(0).default(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const data = await ctx.runModel.query({
        benchmarkId: input.benchmarkId,
        datasetId: input.datasetId,
        experimentId: input.experimentId,
        status: input.status,
        limit: input.limit,
        offset: input.offset,
      });

      // Enrich runs with dataset name and agent info
      const datasetIds = [...new Set(data.map((r) => r.datasetId))];
      const agentIds = [...new Set(data.map((r) => r.targetAgentId).filter(Boolean))] as string[];

      const [datasets, agents] = await Promise.all([
        pMap(datasetIds, (id) => ctx.datasetModel.findById(id), {
          concurrency: RUN_ENRICHMENT_CONCURRENCY,
        }),
        pMap(agentIds, (id) => ctx.runService.getAgentDisplayInfo(id), {
          concurrency: RUN_ENRICHMENT_CONCURRENCY,
        }),
      ]);

      const datasetMap = Object.fromEntries(datasets.filter(Boolean).map((d) => [d!.id, d!.name]));
      const agentMap = Object.fromEntries(agents.filter(Boolean).map((a) => [a!.id, a!]));

      const enriched = data.map((run) => ({
        ...run,
        datasetName: datasetMap[run.datasetId] || undefined,
        targetAgent: run.targetAgentId ? agentMap[run.targetAgentId] : undefined,
      }));

      const total = data.length;

      return { data: enriched, total };
    }),
  getRunDetails: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.runService.getRunDetails(input.id);
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      return result;
    }),
  deleteRun: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.runService.deleteRun(input.id);
        // Check if any rows were affected
        if (result.rowCount === 0) {
          return {
            success: false,
            error: 'Run not found or you do not have permission to delete it',
          };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete run',
        };
      }
    }),

  // ============================================
  // Run Execution Operations
  // ============================================
  /**
   * Start executing a run
   * Transitions: idle/failed → pending → running
   */
  startRun: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        force: z.boolean().default(false).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id: runId, force } = input;

      // Get run to validate ownership and status
      const run = await ctx.runModel.findById(runId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      // Check run status
      if (run.status === 'running' && !force) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Run is already running. Use force=true to restart.',
        });
      }

      try {
        await assertRunCaseCompatibility(ctx, run);
      } catch (error) {
        if (error instanceof EvalCaseCompatibilityError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }

      // Set status to pending immediately so frontend gets feedback
      await ctx.runModel.update(runId, { status: 'pending' });

      // Trigger workflow
      await AgentEvalRunWorkflow.triggerRunBenchmark({ force, runId, userId: ctx.userId });

      return { success: true, runId };
    }),
  /**
   * Abort a running evaluation
   */
  abortRun: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const run = await ctx.runModel.findById(input.id);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      if (run.status !== 'running' && run.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot abort run with status: ${run.status}`,
        });
      }

      const service = new AgentEvalRunService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      await service.abortRun(input.id);

      return { success: true };
    }),
  /**
   * Run again every case of a finished run that has an attempt without a
   * verdict (error, timeout, judge failure), with the run's own settings.
   */
  rerunRunUnverified: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const run = await ctx.runModel.findById(input.id);
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      if (!['completed', 'failed', 'aborted'].includes(run.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot rerun: status=${run.status}`,
        });
      }

      let rerunCount: number;
      try {
        ({ rerunCount } = await ctx.runService.rerunUnverifiedCases(input.id));
      } catch (error) {
        if (error instanceof EvalCaseCompatibilityError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }
      if (rerunCount > 0) {
        await AgentEvalRunWorkflow.triggerRunBenchmark({
          force: true,
          runId: input.id,
          userId: ctx.userId,
        });
      }

      return { rerunCount, runId: input.id, success: true };
    }),
  retryRunErrors: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const run = await ctx.runModel.findById(input.id);
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      if (!['completed', 'failed', 'aborted'].includes(run.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot retry: status=${run.status}`,
        });
      }

      let retryCount: number;
      try {
        ({ retryCount } = await ctx.runService.retryErrorCases(input.id));
      } catch (error) {
        if (error instanceof EvalCaseCompatibilityError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }

      await AgentEvalRunWorkflow.triggerRunBenchmark({
        force: true,
        runId: input.id,
        userId: ctx.userId,
      });

      return { retryCount, runId: input.id, success: true };
    }),
  /**
   * Grade a finished run again with the dataset's current judge setup, from
   * the trajectories it recorded. Only the judge runs; no case is executed.
   */
  rejudgeRun: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const run = await ctx.runModel.findById(input.id);
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      if (!['completed', 'failed', 'aborted'].includes(run.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot re-judge: status=${run.status}`,
        });
      }

      try {
        return await ctx.runService.rejudgeRun(input.id);
      } catch (error) {
        if (error instanceof EvalCaseCompatibilityError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }
    }),
  retryRunCase: agentEvalProcedureWrite
    .input(z.object({ runId: z.string(), testCaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const run = await ctx.runModel.findById(input.runId);
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      if (!['completed', 'failed', 'aborted', 'running'].includes(run.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot retry case: run status=${run.status}`,
        });
      }

      try {
        await ctx.runService.retrySingleCase(input.runId, input.testCaseId);
      } catch (error) {
        if (error instanceof EvalCaseCompatibilityError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        const message = error instanceof Error ? error.message : 'Cannot retry case';
        if (message.startsWith('Cannot retry: case is')) {
          throw new TRPCError({ code: 'CONFLICT', message });
        }
        if (message === 'RunTopic not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message });
        }
        throw error;
      }

      await AgentEvalRunWorkflow.triggerExecuteTestCase({
        runId: input.runId,
        testCaseId: input.testCaseId,
        userId: ctx.userId,
      });

      return { runId: input.runId, success: true, testCaseId: input.testCaseId };
    }),
  resumeRunCase: agentEvalProcedureWrite
    .input(z.object({ runId: z.string(), testCaseId: z.string(), threadId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      log(
        'resumeRunCase: runId=%s testCaseId=%s threadId=%s',
        input.runId,
        input.testCaseId,
        input.threadId,
      );
      const result = await ctx.runService
        .resumeTrajectory({
          runId: input.runId,
          testCaseId: input.testCaseId,
          threadId: input.threadId,
        })
        .catch((error) => {
          if (
            error instanceof EvalResumeConflictError ||
            error instanceof EvalCaseCompatibilityError
          )
            throw new TRPCError({ code: 'CONFLICT', message: error.message });
          throw error;
        });
      log('resumeRunCase: result %O', result);
      return result;
    }),
  batchResumeRunCases: agentEvalProcedureWrite
    .input(
      z.object({
        runId: z.string(),
        targets: z.array(z.object({ testCaseId: z.string(), threadId: z.string().optional() })),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('batchResumeRunCases: runId=%s count=%d', input.runId, input.targets.length);
      // Each resume settles independently (like `Promise.allSettled`): one
      // failed target must not abort the others.
      const results = await pMap(
        input.targets,
        async (target) => {
          try {
            await ctx.runService.resumeTrajectory({
              runId: input.runId,
              testCaseId: target.testCaseId,
              threadId: target.threadId,
            });
            return true;
          } catch {
            return false;
          }
        },
        { concurrency: BATCH_RESUME_CONCURRENCY },
      );
      const succeeded = results.filter(Boolean).length;
      const failed = results.length - succeeded;
      log('batchResumeRunCases: succeeded=%d failed=%d', succeeded, failed);
      return { failed, succeeded, total: input.targets.length };
    }),
  getResumableCases: agentEvalProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getResumableCases: runId=%s', input.runId);
      return ctx.runService.getResumableCases(input.runId);
    }),
  /**
   * Get real-time progress of a running evaluation
   */
  getRunProgress: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      let run = await ctx.runModel.findById(input.id);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      // Check if a 'running' run has timed out
      if (run.status === 'running') {
        const timedOut = await ctx.runService.checkAndHandleRunTimeout(run);
        if (timedOut) {
          run = (await ctx.runModel.findById(input.id))!;
        }
      }

      return {
        status: run.status,
        metrics: run.metrics,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
      };
    }),
  /**
   * Get detailed results of test case executions
   */
  getRunResults: agentEvalProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const run = await ctx.runModel.findById(input.id);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      // Get all run topics with test cases and topics
      const allRunTopics = await ctx.runTopicModel.findByRunId(input.id);

      return {
        runId: input.id,
        total: allRunTopics.length,
        results: allRunTopics.map((rt) => ({
          createdAt: rt.createdAt,
          evalResult: rt.evalResult,
          passed: rt.passed,
          score: rt.score,
          status: rt.status,
          testCase: rt.testCase,
          testCaseId: rt.testCaseId,
          topic: rt.topic,
          topicId: rt.topicId,
        })),
      };
    }),
  /**
   * Update run status (internal use)
   */
  updateRunStatus: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        status: z.enum([
          'idle',
          'pending',
          'running',
          'completed',
          'failed',
          'aborted',
          'external',
        ]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, status } = input;

      const run = await ctx.runModel.findById(id);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      const result = await ctx.runModel.update(id, { status });
      return result;
    }),
  /**
   * Update run metrics (internal use)
   */
  updateRunMetrics: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        metrics: z.object({
          totalCases: z.number(),
          passedCases: z.number(),
          failedCases: z.number(),
          averageScore: z.number(),
          passRate: z.number(),
          duration: z.number().optional(),
          rubricScores: z.record(z.string(), z.number()).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, metrics } = input;

      const run = await ctx.runModel.findById(id);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      const result = await ctx.runModel.update(id, { metrics });
      return result;
    }),
  /**
   * Update run (user-facing: name, datasetId, targetAgentId)
   */
  updateRun: agentEvalProcedureWrite
    .input(
      z.object({
        config: evalRunInputConfigSchema.optional(),
        datasetId: z.string().optional(),
        id: z.string(),
        name: z.string().optional(),
        targetAgentId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;

      const run = await ctx.runModel.findById(id);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }

      // Only allow changing dataset/agent when run hasn't started
      const canChangeConfig = run.status === 'idle';
      const value: Record<string, any> = {};

      if (updates.name !== undefined) value.name = updates.name;
      if (canChangeConfig && updates.datasetId !== undefined) value.datasetId = updates.datasetId;
      if (canChangeConfig && updates.targetAgentId !== undefined)
        value.targetAgentId = updates.targetAgentId;

      // Config fields can be updated anytime (except when completed)
      if (updates.config) {
        const existingConfig = (run.config as Record<string, unknown>) ?? {};
        const configPatch = Object.fromEntries(
          Object.entries(updates.config).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(configPatch).length > 0) {
          value.config = { ...existingConfig, ...configPatch };
        }
      }

      if (Object.keys(value).length === 0) return run;

      return ctx.runModel.update(id, value);
    }),
});
