// A request patch goes to a model method named merge*. The merge happens in Postgres
// (jsonb `||`), never as a recursive JavaScript assignment.
import { z } from 'zod';

import { router, threadProcedure } from './trpc';

export const threadRouter = router({
  mergeThreadMetadata: threadProcedure
    .input(z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      // ThreadModel.mergeMetadata: COALESCE(metadata, '{}'::jsonb) || $patch::jsonb
      return ctx.threadModel.mergeMetadata(input.id, input.patch);
    }),
});
