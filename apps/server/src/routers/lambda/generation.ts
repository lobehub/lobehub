import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { type AsyncTaskError } from '@/types/asyncTask';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation } from '@/types/generation';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const generationProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export type GetGenerationStatusResult = {
  error: AsyncTaskError | null;
  generation: Generation | null;
  status: AsyncTaskStatus;
};

export const generationRouter = router({
  deleteGeneration: generationProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ generationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const generation = await ctx.generationModel.findById(input.generationId);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!generation) return;
      assertWorkspaceRowManageable(ctx, generation.userId, 'generation');

      // Delete the generation record from database and get the deleted data
      const deletedGeneration = await ctx.generationModel.delete(input.generationId);

      if (!deletedGeneration) return;

      // Note: Based on new requirements, don't delete main file (fileId), only delete thumbnail
      // If generation has a thumbnail, delete it from S3
      if (deletedGeneration.asset) {
        const asset = deletedGeneration.asset as any;

        // Only delete thumbnail URL if exists
        if (asset.thumbnailUrl) {
          await ctx.fileService.deleteFile(asset.thumbnailUrl);
        }
      }

      return deletedGeneration;
    }),

  getGenerationStatus: generationProcedure
    .input(
      z.object({
        asyncTaskId: z.string(),
        generationId: z.string(),
        /**
         * The polling caller's own chat topic, when known. Only the
         * `lobe-image-generation` builtin tool passes this (forwarded from
         * `ToolExecutionContext.topicId`, server-resolved — never
         * model-suppliable); the standalone gallery/video pages never send it
         * and keep their existing cross-topic-by-design behavior.
         *
         * When present, it MUST match the polled task's own
         * `metadata.topicId` (stamped at creation time in
         * `imageRouter.createImage`). `async_tasks` — and the `generations`
         * row it resolves to, including its prompt and asset URL — is scoped
         * only by `userId` (see `AsyncTaskModel`'s `ownership()`), so without
         * this check a share visitor's run (which executes under the
         * CREATOR's `userId`, see `AgentShareGate`) could poll ANY
         * `generationId`/`asyncTaskId` pair the model guesses or reuses from
         * a different conversation and read that other generation's prompt
         * and image — including another visitor's share session, or the
         * creator's own unrelated chats. Mismatch is treated identically to
         * "not found" below so this can't be used to probe for the
         * existence of another topic's generation either.
         */
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Check for timeout tasks before querying
      await ctx.asyncTaskModel.checkTimeoutTasks([input.asyncTaskId]);

      const asyncTask = await ctx.asyncTaskModel.findById(input.asyncTaskId);
      if (!asyncTask) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Async task not found' });
      }

      if (input.topicId !== undefined) {
        const taskTopicId = (asyncTask.metadata as { topicId?: string } | undefined)?.topicId;
        if (taskTopicId !== input.topicId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Async task not found' });
        }
      }

      const { status, error } = asyncTask;
      const result: GetGenerationStatusResult = {
        error: null,
        generation: null,
        status: status as AsyncTaskStatus,
      };

      if (asyncTask.status === AsyncTaskStatus.Success) {
        const generation = await ctx.generationModel.findByIdAndTransform(input.generationId);
        if (!generation) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation not found' });
        }

        result.generation = generation;
      } else if (asyncTask.status === AsyncTaskStatus.Error) {
        result.error = error as AsyncTaskError;
      }

      return result;
    }),
});

export type GenerationRouter = typeof generationRouter;
