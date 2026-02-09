import { chainAnswerWithContext } from '@lobechat/prompts';
import { EvalEvaluationStatus } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';
import { z } from 'zod';

import { DEFAULT_EMBEDDING_MODEL, DEFAULT_MODEL } from '@/const/settings';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import {
  EvalDatasetRecordModel,
  EvalEvaluationModel,
  EvaluationRecordModel,
} from '@/database/server/models/ragEval';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { AsyncTaskError } from '@/types/asyncTask';

const ragEvalProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      chunkService: new ChunkService(ctx.serverDB, ctx.userId),
      datasetRecordModel: new EvalDatasetRecordModel(ctx.serverDB, ctx.userId),
      embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
      evalRecordModel: new EvaluationRecordModel(ctx.serverDB, ctx.userId),
      evaluationModel: new EvalEvaluationModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const ragEvalRouter = router({
  runRecordEvaluation: ragEvalProcedure
    .input(
      z.object({
        evalRecordId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const evalRecord = await ctx.evalRecordModel.findById(input.evalRecordId);

      if (!evalRecord) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Evaluation not found' });
      }

      const now = Date.now();
      try {
        // Read user's provider config from database
        const modelRuntime = await initModelRuntimeFromDB(
          ctx.serverDB,
          ctx.userId,
          ModelProvider.OpenAI,
        );

        const { question, languageModel, embeddingModel } = evalRecord;

        let questionEmbeddingId = evalRecord.questionEmbeddingId;
        let context = evalRecord.context;

        // If questionEmbeddingId does not exist, perform an embedding
        if (!questionEmbeddingId) {
          const embeddings = await modelRuntime.embeddings({
            dimensions: 1024,
            input: question,
            model: !!embeddingModel ? embeddingModel : DEFAULT_EMBEDDING_MODEL,
          });

          const embeddingId = await ctx.embeddingModel.create({
            embeddings: embeddings?.[0],
            model: embeddingModel,
          });

          await ctx.evalRecordModel.update(evalRecord.id, {
            questionEmbeddingId: embeddingId,
          });

          questionEmbeddingId = embeddingId;
        }

        // If context does not exist, perform a retrieval
        if (!context || context.length === 0) {
          const datasetRecord = await ctx.datasetRecordModel.findById(evalRecord.datasetRecordId);

          const embeddingItem = await ctx.embeddingModel.findById(questionEmbeddingId);

          const chunks = await ctx.chunkModel.semanticSearchForChat({
            embedding: embeddingItem!.embeddings!,
            fileIds: datasetRecord!.referenceFiles!,
            query: evalRecord.question,
          });

          context = chunks.map((item) => item.text).filter(Boolean) as string[];
          await ctx.evalRecordModel.update(evalRecord.id, { context });
        }

        // Generate LLM answer
        const { messages } = chainAnswerWithContext({ context, knowledge: [], question });

        const response = await modelRuntime.chat({
          messages: messages!,
          model: !!languageModel ? languageModel : DEFAULT_MODEL,
          responseMode: 'json',
          stream: false,
          temperature: 1,
        });

        const data = (await response.json()) as OpenAI.ChatCompletion;

        const answer = data.choices[0].message.content;

        await ctx.evalRecordModel.update(input.evalRecordId, {
          answer,
          duration: Date.now() - now,
          languageModel,
          status: EvalEvaluationStatus.Success,
        });

        return { success: true };
      } catch (e) {
        await ctx.evalRecordModel.update(input.evalRecordId, {
          error: new AsyncTaskError((e as Error).name, (e as Error).message),
          status: EvalEvaluationStatus.Error,
        });

        await ctx.evaluationModel.update(evalRecord.evaluationId, {
          status: EvalEvaluationStatus.Error,
        });

        console.error('[RAGEvaluation] error', e);

        return { success: false };
      }
    }),
});
