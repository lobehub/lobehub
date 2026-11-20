import { z } from 'zod';

import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { DataExportService } from '@/server/services/dataExport';

/** Background data exports, queued by the lambda `exporter` router. */
export const dataExportRouter = router({
  run: asyncAuthedProcedure
    .input(z.object({ taskId: z.string().uuid(), workspaceId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await new DataExportService(ctx.serverDB, ctx.userId, input.workspaceId).run(input.taskId);
      return { ok: true };
    }),
});
