import type { ParseResult } from '@lobechat/eval-dataset-parser';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE, MAX_FILE_PARSE_SIZE } from '@/const/file';
import { router } from '@/libs/trpc/lambda';
import type { FileService } from '@/server/services/file';
import { FileParseError, parseDatasetInWorker } from '@/server/services/fileParse';
import { isFileParseError } from '@/server/services/fileParse/errors';
import { isDeterministicParseFailure } from '@/server/services/fileParse/failure';
import { normalizeParseFileError } from '@/server/services/fileParse/normalizeError';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import { evalConfigSchema, rubricTypeSchema } from './schemas';

/**
 * Refuses a stored upload larger than the in-memory parse cap by its stored size, before the
 * bytes are fetched: a few hundred MiB would otherwise be read, then cloned into the parse thread.
 */
const assertWithinParseLimit = async (fileService: FileService, pathname: string) => {
  const { contentLength } = await fileService.getFileMetadata(pathname);
  if (contentLength > MAX_FILE_PARSE_SIZE) {
    throw new FileParseError('INPUT_TOO_LARGE', FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE);
  }
};

/**
 * A parse failure that is the worker's state, not the file's (queue full or timed out, artifact
 * missing, thread could not start or died): the same upload can parse later, so it is kept.
 */
const isRetryableParseFailure = (error: unknown) =>
  isFileParseError(error) && !isDeterministicParseFailure(error);

/** Retryable: 429 when busy, 503 otherwise. Anything else is a bad file, as before. */
const toParseRequestError = (error: any) => {
  if (!isRetryableParseFailure(error)) {
    return new TRPCError({
      code: 'BAD_REQUEST',
      message: `Failed to parse file: ${error.message}`,
    });
  }
  const mapped = normalizeParseFileError(error) as TRPCError;
  return mapped.code === 'INTERNAL_SERVER_ERROR'
    ? new TRPCError({ cause: error, code: 'SERVICE_UNAVAILABLE', message: error.message })
    : mapped;
};

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
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.datasetModel.create(input);
        if (!result) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create dataset',
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
        name: z.string().optional(),
        description: z.string().optional(),
        evalMode: rubricTypeSchema.nullish(),
        evalConfig: evalConfigSchema.nullish(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await ctx.datasetModel.update(id, data);
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
        await assertWithinParseLimit(ctx.fileService, input.pathname);
        const content = isXlsx
          ? await ctx.fileService.getFileByteArray(input.pathname)
          : await ctx.fileService.getFileContent(input.pathname);
        const result = await parseDatasetInWorker<ParseResult>(content, {
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
        // A busy or unavailable worker keeps the upload so the same pathname can be retried.
        if (upload && !isRetryableParseFailure(error)) {
          await ctx.fileUploadService.releaseBestEffort(input.pathname);
        }
        throw toParseRequestError(error);
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
      let keepUpload = false;

      try {
        const format = input.format || 'auto';
        const resolvedFilename = input.filename || input.pathname;
        const isXlsx = format === 'xlsx' || resolvedFilename?.match(/\.xlsx?$/i);

        let parsed;
        try {
          await assertWithinParseLimit(ctx.fileService, input.pathname);
          const content = isXlsx
            ? await ctx.fileService.getFileByteArray(input.pathname)
            : await ctx.fileService.getFileContent(input.pathname);
          parsed = await parseDatasetInWorker<ParseResult>(content, {
            filename: resolvedFilename,
            format: format === 'auto' ? undefined : format,
          });
        } catch (error: any) {
          keepUpload = isRetryableParseFailure(error);
          throw toParseRequestError(error);
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
      } finally {
        if (upload) {
          if (!keepUpload) await ctx.fileUploadService.releaseBestEffort(input.pathname);
        } else if (imported) await ctx.fileService.deleteFile(input.pathname);
      }
    }),
});
