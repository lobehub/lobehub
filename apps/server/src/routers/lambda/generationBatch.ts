import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { getVideoAvgLatency } from '@/server/services/generation/latency';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const generationBatchProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      generationBatchModel: new GenerationBatchModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const generationBatchRouter = router({
  deleteGenerationBatch: generationBatchProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await ctx.generationBatchModel.findById(input.batchId);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!batch) return;
      assertWorkspaceRowManageable(ctx, batch.userId, 'generation batch');

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
    .input(z.object({ topicId: z.string(), type: z.enum(['image', 'video']).optional() }))
    .query(async ({ ctx, input }) => {
      const batches = await ctx.generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        input.topicId,
      );

      if (input.type !== 'video') return batches;

      const uniqueModels = [...new Set(batches.map((b) => b.model))];
      const latencyMap = new Map<string, number | null>();

      await Promise.all(
        uniqueModels.map(async (model) => {
          const latency = await getVideoAvgLatency(model).catch(() => null);
          latencyMap.set(model, latency);
        }),
      );

      return batches.map((b) => ({ ...b, avgLatencyMs: latencyMap.get(b.model) ?? null }));
    }),
});

export type GenerationBatchRouter = typeof generationBatchRouter;
