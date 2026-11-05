import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { serverDBEnv } from '@/config/db';
import { router } from '@/libs/trpc/lambda';

import { assertFileNotInRestrictedKnowledgeBase } from '../_helpers/knowledgeBaseAccess';
import { fileProcedure } from './procedures';

/** Caps the per-file knowledge-base access checks issued by a bulk delete. */
export const FILE_ACCESS_CHECK_CONCURRENCY = 5;

export const assertFilesNotInRestrictedKnowledgeBase = async (
  ctx: Parameters<typeof assertFileNotInRestrictedKnowledgeBase>[0],
  files: Array<{ id: string }>,
): Promise<void> => {
  await pMap(files, (file) => assertFileNotInRestrictedKnowledgeBase(ctx, file.id), {
    concurrency: FILE_ACCESS_CHECK_CONCURRENCY,
  });
};

const assertAllFilesAccessible = (requestedIds: string[], files: Array<{ id: string }>): void => {
  const accessibleIds = new Set(files.map((file) => file.id));
  if ([...new Set(requestedIds)].some((id) => !accessibleIds.has(id))) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more files were not found or are not accessible',
    });
  }
};

export const removeRouter = router({
  removeFile: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.fileModel.findById(input.id);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      await assertFileNotInRestrictedKnowledgeBase(ctx, input.id);

      const file = await ctx.fileModel.delete(input.id, {
        removeGlobalFile: serverDBEnv.REMOVE_GLOBAL_FILE,
      });

      if (!file) return;

      // delete the file from S3 if it is not used by other files
      await ctx.fileService.deleteFile(file.url!);
    }),
  removeUnreferencedFile: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.fileModel.findById(input.id);
      // Import failure cleanup can run on both server and client; retries are harmless.
      if (!existing) return;
      await assertFileNotInRestrictedKnowledgeBase(ctx, input.id);

      const file = await ctx.fileModel.deleteUnreferenced(input.id, {
        removeGlobalFile: serverDBEnv.REMOVE_GLOBAL_FILE,
      });
      if (!file) return;

      await ctx.fileService.deleteFile(file.url!);
    }),
  removeFileAsyncTask: fileProcedure
    .use(withScopedPermission('file:update'))
    .input(
      z.object({
        id: z.string(),
        type: z.enum(['embedding', 'chunk']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.id);

      if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      await assertFileNotInRestrictedKnowledgeBase(ctx, input.id);

      const taskId = input.type === 'embedding' ? file.embeddingTaskId : file.chunkTaskId;

      if (!taskId) return;

      await ctx.asyncTaskModel.delete(taskId);
    }),
  removeFiles: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const ids = [...new Set(input.ids)];
      const targets = await ctx.fileModel.findByIds(ids);
      assertAllFilesAccessible(ids, targets);
      await assertFilesNotInRestrictedKnowledgeBase(ctx, targets);

      const needToRemoveFileList = await ctx.fileModel.deleteMany(
        ids,
        serverDBEnv.REMOVE_GLOBAL_FILE,
      );

      if (!needToRemoveFileList || needToRemoveFileList.length === 0) return;

      // remove from S3
      await ctx.fileService.deleteFiles(needToRemoveFileList.map((file) => file.url!));
    }),
});
