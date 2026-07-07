import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GenerationTopicModel } from '@/database/models/generationTopic';
import { type GenerationTopicItem } from '@/database/schemas/generation';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { GenerationService } from '@/server/services/generation';

const generationTopicProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId, wsId),
      generationTopicModel: new GenerationTopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Define input schemas
const updateTopicSchema = z.object({
  id: z.string(),
  value: z.object({
    coverUrl: z.string().nullish(),
    title: z.string().nullish(),
  }),
});

const updateTopicCoverSchema = z.object({
  coverUrl: z.string(),
  id: z.string(),
});

export const generationTopicRouter = router({
  createTopic: generationTopicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z
        .object({
          type: z.enum(['image', 'video']).optional(),
          visibility: z.enum(['private', 'public']).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const data = await ctx.generationTopicModel.create('', input?.type, input?.visibility);
      return data.id;
    }),
  deleteTopic: generationTopicProcedure
    .use(withScopedPermission('topic:delete'))
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
  getAllGenerationTopics: generationTopicProcedure
    .input(z.object({ type: z.enum(['image', 'video']).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.generationTopicModel.queryAll(input?.type);
    }),
  updateTopic: generationTopicProcedure
    .use(withScopedPermission('topic:update'))
    .input(updateTopicSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.generationTopicModel.update(input.id, input.value as Partial<GenerationTopicItem>);
    }),
  updateTopicCover: generationTopicProcedure
    .use(withScopedPermission('topic:update'))
    .input(updateTopicCoverSchema)
    .mutation(async ({ ctx, input }) => {
      // Process the cover image and get key
      const newCoverKey = await ctx.generationService.createCoverFromUrl(input.coverUrl);

      // Update the topic with the new cover key
      return ctx.generationTopicModel.update(input.id, { coverUrl: newCoverKey });
    }),

  /**
   * Toggle a generation topic's workspace visibility. Creator-only. Personal
   * mode has no workspace visibility concept, so the call is rejected there.
   */
  setTopicVisibility: generationTopicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        visibility: z.enum(['private', 'public']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Generation topic visibility only applies inside a workspace',
        });
      }

      const topic = await ctx.generationTopicModel.findById(input.id);
      if (!topic) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation topic not found' });
      }

      if (topic.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can change a generation topic’s visibility',
        });
      }

      if (topic.visibility === input.visibility) return { success: true };

      await ctx.generationTopicModel.setVisibility(input.id, input.visibility);
      return { success: true };
    }),
});

export type GenerationTopicRouter = typeof generationTopicRouter;

// Export input types for client/server service consistency
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
export type UpdateTopicValue = UpdateTopicInput['value'];
export type UpdateTopicCoverInput = z.infer<typeof updateTopicCoverSchema>;
