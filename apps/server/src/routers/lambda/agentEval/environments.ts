import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import { evalCaseEnvironmentSchema } from './schemas';

/**
 * Reusable case environments: the Agent setup, Memory fixture, clock and mock
 * connectors that many cases share. Cases point at one through
 * `environmentId`; deleting an environment leaves its cases without one.
 */
export const environmentRouter = router({
  createEnvironment: agentEvalProcedureWrite
    .input(
      z.object({
        config: evalCaseEnvironmentSchema,
        description: z.string().optional(),
        identifier: z.string().trim().min(1).max(200).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        name: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await ctx.environmentModel.create(input);
      } catch (error: any) {
        const pgError = error?.cause || error;
        if (pgError?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Environment with identifier "${input.identifier}" already exists`,
          });
        }
        throw error;
      }
    }),
  listEnvironments: agentEvalProcedure.query(async ({ ctx }) => ctx.environmentModel.query()),
  getEnvironment: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const environment = await ctx.environmentModel.findById(input.id);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      return environment;
    }),
  updateEnvironment: agentEvalProcedureWrite
    .input(
      z.object({
        config: evalCaseEnvironmentSchema.optional(),
        description: z.string().nullish(),
        id: z.string(),
        identifier: z.string().trim().min(1).max(200).nullish(),
        metadata: z.record(z.string(), z.unknown()).nullish(),
        name: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await ctx.environmentModel.update(id, data);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      return result;
    }),
  deleteEnvironment: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.environmentModel.delete(input.id);
      return { success: (result.rowCount ?? 0) > 0 };
    }),
});
