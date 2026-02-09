/* eslint-disable sort-keys-fix/sort-keys-fix  */
import {
  type EvalDatasetRecord,
  EvalEvaluationStatus,
  type InsertEvalDatasetRecord,
  type RAGEvalDataSetItem,
  insertEvalDatasetRecordSchema,
  insertEvalDatasetsSchema,
  insertEvalEvaluationSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import dayjs from 'dayjs';
import JSONL from 'jsonl-parse-stringify';
import pMap from 'p-map';
import { z } from 'zod';

import { DEFAULT_EMBEDDING_MODEL, DEFAULT_MODEL } from '@/const/settings';
import { FileModel } from '@/database/models/file';
import {
  EvalDatasetModel,
  EvalDatasetRecordModel,
  EvalEvaluationModel,
  EvaluationRecordModel,
} from '@/database/server/models/ragEval';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createAsyncCaller } from '@/server/routers/async';
import { FileService } from '@/server/services/file';

const ragEvalProcedure = authedProcedure
  .use(serverDatabase)
  .use(keyVaults)
  .use(async (opts) => {
    const { ctx } = opts;

    return opts.next({
      ctx: {
        datasetModel: new EvalDatasetModel(ctx.serverDB, ctx.userId),
        fileModel: new FileModel(ctx.serverDB, ctx.userId),
        datasetRecordModel: new EvalDatasetRecordModel(ctx.serverDB, ctx.userId),
        evaluationModel: new EvalEvaluationModel(ctx.serverDB, ctx.userId),
        evaluationRecordModel: new EvaluationRecordModel(ctx.serverDB, ctx.userId),
        fileService: new FileService(ctx.serverDB, ctx.userId),
      },
    });
  });

