import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { users } from '@/database/schemas';
import { aicoEnv, tomanToUsd } from '@/envs/aico';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

const billingProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      billingModel: new AicoBillingModel(ctx.serverDB),
      keyService: new AicoOpenRouterKeyService(ctx.serverDB),
    },
  });
});

export const aicoBillingRouter = router({
  getFxRate: billingProcedure.query(() => ({
    tomanPerUsd: aicoEnv.AICO_TOMAN_PER_USD,
  })),

  getMyWallet: billingProcedure.query(async ({ ctx }) => {
    const wallet = await ctx.billingModel.getOrCreateUserWallet(ctx.userId);
    return {
      balanceToman: wallet.balanceToman,
      balanceUsd: Number(wallet.balanceUsd),
      hasManagedKey: Boolean(wallet.openrouterKeyId),
      isActive: wallet.isActive,
      // Never expose key material
    };
  }),

  getMyUsage: billingProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.billingModel.listUserUsage(ctx.userId, input?.limit ?? 50);
    }),

  getMyTransactions: billingProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.billingModel.listUserTransactions(ctx.userId, input?.limit ?? 50);
    }),

  mockTopup: billingProcedure
    .input(z.object({ amountToman: z.number().int().positive().max(100_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const fxRate = aicoEnv.AICO_TOMAN_PER_USD;
      const amountUsd = tomanToUsd(input.amountToman, fxRate);

      const { wallet, transaction } = await ctx.billingModel.mockTopupUser({
        amountToman: input.amountToman,
        amountUsd,
        createdByUserId: ctx.userId,
        fxRate,
        userId: ctx.userId,
      });

      await ctx.keyService.ensureUserKey(ctx.userId);

      return {
        amountUsd,
        balanceToman: wallet.balanceToman,
        balanceUsd: Number(wallet.balanceUsd),
        fxRate,
        transactionId: transaction.id,
      };
    }),

  getMyTrial: billingProcedure.query(async ({ ctx }) => {
    const [trial, config, active] = await Promise.all([
      ctx.billingModel.getUserTrial(ctx.userId),
      ctx.billingModel.getTrialConfig(),
      ctx.billingModel.isTrialActive(ctx.userId),
    ]);
    return {
      active,
      config: {
        allowedModelIds: JSON.parse(config.allowedModelIds || '[]') as string[],
        durationDays: config.durationDays,
        enabled: config.enabled,
        maxRequests: config.maxRequests,
      },
      trial: trial
        ? {
            expiresAt: trial.expiresAt.toISOString(),
            requestCount: trial.requestCount,
            startedAt: trial.startedAt.toISOString(),
            status: trial.status,
          }
        : null,
    };
  }),

  activateTrial: billingProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.serverDB.query.users.findFirst({
      where: eq(users.id, ctx.userId),
    });
    if (!user?.phone || !user.phoneNumberVerified) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'PHONE_VERIFICATION_REQUIRED',
      });
    }

    try {
      const trial = await ctx.billingModel.activateTrial({
        phone: user.phone,
        userId: ctx.userId,
      });
      return {
        expiresAt: trial.expiresAt.toISOString(),
        startedAt: trial.startedAt.toISOString(),
        status: trial.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TRIAL_FAILED';
      throw new TRPCError({
        code:
          message === 'TRIAL_DISABLED'
            ? 'FORBIDDEN'
            : message.startsWith('TRIAL_')
              ? 'BAD_REQUEST'
              : 'INTERNAL_SERVER_ERROR',
        message,
      });
    }
  }),

  /** Provider surface hint — never returns keys. */
  getManagedProviderStatus: billingProcedure.query(async ({ ctx }) => {
    const wallet = await ctx.billingModel.getUserWallet(ctx.userId);
    const trialActive = await ctx.billingModel.isTrialActive(ctx.userId);
    return {
      brandName: 'Aico',
      managed: Boolean(wallet?.openrouterKeyId) || trialActive,
      providerId: 'aico',
    };
  }),
});

export type AicoBillingRouter = typeof aicoBillingRouter;
