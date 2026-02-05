import { z } from 'zod';

import { GenerationTopicModel } from '@/database/models/generationTopic';
import type {GenerationTopicItem} from '@/database/schemas/generation';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { GenerationService } from '@/server/services/generation';

const generationTopicProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId),
      generationTopicModel: new GenerationTopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

// Define input schemas
const updateTopicSchema = z.object({
  id: z.string(),
  value: z.object({
    coverUrl: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  }),
});

const updateTopicCoverSchema = z.object({
  coverUrl: z.string(),
  id: z.string(),
});

export const generationTopicRouter = router({
  createTopic: generationTopicProcedure.input(z.void()).mutation(async ({ ctx }) => {
    const data = await ctx.generationTopicModel.create('');
    return data.id;
  }),
  deleteTopic: generationTopicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Delete database records and get file URLs to clean
      const result = await ctx.generationTopicModel.delete(input.id);

      // If topic not found, throw an error instead of returning undefined
      if (!result) {
        return;
      }

      const { deletedTopic, filesToDelete } = result;

      // 2. Clean up all files from S3 (cover image and thumbnails)
      // Note: Even if file deletion fails, we consider the topic deletion successful
      // since the database record has been removed and users won't see the topic anymore
      if (filesToDelete.length > 0) {
        try {
          await ctx.fileService.deleteFiles(filesToDelete);
        } catch (error) {
          // Log the error but don't throw - file cleanup failure shouldn't affect
          // the user experience since the database operation succeeded
          console.error('Failed to delete files from S3:', error);
        }
      }

      return deletedTopic;
    }),
  getAllGenerationTopics: generationTopicProcedure.query(async ({ ctx }) => {
    return ctx.generationTopicModel.queryAll();
  }),
  updateTopic: generationTopicProcedure
    .input(updateTopicSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.generationTopicModel.update(input.id, input.value as Partial<GenerationTopicItem>);
    }),
  updateTopicCover: generationTopicProcedure
    .input(updateTopicCoverSchema)
    .mutation(async ({ ctx, input }) => {
      // Process the cover image and get key
      const newCoverKey = await ctx.generationService.createCoverFromUrl(input.coverUrl);

      // Update the topic with the new cover key
      return ctx.generationTopicModel.update(input.id, { coverUrl: newCoverKey });
    }),
});

export type GenerationTopicRouter = typeof generationTopicRouter;

// Export input types for client/server service consistency
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
export type UpdateTopicValue = UpdateTopicInput['value'];
export type UpdateTopicCoverInput = z.infer<typeof updateTopicCoverSchema>;
