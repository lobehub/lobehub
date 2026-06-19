import type { SharedDocumentData } from '@lobechat/types';
import { z } from 'zod';

import { DocumentShareModel } from '@/database/models/documentShare';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const shareProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      documentShareModel: new DocumentShareModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const pageShareRouter = router({
  getShareSettings: shareProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => ctx.documentShareModel.getByDocumentId(input.id)),

  updateShareSettings: shareProcedure
    .input(
      z.object({
        id: z.string(),
        permission: z.enum(['read']).default('read'),
        visibility: z.enum(['private', 'link']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.documentShareModel.create(input.id, {
        permission: input.permission,
        visibility: input.visibility,
      });
      await ctx.documentShareModel.updatePermission(input.id, input.permission);
      return ctx.documentShareModel.updateVisibility(input.id, input.visibility);
    }),

  getSharedDocument: publicProcedure
    .use(serverDatabase)
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }): Promise<SharedDocumentData> => {
      const result = await DocumentShareModel.findByDocumentIdWithAccessCheck(
        ctx.serverDB,
        input.documentId,
        ctx.userId ?? undefined,
      );
      if (!result.isOwner)
        await DocumentShareModel.incrementPageViewCount(ctx.serverDB, input.documentId);

      return {
        document: {
          content: result.document.content,
          description: result.document.description,
          editorData: result.document.editorData as Record<string, unknown> | null,
          fileType: result.document.fileType,
          id: result.document.id,
          metadata: result.document.metadata as Record<string, unknown> | null,
          pages: result.document.pages,
          title: result.document.title,
          updatedAt: result.document.updatedAt,
        },
        isOwner: result.isOwner,
        ownerMeta: {
          avatar: result.ownerAvatar,
          displayName: result.ownerDisplayName,
        },
        pageViewCount: result.pageViewCount,
        permission: result.permission,
        visibility: result.visibility,
      };
    }),
});
