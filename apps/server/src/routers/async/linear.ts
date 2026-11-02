import { z } from 'zod';

import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { continueLinearRuleSyncJob } from '@/server/services/linear/startSyncJob';
import { LinearSyncJobService } from '@/server/services/linear/syncJob';

/** Background Linear issue syncs, queued by the lambda `linear` router. */
export const linearRouter = router({
  runSync: asyncAuthedProcedure
    .input(z.object({ taskId: z.string().uuid(), workspaceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = input;
      // A rule run that hits its per-round cap is handed back here for the next round.
      await new LinearSyncJobService(ctx.serverDB, ctx.userId, workspaceId, (taskId, metadata) =>
        continueLinearRuleSyncJob(ctx.serverDB, ctx.userId, workspaceId, taskId, metadata),
      ).run(input.taskId);
      return { ok: true };
    }),
});
