import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { authorizeReviewConnect, describeReviewConnect } from '@/server/services/acceptanceReview';

const connectInput = z.object({
  acceptanceId: z.string().min(1),
  origin: z.string().min(1).max(2000),
});
// A one-time secret the toolbar generated for the handoff fallback.
const authorizeInput = connectInput.extend({
  handoff: z
    .string()
    .regex(/^[\w-]{32,128}$/)
    .optional(),
});

/**
 * The approval page behind the embedded review toolbar's popup: a signed-in
 * reviewer sees which site asks to review which acceptance, then approves.
 * Session-only on purpose — API keys cannot mint review sessions (this
 * namespace is not in the API-key scope rules, so they are refused).
 */
export const acceptanceReviewRouter = router({
  authorize: authedProcedure
    .use(serverDatabase)
    .input(authorizeInput)
    .mutation(({ ctx, input }) => authorizeReviewConnect(ctx.serverDB, ctx.userId, input)),
  describe: authedProcedure
    .use(serverDatabase)
    .input(connectInput)
    .query(({ ctx, input }) => describeReviewConnect(ctx.serverDB, ctx.userId, input)),
});
