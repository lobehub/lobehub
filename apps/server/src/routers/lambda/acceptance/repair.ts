import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { AcceptanceService } from '@/server/services/verify';

import { resolveAcceptanceCommentAccess } from '../_helpers/acceptanceCommentAccess';
import { dispatchAcceptanceFeedbackRepair } from '../_helpers/acceptanceFeedbackRepair';
import { acceptanceProcedure } from './procedures';
import { reviewRouter } from './review';

export const repairRouter = router({
  requestRepair: acceptanceProcedure
    .input(z.object({ id: z.string().uuid(), comment: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAcceptanceCommentAccess(ctx.serverDB, ctx.userId, input.id);
      if (access.acceptance.subjectType !== 'site') {
        const result = await reviewRouter.createCaller(ctx).reject(input);
        return result.repairDispatch;
      }
      if (!access.canComment) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Project edit access is required to request a repair',
        });
      }
      const acceptance = access.acceptance;
      const service = new AcceptanceService(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );
      return dispatchAcceptanceFeedbackRepair(
        { ...ctx, workspaceId: acceptance.workspaceId },
        service,
        acceptance,
        input.comment,
      );
    }),
});
