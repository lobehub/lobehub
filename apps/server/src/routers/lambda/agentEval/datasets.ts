import { parseDataset } from '@lobechat/eval-dataset-parser';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import { router } from '@/libs/trpc/lambda';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import { evalConfigSchema, evalTestCaseContentSchema, rubricTypeSchema } from './schemas';

export const datasetRouter = router({
  // ============================================
  // Dataset Operations
  // ============================================
  createDataset: agentEvalProcedureWrite
    .input(
      z.object({
        // Optional: a dataset accumulated from captured cases belongs to no
        // published benchmark.
        benchmarkId: z.string().optional(),
        identifier: z.string(),
        name: z.string(),
        description: z.string().optional(),
        evalMode: rubricTypeSchema.optional(),
        evalConfig: evalConfigSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        sourceExperimentId: z.string().optional(),
        cases: z
          .array(
            z.object({
              content: evalTestCaseContentSchema,
              environmentId: z.string().nullish(),
              evalMode: rubricTypeSchema.optional(),
              evalConfig: evalConfigSchema.optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
              sortOrder: z.number().optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { cases, ...dataset } = input;
        const result = await ctx.datasetModel.create(dataset, cases);
        if (!result) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create dataset',
          });
        }
        return result;
      } catch (error: any) {
        if (error instanceof AgentEvalDatasetWriteError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        }
        // PostgreSQL errors might be in error.cause
        const pgError = error?.cause || error;

        // Check for unique constraint violation (Postgres error code 23505)
        if (pgError?.code === '23505' || pgError?.constraint?.includes('identifier')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Dataset with identifier "${input.identifier}" already exists for this user`,
          });
        }
        // Check for foreign key violation (benchmark not found)
        if (pgError?.code === '23503' && pgError?.constraint?.includes('benchmark')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Benchmark with id "${input.benchmarkId}" not found`,
          });
        }
        throw error;
      }
    }),
  listDatasets: agentEvalProcedure
    .input(z.object({ benchmarkId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.datasetModel.query({ benchmarkId: input?.benchmarkId });
    }),
  getDataset: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const dataset = await ctx.datasetModel.findById(input.id);
      if (!dataset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset not found' });
      }
      return dataset;
    }),
  updateDataset: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        // Moves the dataset into another benchmark the caller can see (its own, or a
        // built-in one), e.g. an account dataset into a benchmark the account made.
        benchmarkId: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        evalMode: rubricTypeSchema.nullish(),
        evalConfig: evalConfigSchema.nullish(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      if (data.benchmarkId && !(await ctx.benchmarkModel.findById(data.benchmarkId))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Benchmark with id "${data.benchmarkId}" not found`,
        });
      }
      let result;
      try {
        result = await ctx.datasetModel.update(id, data);
      } catch (error) {
        if (error instanceof AgentEvalDatasetWriteError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        }
        throw error;
      }
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Dataset not found or cannot be updated',
        });
      }
      return result;
    }),
  deleteDataset: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.datasetModel.delete(input.id);
        // Check if any rows were affected
        if (result.rowCount === 0) {
          return {
            success: false,
            error: 'Dataset not found or you do not have permission to delete it',
          };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete dataset',
        };
      }
    }),
  parseDatasetFile: agentEvalProcedureWrite
    .input(
      z.object({
        pathname: z.string(),
        format: z.enum(['json', 'jsonl', 'csv', 'xlsx']).optional(),
        filename: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const upload = await ctx.fileUploadService.assertActiveOrLegacy(input.pathname);
      const format = input.format || 'auto';
      const resolvedFilename = input.filename || input.pathname;
      const isXlsx = format === 'xlsx' || resolvedFilename?.match(/\.xlsx?$/i);

      try {
        const content = isXlsx
          ? await ctx.fileService.getFileByteArray(input.pathname)
          : await ctx.fileService.getFileContent(input.pathname);
        const result = parseDataset(content, {
          filename: resolvedFilename,
          format: format === 'auto' ? undefined : format,
          preview: 50,
        });

        return {
          headers: result.headers,
          preview: result.rows,
          totalCount: result.totalCount,
          format: result.format,
        };
      } catch (error: any) {
        if (upload) await ctx.fileUploadService.releaseBestEffort(input.pathname);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to parse file: ${error.message}`,
        });
      }
    }),
  importDataset: agentEvalProcedureWrite
    .input(
      z.object({
        datasetId: z.string(),
        pathname: z.string(),
        format: z.enum(['json', 'jsonl', 'csv', 'xlsx']).optional(),
        filename: z.string().optional(),
        fieldMapping: z.object({
          input: z.string(),
          expected: z.string().optional(),
          expectedDelimiter: z.string().optional(),
          choices: z.string().optional(),
          category: z.string().optional(),
          metadata: z.record(z.string(), z.string()).optional(),
          sortOrder: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const upload = await ctx.fileUploadService.assertActiveOrLegacy(input.pathname);
      let imported = false;

      try {
        const format = input.format || 'auto';
        const resolvedFilename = input.filename || input.pathname;
        const isXlsx = format === 'xlsx' || resolvedFilename?.match(/\.xlsx?$/i);

        let parsed;
        try {
          const content = isXlsx
            ? await ctx.fileService.getFileByteArray(input.pathname)
            : await ctx.fileService.getFileContent(input.pathname);
          parsed = parseDataset(content, {
            filename: resolvedFilename,
            format: format === 'auto' ? undefined : format,
          });
        } catch (error: any) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Failed to parse file: ${error.message}`,
          });
        }

        const { fieldMapping } = input;

        // Get the current max sortOrder so new imports continue from there
        const existingCount = await ctx.testCaseModel.countByDatasetId(input.datasetId);

        const testCases = parsed.rows.map((row, index) => {
          let expectedStr: string | undefined;

          if (fieldMapping.expected) {
            const raw = row[fieldMapping.expected];
            if (raw != null) {
              // Split multi-candidate answers by delimiter
              if (fieldMapping.expectedDelimiter) {
                const candidates = String(raw)
                  .split(fieldMapping.expectedDelimiter)
                  .map((s: string) => s.trim())
                  .filter(Boolean);
                expectedStr = candidates.length > 1 ? JSON.stringify(candidates) : String(raw);
              } else {
                expectedStr = String(raw);
              }
            }
          }

          // Handle choices field (array or JSON string)
          let choices: string[] | undefined;
          if (fieldMapping.choices) {
            const rawChoices = row[fieldMapping.choices];
            if (Array.isArray(rawChoices)) {
              choices = rawChoices.map(String);
            } else if (typeof rawChoices === 'string') {
              try {
                const parsed = JSON.parse(rawChoices);
                if (Array.isArray(parsed)) choices = parsed.map(String);
              } catch {
                // Not JSON, skip
              }
            }
          }

          // Compute sortOrder: use CSV column value if mapped, otherwise auto-increment from 1
          let sortOrder: number;
          if (fieldMapping.sortOrder) {
            const raw = Number(row[fieldMapping.sortOrder]);
            sortOrder = Number.isFinite(raw) ? raw : existingCount + index + 1;
          } else {
            sortOrder = existingCount + index + 1;
          }

          return {
            datasetId: input.datasetId,
            content: {
              input: String(row[fieldMapping.input] ?? ''),
              expected: expectedStr,
              choices,
              category: fieldMapping.category ? String(row[fieldMapping.category]) : undefined,
            },
            metadata: fieldMapping.metadata
              ? Object.fromEntries(
                  Object.entries(fieldMapping.metadata).map(([key, col]) => [
                    key,
                    row[col as string],
                  ]),
                )
              : {},
            sortOrder,
          };
        });

        const result = await ctx.testCaseModel.batchCreate(testCases);
        imported = true;

        return { count: result.length, data: result };
      } catch (error) {
        if (error instanceof AgentEvalDatasetWriteError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        }
        throw error;
      } finally {
        if (upload) await ctx.fileUploadService.releaseBestEffort(input.pathname);
        else if (imported) await ctx.fileService.deleteFile(input.pathname);
      }
    }),
});
