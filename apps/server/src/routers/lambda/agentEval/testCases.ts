import type { EvalCaseEnvironment } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { AgentEvalEnvironmentModel } from '@/database/models/agentEval';
import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import { router } from '@/libs/trpc/lambda';
import { mergeCaseEnvironment } from '@/server/services/agentEvalRun/caseEnvironment';
import {
  draftCaseFromTopic,
  TOPIC_HAS_NO_REQUEST,
  TOPIC_NOT_FOUND,
} from '@/server/services/agentEvalRun/caseFromTopic';
import { createEvalRunDeps } from '@/server/services/agentEvalRun/deps';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import {
  evalCaseEnvironmentSchema,
  evalConfigSchema,
  evalTestCaseContentSchema,
  evalTestCaseMessagesSchema,
  rubricTypeSchema,
} from './schemas';

/**
 * Readers get each case with its shared environment merged into
 * `content.environment` and the environment's name alongside, so the UI
 * shows the persona, tools and clock a case actually runs with. The case's
 * own overrides stay available as `environmentOverrides`, so an editor can
 * change them without writing the merged result back as overrides.
 */
async function attachEnvironments<
  T extends { content: { environment?: EvalCaseEnvironment }; environmentId?: string | null },
>(
  environmentModel: AgentEvalEnvironmentModel,
  testCases: T[],
): Promise<
  Array<
    T & {
      environment?: { id: string; name: string } | null;
      environmentOverrides?: EvalCaseEnvironment;
    }
  >
> {
  const ids = testCases.map((item) => item.environmentId).filter(Boolean) as string[];
  if (ids.length === 0) return testCases;
  const rows = await environmentModel.findByIds(ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return testCases.map((item) => {
    const shared = item.environmentId ? byId.get(item.environmentId) : undefined;
    if (!shared) return item;
    return {
      ...item,
      content: {
        ...item.content,
        environment: mergeCaseEnvironment(shared.config, item.content.environment),
      },
      environment: { id: shared.id, name: shared.name },
      environmentOverrides: item.content.environment ?? {},
    };
  });
}

export const testCaseRouter = router({
  // ============================================
  // TestCase Operations
  // ============================================
  createTestCase: agentEvalProcedureWrite
    .input(
      z.object({
        datasetId: z.string(),
        content: evalTestCaseContentSchema,
        environmentId: z.string().nullish(),
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
        if (error instanceof AgentEvalDatasetWriteError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        }
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
  /**
   * Draft a case from one of the account's conversations: its last request,
   * the earlier turns as context, the answering Agent's setup, and rules the
   * judge model proposes. Nothing is saved; the author edits and saves it.
   */
  draftTestCaseFromTopic: agentEvalProcedureWrite
    .input(
      z.object({
        benchmarkId: z.string().optional(),
        draftRules: z.boolean().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await draftCaseFromTopic(
          createEvalRunDeps(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
          input.topicId,
          { benchmarkId: input.benchmarkId, draftRules: input.draftRules },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === TOPIC_NOT_FOUND) throw new TRPCError({ code: 'NOT_FOUND', message });
        if (message === TOPIC_HAS_NO_REQUEST) throw new TRPCError({ code: 'BAD_REQUEST', message });
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
            environmentId: z.string().nullish(),
            // A copied case keeps its own rules and judge (a case copied into a dataset).
            evalConfig: evalConfigSchema.optional(),
            evalMode: rubricTypeSchema.optional(),
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
        if (error instanceof AgentEvalDatasetWriteError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        }
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
        environmentId: z.string().nullish(),
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
      let result;
      try {
        result = await ctx.testCaseModel.update(id, data);
      } catch (error) {
        if (error instanceof AgentEvalDatasetWriteError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        }
        throw error;
      }
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
      const [resolved] = await attachEnvironments(ctx.environmentModel, [testCase]);
      return resolved;
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
      return { data: await attachEnvironments(ctx.environmentModel, data), total };
    }),
});
