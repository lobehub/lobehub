import { FollowUpExtractInputSchema } from '@lobechat/types';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FollowUpActionService } from '@/server/services/followUpAction';

const followUpProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      followUpService: new FollowUpActionService(ctx.serverDB, ctx.userId),
    },
  });
});

export const followUpActionRouter = router({
  extract: followUpProcedure
    .input(FollowUpExtractInputSchema)
    .mutation(async ({ input, ctx }) => ctx.followUpService.extract(input)),
});
