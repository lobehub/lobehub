import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import {
  evalCaseEnvironmentSchema,
  evalConfigSchema,
  evalTestCaseContentSchema,
  evalTestCaseMessagesSchema,
  rubricTypeSchema,
} from './schemas';

export const testCaseProcedures = {
  // ============================================
  // TestCase Operations
  // ============================================
  createTestCase: agentEvalProcedureWrite
    .input(
      z.object({
        datasetId: z.string(),
        content: evalTestCaseContentSchema,
        evalMode: rubricTypeSchema.optional(),
        evalConfig: evalConfigSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.testCaseModel.create(input);
        if (!result) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create test case',
          });
        }
        return result;
      } catch (error: any) {
        // PostgreSQL errors might be in error.cause
        const pgError = error?.cause || error;

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
  batchCreateTestCases: agentEvalProcedureWrite
    .input(
      z.object({
        datasetId: z.string(),
        cases: z.array(
          z.object({
            content: evalTestCaseContentSchema,
            metadata: z.record(z.string(), z.unknown()).optional(),
            sortOrder: z.number().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const testCases = input.cases.map((c) => ({
          ...c,
          datasetId: input.datasetId,
        }));
        const result = await ctx.testCaseModel.batchCreate(testCases);
        return { count: result.length, data: result };
      } catch (error: any) {
        // PostgreSQL errors might be in error.cause
        const pgError = error?.cause || error;

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
  updateTestCase: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        content: z
          .object({
            input: z.string().optional(),
            expected: z.string().optional(),
            choices: z.array(z.string()).optional(),
            category: z.string().optional(),
            environment: evalCaseEnvironmentSchema.optional(),
            messages: evalTestCaseMessagesSchema.optional(),
          })
          .optional(),
        evalMode: rubricTypeSchema.nullish(),
        evalConfig: evalConfigSchema.nullish(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await ctx.testCaseModel.update(id, data as any);
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Test case not found',
        });
      }
      return result;
    }),
  deleteTestCase: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.testCaseModel.delete(input.id);
        // Check if any rows were affected
        if (result.rowCount === 0) {
          return {
            success: false,
            error: 'Test case not found',
          };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete test case',
        };
      }
    }),
  getTestCase: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const testCase = await ctx.testCaseModel.findById(input.id);
      if (!testCase) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Test case not found' });
      }
      return testCase;
    }),
  listTestCases: agentEvalProcedure
    .input(
      z.object({
        datasetId: z.string(),
        limit: z.number().min(1).max(100).default(50).optional(),
        offset: z.number().min(0).default(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [data, total] = await Promise.all([
        ctx.testCaseModel.findByDatasetId(input.datasetId, input.limit, input.offset),
        ctx.testCaseModel.countByDatasetId(input.datasetId),
      ]);
      return { data, total };
    }),
};
