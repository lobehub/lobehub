import type { FileShareSettings, SharedFileData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';

export const fileShareRouter = router({
  getShareSettings: authedProcedure
    .input(z.object({ fileId: z.string() }))
    .query(async (): Promise<FileShareSettings | null> => null),

  updateShareSettings: authedProcedure
    .input(z.object({ fileId: z.string(), visibility: z.enum(['private', 'link']) }))
    .mutation(async (): Promise<FileShareSettings | null> => null),

  getSharedFile: publicProcedure
    .input(z.object({ shareId: z.string() }))
    .query(async (): Promise<SharedFileData> => {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'File sharing is not available' });
    }),
});
