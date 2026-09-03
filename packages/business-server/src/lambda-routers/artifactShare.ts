import type { SharedArtifactData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';

export const artifactShareRouter = router({
  getShared: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async (): Promise<SharedArtifactData> => {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact sharing is not available' });
    }),
});
