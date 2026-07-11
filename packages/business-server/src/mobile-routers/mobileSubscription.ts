import { Plans } from '@lobechat/types';

import { authedProcedure, router } from '@/libs/trpc/lambda';

import { getSubscriptionPlan } from '../user';

export const mobileSubscriptionRouter = router({
  getSubscription: authedProcedure.query(async ({ ctx }) => {
    const plan = await getSubscriptionPlan(ctx.userId);
    return {
      plan,
      isFreePlan: !plan || plan === Plans.Free,
    };
  }),
});
