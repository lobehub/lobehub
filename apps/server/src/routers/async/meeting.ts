import { z } from 'zod';

import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { runMeetingMinutesJob, runMeetingRefineJob } from '@/server/services/meeting/runJob';

const jobInput = z.object({
  meetingId: z.string().min(1),
  taskId: z.string().uuid(),
  workspaceId: z.string().optional(),
});

/** Post-recording meeting work, queued by the lambda `meeting` router. */
export const meetingRouter = router({
  runMinutes: asyncAuthedProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    await runMeetingMinutesJob(ctx.serverDB, ctx.userId, input);
    return { ok: true };
  }),

  runRefine: asyncAuthedProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    await runMeetingRefineJob(ctx.serverDB, ctx.userId, input);
    return { ok: true };
  }),
});
