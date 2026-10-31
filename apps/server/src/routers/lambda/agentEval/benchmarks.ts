import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

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
