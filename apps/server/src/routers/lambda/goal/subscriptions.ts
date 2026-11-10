import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import {
  bindSubscriptionSchema,
  updateSubscriptionSchema,
} from '@/server/services/goal/subscriptions';

import { goalProcedure, goalWriteProcedure } from '../goalProcedures';

const revisionInput = z.object({
  bindingRevision: z.number().int().positive(),
  id: z.string().uuid(),
});

/** A Goal's durable bindings to Widget metric collections. */
export const subscriptionRouter = router({
  bindSubscription: goalWriteProcedure
    .input(bindSubscriptionSchema)
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.goalSubscriptionService.bind(input),
      success: true,
    })),
  disableSubscription: goalWriteProcedure.input(revisionInput).mutation(async ({ ctx, input }) => ({
    data: await ctx.goalSubscriptionService.setEnabled(input.id, input.bindingRevision, false),
    success: true,
  })),
  enableSubscription: goalWriteProcedure.input(revisionInput).mutation(async ({ ctx, input }) => ({
    data: await ctx.goalSubscriptionService.setEnabled(input.id, input.bindingRevision, true),
    success: true,
  })),
  listSubscriptions: goalProcedure
    .input(z.object({ goalId: z.string().min(1) }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.goalSubscriptionService.list(input.goalId),
      success: true,
    })),
  rebindSubscription: goalWriteProcedure
    .input(
      bindSubscriptionSchema.extend({
        bindingRevision: z.number().int().positive(),
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.goalSubscriptionService.bind(input, input),
      success: true,
    })),
  updateSubscription: goalWriteProcedure
    .input(updateSubscriptionSchema)
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.goalSubscriptionService.update(input),
      success: true,
    })),
});
