import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { getTrustedMockBaseUrl } from '@/server/services/agentEvalRun/mockService';
import { getEvalMockConfig } from '@/server/services/agentEvalRun/utils';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

const MOCK_CHECK_TIMEOUT_MS = 5000;

/** What a mock reports for an engine it forwards a dataset to. */
interface MockUpstreamHealth {
  cases?: number;
  error?: string;
  ok: boolean;
  release?: string;
  url: string;
}

/** One shape for every outcome of checkBenchmarkMock, so the UI can read any field after narrowing on `configured`. */
interface MockCheck {
  /** Whether this server has a mock tool service configured (EVAL_TOOL_MOCK_BASE_URL). */
  configured: boolean;
  error?: string;
  ok?: boolean;
  status?: number;
  tokenConfigured: boolean;
  upstreams?: Record<string, MockUpstreamHealth>;
}

export const benchmarkRouter = router({
  // ============================================
  // Benchmark Operations
  // ============================================
  createBenchmark: agentEvalProcedureWrite
    .input(
      z.object({
        identifier: z.string(),
        name: z.string(),
        description: z.string().optional(),
        rubrics: z.array(z.any()).optional().default([]), // EvalBenchmarkRubric[]
        referenceUrl: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        isSystem: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.benchmarkModel.create(input);
        if (!result) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create benchmark',
          });
        }
        return result;
      } catch (error: any) {
        // PostgreSQL errors might be in error.cause
        const pgError = error?.cause || error;

        // Check for unique constraint violation (Postgres error code 23505)
        if (pgError?.code === '23505' || pgError?.constraint?.includes('identifier')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Benchmark with identifier "${input.identifier}" already exists`,
          });
        }
        throw error;
      }
    }),
  listBenchmarks: agentEvalProcedure
    .input(z.object({ includeSystem: z.boolean().default(true) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.benchmarkModel.query(input?.includeSystem);
    }),
  /**
   * Whether the benchmark's mock tool service answers. Reads `metadata.mock`
   * and pings its health endpoint, so the UI can warn before an experiment
   * runs tool cases against a mock that is down. Also tells whether this
   * server holds the forwarding token the mock expects.
   */
  checkBenchmarkMock: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const benchmark = await ctx.benchmarkModel.findById(input.id);
      if (!benchmark) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Benchmark not found' });
      }
      // The address is deployment configuration; the benchmark only tells which
      // dataset segment and connectors run on it.
      const base = getTrustedMockBaseUrl();
      const mock = base ? getEvalMockConfig(benchmark) : undefined;
      const tokenConfigured = !!process.env.EVAL_TOOL_FORWARDING_TOKEN;
      if (!base || !mock) {
        const unconfigured: MockCheck = { configured: false, tokenConfigured };
        return unconfigured;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MOCK_CHECK_TIMEOUT_MS);
      try {
        const response = await fetch(`${base}/healthz`, { signal: controller.signal });
        // A mock may front other engines (one per case set); it reports them under `upstreams`.
        let upstreams: Record<string, MockUpstreamHealth> | undefined;
        try {
          const body = (await response.json()) as {
            upstreams?: Record<string, MockUpstreamHealth>;
          };
          if (body && typeof body.upstreams === 'object' && body.upstreams)
            upstreams = body.upstreams;
        } catch {
          // Not JSON: nothing more to report.
        }
        const result: MockCheck = {
          configured: true,
          ok: response.ok,
          status: response.status,
          tokenConfigured,
          ...(upstreams && { upstreams }),
        };
        return result;
      } catch (error) {
        const failed: MockCheck = {
          configured: true,
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          tokenConfigured,
        };
        return failed;
      } finally {
        clearTimeout(timer);
      }
    }),
  getBenchmark: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const benchmark = await ctx.benchmarkModel.findById(input.id);
      if (!benchmark) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Benchmark not found' });
      }
      return benchmark;
    }),
  updateBenchmark: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        rubrics: z.array(z.any()).optional(),
        referenceUrl: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await ctx.benchmarkModel.update(id, data);
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Benchmark not found or cannot be updated',
        });
      }
      return result;
    }),
  deleteBenchmark: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.benchmarkModel.delete(input.id);
        // Check if any rows were affected
        if (result.rowCount === 0) {
          return {
            success: false,
            error: 'Benchmark not found or cannot be deleted (system benchmarks cannot be deleted)',
          };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete benchmark',
        };
      }
    }),
});