export const ragEvalRouter = router({
  createDataset: ragEvalProcedure
    .input(
      z.object({
        description: z.string().optional(),
        knowledgeBaseId: z.string(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.datasetModel.create({
        description: input.description,
        knowledgeBaseId: input.knowledgeBaseId,
        name: input.name,
      });

      return data?.id;
    }),

  getDatasets: ragEvalProcedure
    .input(z.object({ knowledgeBaseId: z.string() }))

    .query(async ({ ctx, input }): Promise<RAGEvalDataSetItem[]> => {
      return ctx.datasetModel.query(input.knowledgeBaseId);
    }),

  removeDataset: ragEvalProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.datasetModel.delete(input.id);
    }),

  updateDataset: ragEvalProcedure
    .input(
      z.object({
        id: z.string(),
        value: insertEvalDatasetsSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.datasetModel.update(input.id, input.value);
    }),

  // Dataset Item operations
  createDatasetRecords: ragEvalProcedure
    .input(
      z.object({
        datasetId: z.string(),
        question: z.string(),
        ideal: z.string().optional(),
        referenceFiles: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.datasetRecordModel.create(input);
      return data?.id;
    }),

  getDatasetRecords: ragEvalProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }): Promise<EvalDatasetRecord[]> => {
      return ctx.datasetRecordModel.query(input.datasetId);
    }),

  removeDatasetRecords: ragEvalProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.datasetRecordModel.delete(input.id);
    }),

  updateDatasetRecords: ragEvalProcedure
    .input(
      z.object({
        id: z.string(),
        value: z
          .object({
            question: z.string(),
            ideal: z.string(),
            referenceFiles: z.array(z.string()),
            metadata: z.record(z.unknown()),
          })
          .partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.datasetRecordModel.update(input.id, input.value);
    }),

  importDatasetRecords: ragEvalProcedure
    .input(
      z.object({
        datasetId: z.string(),
        pathname: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dataStr = await ctx.fileService.getFileContent(input.pathname);
      const items = JSONL.parse<InsertEvalDatasetRecord>(dataStr);

      insertEvalDatasetRecordSchema.array().parse(items);

      const data = await Promise.all(
        items.map(async ({ referenceFiles, question, ideal }) => {
          const files = typeof referenceFiles === 'string' ? [referenceFiles] : referenceFiles;

          let fileIds: string[] | undefined = undefined;

          if (files) {
            const items = await ctx.fileModel.findByNames(files);

            fileIds = items.map((item) => item.id);
          }

          return {
            question,
            ideal,
            referenceFiles: fileIds,
            datasetId: input.datasetId,
          };
        }),
      );

      return ctx.datasetRecordModel.batchCreate(data);
    }),

  // Evaluation operations
  startEvaluationTask: ragEvalProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Start evaluation task
      const evaluation = await ctx.evaluationModel.findById(input.id);

      if (!evaluation) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Evaluation not found' });
      }

      // create evaluation records by dataset records
      const datasetRecords = await ctx.datasetRecordModel.findByDatasetId(evaluation.datasetId);

      if (datasetRecords.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Dataset record is empty' });
      }

      const evalRecords = await ctx.evaluationRecordModel.batchCreate(
        datasetRecords.map((record) => ({
          evaluationId: input.id,
          datasetRecordId: record.id,
          question: record.question!,
          ideal: record.ideal,
          status: EvalEvaluationStatus.Pending,
          embeddingModel: DEFAULT_EMBEDDING_MODEL,
          languageModel: DEFAULT_MODEL,
        })),
      );

      // Async router will read keyVaults from DB, no need to pass jwtPayload
      const asyncCaller = await createAsyncCaller({
        userId: ctx.userId,
      });

      await ctx.evaluationModel.update(input.id, { status: EvalEvaluationStatus.Processing });
      try {
        await pMap(
          evalRecords,
          async (record) => {
            asyncCaller.ragEval
              .runRecordEvaluation({ evalRecordId: record.id })
              .catch(async (e) => {
                await ctx.evaluationModel.update(input.id, { status: EvalEvaluationStatus.Error });

                throw new TRPCError({
                  code: 'BAD_GATEWAY',
                  message: `[ASYNC_TASK] Failed to start evaluation task: ${e.message}`,
                });
              });
          },
          {
            concurrency: 30,
          },
        );

        return { success: true };
      } catch (e) {
        console.error('[startEvaluationTask]:', e);

        await ctx.evaluationModel.update(input.id, { status: EvalEvaluationStatus.Error });

        return { success: false };
      }
    }),

  checkEvaluationStatus: ragEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const evaluation = await ctx.evaluationModel.findById(input.id);

      if (!evaluation) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Evaluation not found' });
      }

      const records = await ctx.evaluationRecordModel.findByEvaluationId(input.id);

      const isSuccess = records.every((record) => record.status === EvalEvaluationStatus.Success);

      if (isSuccess) {
        // Upload results to S3

        const evalRecords = records.map((record) => ({
          question: record.question,
          context: record.context,
          answer: record.answer,
          ground_truth: record.ideal,
        }));
        const date = dayjs().format('YYYY-MM-DD-HH-mm');
        const filename = `${date}-eval_${evaluation.id}-${evaluation.name}.jsonl`;
        const path = `rag_eval_records/${filename}`;

        await ctx.fileService.uploadContent(path, JSONL.stringify(evalRecords));

        // Save data
        await ctx.evaluationModel.update(input.id, {
          status: EvalEvaluationStatus.Success,
          evalRecordsUrl: await ctx.fileService.getFullFileUrl(path),
        });
      }

      return { success: isSuccess };
    }),
  createEvaluation: ragEvalProcedure
    .input(insertEvalEvaluationSchema)
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.evaluationModel.create({
        description: input.description,
        knowledgeBaseId: input.knowledgeBaseId,
        datasetId: input.datasetId,
        name: input.name,
      });

      return data?.id;
    }),

  removeEvaluation: ragEvalProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.evaluationModel.delete(input.id);
    }),

  getEvaluationList: ragEvalProcedure
    .input(z.object({ knowledgeBaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.evaluationModel.queryByKnowledgeBaseId(input.knowledgeBaseId);
    }),
});
