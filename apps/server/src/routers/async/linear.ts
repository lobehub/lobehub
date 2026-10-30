import { z } from 'zod';

import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { LinearSyncJobService } from '@/server/services/linear/syncJob';

/** Background Linear issue syncs, queued by the lambda `linear` router. */
export const linearRouter = router({
  runSync: asyncAuthedProcedure
    .input(z.object({ taskId: z.string().uuid(), workspaceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await new LinearSyncJobService(ctx.serverDB, ctx.userId, input.workspaceId).run(input.taskId);
      return { ok: true };
    }),
});
