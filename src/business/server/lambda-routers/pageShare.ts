import type { SharedDocumentData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';

export const pageShareRouter = router({
  getShareSettings: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(
      async () => null as { pageViewCount: number; permission: string; visibility: string } | null,
    ),

  updateShareSettings: authedProcedure
    .input(
      z.object({
        id: z.string(),
        permission: z.enum(['read']).default('read'),
        visibility: z.enum(['private', 'link']),
      }),
    )
    .mutation(async () => null),

  getSharedDocument: publicProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async (): Promise<SharedDocumentData> => {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Page sharing is not available' });
    }),
});
