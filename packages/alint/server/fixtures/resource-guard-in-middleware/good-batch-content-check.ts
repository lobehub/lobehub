import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { documentProcedure } from './procedures';
import { assertContentsNotInRestrictedKnowledgeBase } from './restrictedKnowledgeBase';

export const documentRouter = router({
  batchDelete: documentProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, input.ids);
      return ctx.documentModel.deleteMany(input.ids);
    }),
  batchMove: documentProcedure
    .input(z.object({ ids: z.array(z.string()), parentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, input.ids);
      return ctx.documentModel.moveMany(input.ids, input.parentId);
    }),
  batchExport: documentProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, input.ids);
      return ctx.documentModel.exportMany(input.ids);
    }),
});
