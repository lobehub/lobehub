import { z } from 'zod';

import { GenerationBatchModel } from '@/database/models/generationBatch';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';

const generationBatchProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      generationBatchModel: new GenerationBatchModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const generationBatchRouter = router({
  deleteGenerationBatch: generationBatchProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Delete database records and get thumbnail URLs to clean
      const result = await ctx.generationBatchModel.delete(input.batchId);

      // If batch not found, return early
      if (!result) {
        return;
      }

      const { deletedBatch, filesToDelete } = result;

      // 2. Clean up asset files from S3 (videos, covers, thumbnails)
      // Note: Even if file deletion fails, we consider the batch deletion successful
      // since the database record has been removed and users won't see the batch anymore
      if (filesToDelete.length > 0) {
        try {
          await ctx.fileService.deleteFiles(filesToDelete);
        } catch (error) {
          // Log the error but don't throw - file cleanup failure shouldn't affect
          // the user experience since the database operation succeeded
          console.error('Failed to delete files from S3:', error);
        }
      }

      return deletedBatch;
    }),

  getGenerationBatches: generationBatchProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(input.topicId);
    }),
});

export type GenerationBatchRouter = typeof generationBatchRouter;
